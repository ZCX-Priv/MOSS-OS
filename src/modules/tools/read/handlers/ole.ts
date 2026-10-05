// read/handlers/ole.ts
// OLE/CFB 复合文档的「尽力文本提取」——专治 Word/PPT 旧版（含 Word 6/95）与 OLE 版 WPS
// （.wps/.wpt 文字、.dps/.dpt 演示）无法被现代解析库识别而报错的问题。
//
// 覆盖：
//  - Word 二进制：Word 97-2003 走 CLX 分片表（正确处理压缩/Unicode 混合编码）；
//    Word 6/95（nFib<193）走 fcMin..fcMac 连续区间（8-bit ANSI）。
//  - PowerPoint 二进制：递归遍历记录树，抽取 TextCharsAtom(UTF-16LE) / TextBytesAtom / CString。
//  - 兜底：对 OLE 内全部流做「可打印字符串扫描」（ASCII 与 UTF-16LE 两路）。
//
// 设计原则：任何结构异常/加密/解析失败都绝不抛错，始终返回「尽力而为」的文本，
// 以彻底消除 "Invalid magic number: a5dc" 这类面向旧格式的报错。仅供后端文本提取使用。

import { readFileSync } from 'node:fs';
import * as CFB from 'cfb';

/** 处理的 OLE 文档类别 */
export type OleKind = 'word' | 'ppt' | 'auto';

// ── 小端读取 ────────────────────────────────────────────────────────────────
function readU16(b: Uint8Array, o: number): number {
  return b[o] | (b[o + 1] << 8);
}
function readU32(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}
/** 有符号 32 位（FIB 中的 fcClx/lcbClx 为 i32） */
function readI32(b: Uint8Array, o: number): number {
  return b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24);
}

function toU8(content: CFB.CFB$Blob): Uint8Array {
  return content instanceof Uint8Array ? content : Uint8Array.from(content);
}

function latin1(b: Uint8Array): string {
  return Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString('latin1');
}
function utf16le(b: Uint8Array): string {
  return Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString('utf16le');
}

/** 控制字符占比（用于在 latin1/utf16 间选择更可读的解码） */
function controlRatio(s: string): number {
  if (s.length === 0) return 1;
  let bad = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    if (c === 0xfffd) bad++;
    else if (c < 0x20 && ch !== '\r' && ch !== '\n' && ch !== '\t') bad++;
    else if (c === 0x7f) bad++;
  }
  return bad / s.length;
}

/** 连续区间解码：优先 latin1；控制字符过多时尝试 utf16le 取更优者 */
function decodeRange(bytes: Uint8Array): string {
  const a = latin1(bytes);
  if (controlRatio(a) < 0.1) return a;
  const b = utf16le(bytes);
  return controlRatio(b) < controlRatio(a) ? b : a;
}

// ── Word 二进制 ─────────────────────────────────────────────────────────────
/** 解析 CLX（位于 table 流），取出分片文本 */
function parsePieceTable(table: Uint8Array, start: number, lcb: number, wordDoc: Uint8Array): string {
  if (lcb < 12) return '';
  const n = Math.floor((lcb - 4) / 12);
  if (n <= 0) return '';
  const cpBase = start;
  const pcdBase = start + 4 * (n + 1);
  let out = '';
  for (let i = 0; i < n; i++) {
    const cpStart = readU32(table, cpBase + i * 4);
    const cpEnd = readU32(table, cpBase + (i + 1) * 4);
    const charCount = cpEnd - cpStart;
    if (charCount <= 0 || charCount > 20_000_000) continue;
    const fc = readU32(table, pcdBase + i * 8 + 2);
    const compressed = (fc & 0x40000000) !== 0;
    if (compressed) {
      const off = Math.floor((fc & 0x3fffffff) / 2);
      if (off + charCount > wordDoc.length) continue;
      out += latin1(wordDoc.subarray(off, off + charCount));
    } else {
      const off = fc & 0x3fffffff;
      if (off + charCount * 2 > wordDoc.length) continue;
      out += utf16le(wordDoc.subarray(off, off + charCount * 2));
    }
  }
  return out;
}

