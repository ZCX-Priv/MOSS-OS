// read/handlers/text.ts
// 文本文件处理：编码检测（UTF-8/GBK）、minified 检测、三种读取模式。
// 复用 utils/encoding.ts 的 decodeShellOutput（含 GBK 回退）和 utils/fs.ts 的 isBinaryFile。
// 路径：read/handlers/text.ts → src/utils = ../../../../../utils

import { readFileSync, type Stats } from 'node:fs';
import { isBinaryFile } from '../../../../../utils/fs';
import { decodeShellOutput, stripBom } from '../../../../../utils/encoding';
import { detectMinified, truncateMinifiedLines } from '../shared/minified';
import type { ToolResult } from '../../../types';

/** text handler 需要的参数子集 */
export interface TextParams {
  /** 读取模式 */
  mode?: 'full' | 'precise' | 'indentation';
  /** 精确模式：开始行号；indentation 模式：锚点行号（1-based） */
  offset?: number;
  /** 精确模式：读取行数 */
  limit?: number;
}

/**
 * 读取文本文件。
 * 自动检测编码：UTF-8 直接使用，非 UTF-8（如 GBK）通过 decodeShellOutput 回退解码。
 * 二进制文件（无法解码为文本）返回错误。
 */
export async function readText(
  path: string,
  params: TextParams,
  _stat: Stats,
): Promise<ToolResult> {
  // 1. 二进制检测（detector 未识别的非文本类型会回退到这里）
  if (isBinaryFile(path)) {
    // 尝试编码检测：可能是 GBK 等非 UTF-8 编码
    // decodeShellOutput 会尝试 GBK 回退解码
    const buf = readFileSync(path);
    try {
      const decoded = decodeShellOutput(buf);
      // 检查解码结果是否包含 CJK 字符（确认是非 UTF-8 中文编码）
      if (decoded && /[\u4e00-\u9fff]/.test(decoded)) {
        return processText(path, stripBom(decoded), params);
      }
    } catch {
      // 解码失败，继续到二进制拒绝
    }
    return {
      content: [{ type: 'text', text: `Error: binary file detected, cannot read as text: ${path}` }],
      isError: true,
    };
  }

  // 2. 读取文件并检测编码
  const buf = readFileSync(path);
  const content = stripBom(decodeShellOutput(buf));
  return processText(path, content, params);
}

/**
 * 根据模式处理文本内容。
 */
function processText(path: string, content: string, params: TextParams): ToolResult {
  const mode = params.mode ?? 'full';

  if (mode === 'precise') {
    return preciseMode(path, content, params.offset ?? 1, params.limit ?? 2000);
  }
  if (mode === 'indentation') {
    return indentationMode(path, content, params.offset ?? 1);
  }
  return fullMode(path, content);
}

/**
 * 全量模式：完整返回所有行，带行号，不限制行数。
 * minified 文件检测到后截断超长行并提示。
 */
function fullMode(path: string, content: string): ToolResult {
  // minified 检测
  const { isMinified } = detectMinified(content);
  let text = content;
  let truncated = false;
  if (isMinified) {
    const r = truncateMinifiedLines(content);
    text = r.text;
    truncated = r.truncated;
  }

  // 带行号
  const lines = text.split('\n');
  const width = String(lines.length).length;
  const numbered = lines
    .map((line, i) => `${String(i + 1).padStart(width, ' ')}→${line}`)
    .join('\n');
  const header = `${path} (${lines.length} lines${truncated ? ', minified-truncated' : ''})\n`;

  let suffix = '';
  if (isMinified) {
    suffix = '\n\n[提示] 检测到 minified 文件，超长行已截断。建议使用 grep 工具搜索特定内容，或写个程序解析该文件。';
  }

  return {
    content: [{ type: 'text', text: header + numbered + suffix }],
    metadata: { mode: 'full', totalLines: lines.length, minified: isMinified },
  };
}

/**
 * 精确模式：offset+limit 指定行范围，带行号。
 */
function preciseMode(
  path: string,
  content: string,
  offset: number,
  limit: number,
): ToolResult {
  const lines = content.split('\n');
  const start = Math.max(0, offset - 1);
  const end = Math.min(lines.length, start + limit);
  const slice = lines.slice(start, end);
  const width = String(end).length;
  const text = slice
    .map((line, i) => `${String(start + i + 1).padStart(width, ' ')}→${line}`)
    .join('\n');
  const header = `${path} (lines ${offset}-${offset + slice.length - 1} of ${lines.length})\n`;

  return {
    content: [{ type: 'text', text: header + text }],
    metadata: {
      mode: 'precise',
      offset,
      limit,
      totalLines: lines.length,
      returnedLines: slice.length,
    },
  };
}

/**
 * indentation 模式：基于锚点行号，提取包含该行的完整缩进代码块。
 * 算法：以锚点行缩进为基准，向上扩展到更小或同等缩进的起点，
 * 向下扩展到同等缩进范围结束（参考 Roo Code 的 indentation 模式）。
 */
function indentationMode(path: string, content: string, anchorLine: number): ToolResult {
  const lines = content.split('\n');
  const anchor = anchorLine - 1; // 转为 0-based

  if (anchor < 0 || anchor >= lines.length) {
    return {
      content: [{ type: 'text', text: `Error: invalid anchor line ${anchorLine} (file has ${lines.length} lines)` }],
      isError: true,
    };
  }

  /** 获取第 i 行的缩进宽度（空格+制表符数） */
  const indentOf = (i: number): number => {
    const m = lines[i].match(/^(\s*)/);
    return m ? m[1].length : 0;
  };

  const anchorIndent = indentOf(anchor);

  // 向上找块起点：遇到缩进 < anchorIndent 的非空行停止（它不属于本块）
  let start = anchor;
  while (start > 0) {
    const prev = start - 1;
    const prevLine = lines[prev];
    if (prevLine.trim() === '') {
      // 空行跳过（继续向上找）
      start = prev;
      continue;
    }
    if (indentOf(prev) < anchorIndent) {
      // 缩进更小，属于外层，停止
      break;
    }
    start = prev;
  }

  // 向下找块终点：遇到缩进 < anchorIndent 的非空行停止
  let end = anchor;
  while (end < lines.length - 1) {
    const next = end + 1;
    const nextLine = lines[next];
    if (nextLine.trim() === '') {
      // 空行跳过（继续向下找）
      end = next;
      continue;
    }
    if (indentOf(next) < anchorIndent) {
      // 缩进更小，属于外层，停止
      break;
    }
    end = next;
  }

  const block = lines.slice(start, end + 1);
  const width = String(end + 1).length;
  const text = block
    .map((line, i) => `${String(start + i + 1).padStart(width, ' ')}→${line}`)
    .join('\n');
  const header = `${path} (indentation block lines ${start + 1}-${end + 1} of ${lines.length})\n`;

  return {
    content: [{ type: 'text', text: header + text }],
    metadata: {
      mode: 'indentation',
      anchor: anchorLine,
      startLine: start + 1,
      endLine: end + 1,
      totalLines: lines.length,
    },
  };
}
