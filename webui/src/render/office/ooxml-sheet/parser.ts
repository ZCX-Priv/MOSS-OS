// render/office/ooxml-sheet/parser.ts
// 自写 OOXML 表格解析器（xlsx/xlsm/xltx/xltm，以及 OOXML 形态的 WPS .et）。
// 覆盖：共享字符串、单元格类型、数字格式（含日期）、字体/填充/边框/对齐、合并单元格、列宽。
// 不覆盖（如实提示）：条件格式、图表、数据透视、公式计算（仅取缓存值）、图片。
// 依赖 jszip（动态加载）+ 浏览器原生 DOMParser。

import type { CellStyle, MergeRange, SheetModel, SheetCell, WorkbookModel } from '../sheet-model';
import { parseCellRef } from '../sheet-model';

/** 单表解析行 / 列上限（防超大表拖垮低配机） */
const MAX_ROWS = 20_000;
const MAX_COLS = 300;
/** 单表非空单元格总量上限（内存保护） */
const MAX_CELLS = 500_000;

/** Excel 内置日期/时间数字格式 id */
const DATE_FMT_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

interface StyleTable {
  /** cellXfs：每项指向 font/fill/border/numFmt 索引 + 对齐 */
  xfs: Array<{
    fontId: number;
    fillId: number;
    borderId: number;
    numFmtId: number;
    align?: CellStyle['align'];
    valign?: CellStyle['valign'];
    wrap?: boolean;
  }>;
  fonts: Array<Pick<CellStyle, 'bold' | 'italic' | 'underline' | 'strike' | 'fontSize' | 'color'>>;
  fills: Array<string | undefined>;
  borders: boolean[];
  numFmts: Map<number, string>;
}

function parseXml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) throw new Error('OOXML: malformed XML');
  return doc;
}

/** 取元素下所有直接/间接同名子元素的文本（用于 <si>/<is> 的多 <t> 场景） */
function joinedText(el: Element | null | undefined, tag: string): string {
  if (!el) return '';
  const nodes = el.getElementsByTagName(tag);
  let out = '';
  for (let i = 0; i < nodes.length; i++) out += nodes[i].textContent ?? '';
  return out;
}

/** OOXML 颜色 rgb="FFRRGGBB" / "RRGGBB" → #RRGGBB（忽略 alpha） */
function normColor(rgb: string | null | undefined): string | undefined {
  if (!rgb) return undefined;
  const hex = rgb.length === 8 ? rgb.slice(2) : rgb;
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return undefined;
  return `#${hex.toLowerCase()}`;
}

/** 相对路径拼接（workbook 目录 + target） */
function resolvePath(baseDir: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = `${baseDir}/${target}`.split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '' || p === '.') continue;
    if (p === '..') out.pop();
    else out.push(p);
  }
  return out.join('/');
}

function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

/** 读取 zip 内文本文件（不存在返回 null）—— 避免暴露 JSZip 具体类型 */
type ReadXml = (path: string) => Promise<string | null>;

