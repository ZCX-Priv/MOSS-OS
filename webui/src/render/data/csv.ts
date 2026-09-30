// render/data/csv.ts
// 极简 RFC4180 解析器（支持引号包裹、转义双引号、字段内换行、CRLF/LF）。
// 仅用于预览展示，不引入额外依赖。

/**
 * 解析分隔符文本为二维数组。
 * @param text 原始文本
 * @param delimiter 分隔符（默认逗号；制表符传 '\t'）
 */
export function parseDelimited(text: string, delimiter = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  // 去掉 UTF-8 BOM
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  while (i < input.length) {
    const ch = input[i];

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"' && field === '') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === delimiter) {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (ch === '\r') {
      // CRLF / CR 统一按换行
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += input[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  // 末行（无尾随换行）
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/** 按扩展名选择分隔符 */
export function delimiterForExt(ext: string): string {
  return ext.toLowerCase() === 'tsv' ? '\t' : ',';
}