/** 从 CLX 定位 Pcdt(0x02) 并解析分片表（跳过前置 Prc 0x01 记录） */
function parseClx(table: Uint8Array, fcClx: number, lcbClx: number, wordDoc: Uint8Array): string {
  const end = Math.min(fcClx + lcbClx, table.length);
  let pos = fcClx;
  let guard = 0;
  while (pos < end && guard++ < 10000) {
    const tag = table[pos];
    if (tag === 0x01) {
      if (pos + 3 > end) break;
      pos += 3 + readU16(table, pos + 1);
      continue;
    }
    if (tag === 0x02) {
      if (pos + 5 > end) break;
      const lcb = readU32(table, pos + 1);
      const pcdtStart = pos + 5;
      if (pcdtStart + lcb > table.length) break;
      return parsePieceTable(table, pcdtStart, lcb, wordDoc);
    }
    break;
  }
  return '';
}

/** Word 文本提取（WordDocument 流 + 可选 table 流） */
function extractWordText(wordDoc: Uint8Array, table: Uint8Array | null): string {
  if (wordDoc.length < 0x20) return '';
  const nFib = readU16(wordDoc, 2);
  const flags = readU16(wordDoc, 10);
  if ((flags & 0x0100) !== 0) return ''; // fEncrypted：加密文档，交给兜底扫描

  const fcMin = readU32(wordDoc, 0x18);
  const fcMac = readU32(wordDoc, 0x1c);

  // Word 97+：CLX 分片表
  if (nFib >= 193 && table && wordDoc.length >= 0x01aa) {
    const fcClx = readI32(wordDoc, 0x01a2);
    const lcbClx = readI32(wordDoc, 0x01a6);
    if (fcClx > 0 && lcbClx > 0 && fcClx + lcbClx <= table.length) {
      const text = parseClx(table, fcClx, lcbClx, wordDoc);
      if (text.trim()) return text;
    }
  }

  // Word 6/95 及退化路径：fcMin..fcMac 连续区间
  const start = Math.min(Math.max(fcMin, 0), wordDoc.length);
  const stop = Math.min(Math.max(fcMac, 0), wordDoc.length);
  if (stop > start) return decodeRange(wordDoc.subarray(start, stop));
  return '';
}

// ── PowerPoint 二进制 ───────────────────────────────────────────────────────
function cleanText(s: string): string {
  return s
    .replace(/^\u0000+|\u0000+$/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u000b/g, '\n')
    .trim();
}

/** 递归遍历 PPT 记录树，抽取文本原子 */
function walkPpt(b: Uint8Array, start: number, end: number, out: string[], depth: number): void {
  if (depth > 48) return;
  let offset = start;
  let guard = 0;
  while (offset + 8 <= end && guard++ < 500000) {
    const verInst = readU16(b, offset);
    const recType = readU16(b, offset + 2);
    const recLen = readU32(b, offset + 4);
    const recVer = verInst & 0x000f;
    const dataStart = offset + 8;
    const dataEnd = dataStart + recLen;
    if (dataEnd > end) break; // 结构损坏：停止该层

    if (recVer === 0x000f) {
      walkPpt(b, dataStart, dataEnd, out, depth + 1);
    } else if (recType === 0x0fa0) {
      // TextCharsAtom：UTF-16LE
      const t = cleanText(utf16le(b.subarray(dataStart, dataEnd)));
      if (t) out.push(t);
    } else if (recType === 0x0fa8) {
      // TextBytesAtom：单字节（ANSI）
      const t = cleanText(latin1(b.subarray(dataStart, dataEnd)));
      if (t) out.push(t);
    } else if (recType === 0x0fba) {
      // CString：单字节
      const t = cleanText(latin1(b.subarray(dataStart, dataEnd)));
      if (t) out.push(t);
    }

    offset = dataEnd;
    if (recLen === 0) break; // 空记录：避免死循环
  }
}

// ── 兜底：全流可打印字符串扫描 ──────────────────────────────────────────────
function scanAscii(b: Uint8Array, minRun = 5): string[] {
  const runs: string[] = [];
  let cur = '';
  for (let i = 0; i < b.length; i++) {
    const c = b[i];
    if (c >= 0x20 && c < 0x7f) cur += String.fromCharCode(c);
    else if (c === 0x09 || c === 0x0a || c === 0x0d) {
      if (cur) cur += ' ';
    } else {
      if (cur.length >= minRun) runs.push(cur.trim());
      cur = '';
    }
  }
  if (cur.length >= minRun) runs.push(cur.trim());
  return runs.filter((r) => r.length >= minRun);
}