/** 定位 workbook.xml（优先根关系，回退常见路径） */
async function findWorkbookPath(readXml: ReadXml): Promise<string> {
  const rootRels = await readXml('_rels/.rels');
  if (rootRels) {
    const doc = parseXml(rootRels);
    const rels = doc.getElementsByTagName('Relationship');
    for (let i = 0; i < rels.length; i++) {
      const type = rels[i].getAttribute('Type') ?? '';
      if (type.endsWith('/officeDocument')) {
        const target = rels[i].getAttribute('Target') ?? '';
        if (target) return target.replace(/^\//, '');
      }
    }
  }
  if (await readXml('xl/workbook.xml')) return 'xl/workbook.xml';
  throw new Error('OOXML: workbook.xml not found');
}

/** 解析 styles.xml → StyleTable */
function parseStyles(xml: string | null): StyleTable {
  const table: StyleTable = { xfs: [], fonts: [], fills: [], borders: [], numFmts: new Map() };
  if (!xml) return table;
  const doc = parseXml(xml);

  const numFmtNodes = doc.getElementsByTagName('numFmt');
  for (let i = 0; i < numFmtNodes.length; i++) {
    const id = Number(numFmtNodes[i].getAttribute('numFmtId') ?? '0');
    const code = numFmtNodes[i].getAttribute('formatCode') ?? '';
    if (id) table.numFmts.set(id, code);
  }

  const fontNodes = doc.getElementsByTagName('font');
  for (let i = 0; i < fontNodes.length; i++) {
    const f = fontNodes[i];
    const sz = f.getElementsByTagName('sz')[0]?.getAttribute('val');
    table.fonts.push({
      bold: f.getElementsByTagName('b').length > 0,
      italic: f.getElementsByTagName('i').length > 0,
      underline: f.getElementsByTagName('u').length > 0,
      strike: f.getElementsByTagName('strike').length > 0,
      fontSize: sz ? Number(sz) : undefined,
      color: normColor(f.getElementsByTagName('color')[0]?.getAttribute('rgb')),
    });
  }

  const fillNodes = doc.getElementsByTagName('fill');
  for (let i = 0; i < fillNodes.length; i++) {
    const fg = fillNodes[i].getElementsByTagName('fgColor')[0];
    // patternType="none" 的首个 fill 无意义；fgColor 为自动色时忽略
    const pattern = fillNodes[i].getElementsByTagName('patternFill')[0]?.getAttribute('patternType');
    const color = pattern && pattern !== 'none' ? normColor(fg?.getAttribute('rgb')) : undefined;
    table.fills.push(color);
  }

  const borderNodes = doc.getElementsByTagName('border');
  for (let i = 0; i < borderNodes.length; i++) {
    const b = borderNodes[i];
    const has =
      ['left', 'right', 'top', 'bottom'].some(
        (side) => (b.getElementsByTagName(side)[0]?.getAttribute('style') ?? '') !== '',
      );
    table.borders.push(has);
  }

  // cellXfs 下的 xf（注意要排除 cellStyleXfs 的 xf）
  const cellXfs = doc.getElementsByTagName('cellXfs')[0];
  if (cellXfs) {
    const xfs = cellXfs.getElementsByTagName('xf');
    for (let i = 0; i < xfs.length; i++) {
      const xf = xfs[i];
      const align = xf.getElementsByTagName('alignment')[0];
      const horiz = align?.getAttribute('horizontal');
      const vert = align?.getAttribute('vertical');
      table.xfs.push({
        fontId: Number(xf.getAttribute('fontId') ?? '0'),
        fillId: Number(xf.getAttribute('fillId') ?? '0'),
        borderId: Number(xf.getAttribute('borderId') ?? '0'),
        numFmtId: Number(xf.getAttribute('numFmtId') ?? '0'),
        align: horiz === 'center' || horiz === 'right' || horiz === 'left' ? horiz : undefined,
        valign: vert === 'top' || vert === 'center' || vert === 'bottom'
          ? (vert === 'center' ? 'middle' : vert)
          : undefined,
        wrap: align?.getAttribute('wrapText') === '1',
      });
    }
  }
  return table;
}

/** 由样式索引合成 CellStyle */
function styleFromIndex(index: number, table: StyleTable): CellStyle | undefined {
  const xf = table.xfs[index];
  if (!xf) return undefined;
  const font = table.fonts[xf.fontId];
  const style: CellStyle = {};
  if (font) {
    if (font.bold) style.bold = true;
    if (font.italic) style.italic = true;
    if (font.underline) style.underline = true;
    if (font.strike) style.strike = true;
    if (font.fontSize) style.fontSize = font.fontSize;
    if (font.color) style.color = font.color;
  }
  const fill = table.fills[xf.fillId];
  if (fill) style.bg = fill;
  if (table.borders[xf.borderId]) style.border = true;
  if (xf.align) style.align = xf.align;
  if (xf.valign) style.valign = xf.valign;
  if (xf.wrap) style.wrap = true;
  return Object.keys(style).length > 0 ? style : undefined;
}

function isDateFormat(numFmtId: number, table: StyleTable): boolean {
  if (DATE_FMT_IDS.has(numFmtId)) return true;
  const code = table.numFmts.get(numFmtId);
  if (!code) return false;
  const cleaned = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
  return /[yYmMdDhHsS]/.test(cleaned) && !/[#0?]/.test(cleaned.replace(/[yYmMdDhHsS]/g, ''));
}

/** Excel 序列号 → 显示字符串（1900 日期系统） */
function serialToText(serial: number): string {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return String(serial);
  const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  const time = d.getUTCHours() || d.getUTCMinutes() || d.getUTCSeconds()
    ? ` ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
    : '';
  return date + time;
}

/** 解析单个工作表的行/合并/列宽 */
function parseSheet(
  xml: string,
  styles: StyleTable,
  sst: string[],
  name: string,
): { sheet: SheetModel; truncated: boolean } {
  const doc = parseXml(xml);
  const rowNodes = doc.getElementsByTagName('row');

  const rows: SheetCell[][] = [];
  let colCount = 0;
  let truncated = false;
  let cellCount = 0;

  for (let i = 0; i < rowNodes.length; i++) {
    if (rows.length >= MAX_ROWS || cellCount >= MAX_CELLS) {
      truncated = true;
      break;
    }
    const rowEl = rowNodes[i];
    const rowIndex = Number(rowEl.getAttribute('r') ?? String(rows.length + 1)) - 1;
    if (rowIndex >= MAX_ROWS) {
      truncated = true;
      break;
    }
    while (rows.length < rowIndex) rows.push([]);
    const outRow: SheetCell[] = [];
    const cellNodes = rowEl.getElementsByTagName('c');
    for (let j = 0; j < cellNodes.length; j++) {
      const c = cellNodes[j];
      const ref = c.getAttribute('r');
      const pos = ref ? parseCellRef(ref) : { r: rowIndex, c: outRow.length };
      if (pos.c >= MAX_COLS) {
        truncated = true;
        continue;
      }
      const t = c.getAttribute('t') ?? 'n';
      const sIdx = c.getAttribute('s');
      const style = sIdx ? styleFromIndex(Number(sIdx), styles) : undefined;
      const xf = sIdx ? styles.xfs[Number(sIdx)] : undefined;

      let value = '';
      if (t === 's') {
        const idx = Number(c.getElementsByTagName('v')[0]?.textContent ?? '-1');
        value = sst[idx] ?? '';
      } else if (t === 'inlineStr') {
        value = joinedText(c.getElementsByTagName('is')[0], 't');
      } else if (t === 'b') {
        value = (c.getElementsByTagName('v')[0]?.textContent ?? '') === '1' ? 'TRUE' : 'FALSE';
      } else if (t === 'e' || t === 'str') {
        value = c.getElementsByTagName('v')[0]?.textContent ?? '';
      } else {
        const raw = c.getElementsByTagName('v')[0]?.textContent ?? '';
        if (raw === '') {
          value = '';
        } else if (xf && isDateFormat(xf.numFmtId, styles)) {
          value = serialToText(Number(raw));
        } else {
          value = raw;
        }
      }
      outRow[pos.c] = { value, style };
      colCount = Math.max(colCount, pos.c + 1);
      cellCount++;
      if (cellCount >= MAX_CELLS) {
        truncated = true;
        break;
      }
    }
    rows[rowIndex] = outRow;
  }

  // 合并区域
  const merges: MergeRange[] = [];
  const mergeNodes = doc.getElementsByTagName('mergeCell');
  for (let i = 0; i < mergeNodes.length; i++) {
    const ref = mergeNodes[i].getAttribute('ref') ?? '';
    const [a, b] = ref.split(':');
    if (!a || !b) continue;
    const start = parseCellRef(a);
    const end = parseCellRef(b);
    merges.push({ s: start, e: end });
    colCount = Math.max(colCount, end.c + 1);
    while (rows.length <= end.r && rows.length < MAX_ROWS) rows.push([]);
  }

  // 列宽
  const colWidths: Array<number | undefined> = [];
  const colNodes = doc.getElementsByTagName('col');
  for (let i = 0; i < colNodes.length; i++) {
    const min = Number(colNodes[i].getAttribute('min') ?? '0');
    const max = Number(colNodes[i].getAttribute('max') ?? '0');
    const w = Number(colNodes[i].getAttribute('width') ?? '0');
    if (!min || !max || !w) continue;
    for (let c = min - 1; c < max && c < MAX_COLS; c++) colWidths[c] = w;
  }

  return { sheet: { name, rows, colCount: Math.max(colCount, 1), merges, colWidths }, truncated };
}

/**
 * 解析 OOXML 工作簿。
 * @param buffer xlsx/xlsm/xltx/xltm（或 OOXML 形态的 .et）字节
 */
export async function parseOoxmlWorkbook(buffer: ArrayBuffer): Promise<WorkbookModel> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(buffer);
  const readXml: ReadXml = async (path) => {
    const f = zip.file(path);
    return f ? f.async('string') : null;
  };

  const wbPath = await findWorkbookPath(readXml);
  const wbDir = dirOf(wbPath);
  const wbDirPrefix = wbDir ? `${wbDir}/` : '';
  const wbXml = await readXml(wbPath);
  if (!wbXml) throw new Error('OOXML: cannot read workbook');
  const wbDoc = parseXml(wbXml);

  // sheet 名称与 r:id
  const sheetRefs: Array<{ name: string; rid: string }> = [];
  const sheetNodes = wbDoc.getElementsByTagName('sheet');
  for (let i = 0; i < sheetNodes.length; i++) {
    const el = sheetNodes[i];
    let rid = el.getAttribute('r:id') ?? '';
    if (!rid) {
      // 前缀可能被解析器改写：遍历属性找 localName === 'id'
      for (let a = 0; a < el.attributes.length; a++) {
        const attr = el.attributes[a];
        if (attr.name.endsWith(':id') || attr.localName === 'id') {
          rid = attr.value;
          break;
        }
      }
    }
    sheetRefs.push({ name: el.getAttribute('name') ?? `Sheet${i + 1}`, rid });
  }

  // rels：r:id → target
  const relsPath = `${wbDirPrefix}_rels/${wbPath.split('/').pop()}.rels`;
  const ridToTarget = new Map<string, string>();
  const relsXml = await readXml(relsPath);
  if (relsXml) {
    const relsDoc = parseXml(relsXml);
    const rels = relsDoc.getElementsByTagName('Relationship');
    for (let i = 0; i < rels.length; i++) {
      const id = rels[i].getAttribute('Id') ?? '';
      const target = rels[i].getAttribute('Target') ?? '';
      if (id && target) ridToTarget.set(id, target);
    }
  }

  // 共享字符串
  const sst: string[] = [];
  const sstXml = await readXml(`${wbDirPrefix}sharedStrings.xml`);
  if (sstXml) {
    const sstDoc = parseXml(sstXml);
    const items = sstDoc.getElementsByTagName('si');
    for (let i = 0; i < items.length; i++) sst.push(joinedText(items[i], 't'));
  }

  // 样式
  const styles = parseStyles(await readXml(`${wbDirPrefix}styles.xml`));

  const sheets: SheetModel[] = [];
  let truncated = false;
  for (const ref of sheetRefs) {
    const target = ridToTarget.get(ref.rid);
    if (!target) continue;
    const path = resolvePath(wbDir, target);
    const xml = await readXml(path);
    if (!xml) continue;
    const parsed = parseSheet(xml, styles, sst, ref.name);
    sheets.push(parsed.sheet);
    if (parsed.truncated) truncated = true;
  }

  if (sheets.length === 0) throw new Error('OOXML: no worksheets found');
  return { sheets, truncated };
}