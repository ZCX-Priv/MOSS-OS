// render/office/sheet-model.ts
// 电子表格的统一「视图模型」：两个引擎（自写 OOXML parser / SheetJS 兜底）都归一化成
// WorkbookModel，交给唯一的观感组件 WorkbookViewer 渲染。纯类型 + 纯函数，无依赖。

/** 单元格基础样式（仅还原常见且可安全映射到 HTML 的部分） */
export interface CellStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  /** 字号（pt） */
  fontSize?: number;
  /** 字体颜色 #RRGGBB */
  color?: string;
  /** 填充色 #RRGGBB */
  bg?: string;
  /** 水平对齐 */
  align?: 'left' | 'center' | 'right';
  /** 垂直对齐 */
  valign?: 'top' | 'middle' | 'bottom';
  /** 是否有可见边框（仅四周边框有无，不区分线型） */
  border?: boolean;
  /** 是否自动换行 */
  wrap?: boolean;
}

export interface SheetCell {
  /** 展示值 */
  value: string;
  /** 样式（无样式为 undefined） */
  style?: CellStyle;
}

export interface MergeRange {
  s: { r: number; c: number };
  e: { r: number; c: number };
}

export interface SheetModel {
  name: string;
  /** 稠密二维数组（缺失单元格为 { value: '' }） */
  rows: SheetCell[][];
  /** 列数（各列最大宽度，至少 1） */
  colCount: number;
  /** 合并区域（0 基行列） */
  merges: MergeRange[];
  /** 每列宽度（OOXML 字符宽 / SheetJS wch；无则为 undefined） */
  colWidths: Array<number | undefined>;
}

export interface WorkbookModel {
  sheets: SheetModel[];
  /** 是否因超大而截断了行（展示提示） */
  truncated: boolean;
}

/** A1 引用 → 0 基行列 */
export function parseCellRef(ref: string): { r: number; c: number } {
  let c = 0;
  let i = 0;
  for (; i < ref.length; i++) {
    const ch = ref.charCodeAt(i);
    if (ch < 65 || ch > 90) break;
    c = c * 26 + (ch - 64);
  }
  const r = Number(ref.slice(i));
  return { r: Number.isFinite(r) && r > 0 ? r - 1 : 0, c: c > 0 ? c - 1 : 0 };
}

/** 0 基列号 → 列标（A/B/…/AA） */
export function columnLabel(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** 0 基行列 → A1 引用 */
export function cellRefLabel(r: number, c: number): string {
  return `${columnLabel(c)}${r + 1}`;
}