function scanUtf16(b: Uint8Array, minRun = 4): string[] {
  const runs: string[] = [];
  let cur = '';
  for (let i = 0; i + 1 < b.length; i += 2) {
    const c = b[i];
    const hi = b[i + 1];
    if (hi === 0 && c >= 0x20 && c !== 0x7f) cur += String.fromCharCode(c);
    else if (hi === 0 && (c === 9 || c === 10 || c === 13)) {
      if (cur) cur += ' ';
    } else {
      if (cur.length >= minRun) runs.push(cur.trim());
      cur = '';
    }
  }
  if (cur.length >= minRun) runs.push(cur.trim());
  return runs.filter((r) => r.length >= minRun);
}

function extractGenericStrings(entries: CFB.CFB$Entry[]): string {
  const chunks: string[] = [];
  for (const e of entries) {
    if (e.type !== 2 || !e.content) continue; // 2 = stream
    const bytes = toU8(e.content);
    if (bytes.length === 0) continue;
    const ascii = scanAscii(bytes);
    const utf16 = scanUtf16(bytes);
    for (const s of ascii) chunks.push(s);
    for (const s of utf16) chunks.push(s);
  }
  // 去重（保持顺序）
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of chunks) {
    if (s.length >= 4 && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out.join('\n');
}

// ── 入口 ────────────────────────────────────────────────────────────────────
function findEntry(cfb: CFB.CFB$Container, name: string): Uint8Array | null {
  const entry = CFB.find(cfb, name) ?? CFB.find(cfb, `/${name}`);
  return entry && entry.content ? toU8(entry.content) : null;
}

function findStream(cfb: CFB.CFB$Container, re: RegExp): Uint8Array | null {
  for (const full of cfb.FullPaths) {
    const base = full.split('/').pop() ?? full;
    if (re.test(base)) {
      const entry = CFB.find(cfb, full);
      if (entry && entry.content) return toU8(entry.content);
    }
  }
  return null;
}

/**
 * 提取 OLE 文档文本。
 * @param path 文件路径
 * @param kind 'word' | 'ppt' | 'auto'（auto 依据内部流名推断）
 * @returns 尽力提取的文本（解析失败/非 OLE/加密时可能为空串，绝不抛错）
 */
export function extractOleText(path: string, kind: OleKind = 'auto'): string {
  let bytes: Uint8Array;
  try {
    const buf = readFileSync(path);
    bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  } catch {
    return '';
  }
  // OLE 魔数：D0 CF 11 E0 A1 B1 1A E1
  if (!(bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0)) {
    return '';
  }

  let cfb: CFB.CFB$Container;
  try {
    cfb = CFB.read(bytes, { type: 'buffer' });
  } catch {
    return '';
  }

  const resolved: 'word' | 'ppt' =
    kind !== 'auto'
      ? kind
      : findStream(cfb, /^WordDocument$/i)
        ? 'word'
        : findStream(cfb, /PowerPoint Document/i)
          ? 'ppt'
          : 'word';

  let text = '';
  try {
    if (resolved === 'word') {
      const wordDoc = findEntry(cfb, 'WordDocument') ?? findStream(cfb, /WordDocument/i);
      if (wordDoc) {
        const flags = wordDoc.length >= 12 ? readU16(wordDoc, 10) : 0;
        const whichTable = (flags & 0x0200) !== 0;
        const table =
          findEntry(cfb, whichTable ? '1Table' : '0Table') ?? findEntry(cfb, '0Table') ?? findEntry(cfb, '1Table');
        text = extractWordText(wordDoc, table);
      }
    } else {
      const ppt = findEntry(cfb, 'PowerPoint Document') ?? findStream(cfb, /PowerPoint Document/i);
      if (ppt) {
        const out: string[] = [];
        walkPpt(ppt, 0, ppt.length, out, 0);
        text = out.join('\n');
      }
    }
  } catch {
    text = '';
  }

  if (!text.trim()) {
    try {
      text = extractGenericStrings(cfb.FileIndex);
    } catch {
      text = '';
    }
  }
  return text;
}