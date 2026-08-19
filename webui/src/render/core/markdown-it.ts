// render/core/markdown-it.ts
// markdown-it 单例 + 自定义扩展：
//   1. math_block（block rule）：行首 $$...$$（跨行/单行）与 \[...\] → math_block token
//   2. math_inline（ruler2 后处理）：$...$ 与 \(...\) → math_inline token（text token 内拆分，
//      天然跳过 code span / fence —— 它们在 inline 阶段已是独立 token）
//   3. file_ref（ruler2 后处理）：白名单扩展名的文件路径 → file_ref token（内联预览卡片）
//
// 安全：html:false —— 不解析原始 HTML；linkify 开（URL 自动成链）；typographer 关（防流式引号替换闪烁）。
// breaks:true —— 单换行渲染为 <br>（聊天场景；代码块/表格/列表不受影响）。

import MarkdownIt from 'markdown-it';

export const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
  breaks: true,
});

export type Token = ReturnType<typeof md.parse>[number];
export type InlineToken = NonNullable<Token['children']>[number];

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) {
    count++;
    i += needle.length;
  }
  return count;
}

// ============================================================================
// block rule：math_block（$$...$$ 与 \[...\]）—— 规则函数参数由 ruler 上下文类型推导
// ============================================================================

/** 行内容文本（去缩进缩进偏移） */
function lineTextOf(state: { bMarks: number[]; tShift: number[]; eMarks: number[]; src: string }, line: number): string {
  return state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
}

md.block.ruler.before(
  'fence',
  'math_block',
  (state, startLine, endLine, silent) => {
    const firstLine = lineTextOf(state, startLine);
    const trimmed = firstLine.trim();
    if (!trimmed.startsWith('$$')) return false;

    // 单行形态：$$...$$（首尾各一个 $$，中间有内容）
    if (trimmed.length >= 5 && trimmed.endsWith('$$') && countOccurrences(trimmed, '$$') === 2) {
      if (silent) return true;
      const token = state.push('math_block', 'math', 0);
      token.content = trimmed.slice(2, -2).trim();
      token.block = true;
      token.map = [startLine, startLine + 1];
      token.children = [];
      state.line = startLine + 1;
      return true;
    }

    // 跨行形态：找含 $$ 的闭合行（开栏行 $$ 之后的内容也计入公式）
    for (let line = startLine + 1; line < endLine; line++) {
      const text = lineTextOf(state, line);
      const closeIdx = text.indexOf('$$');
      if (closeIdx === -1) continue;
      if (silent) return true;
      const openIdx = firstLine.indexOf('$$');
      const parts = [
        firstLine.slice(openIdx + 2).trim(),
        state.getLines(startLine + 1, line, state.tShift[startLine], false).trim(),
        text.slice(0, closeIdx).trim(),
      ].filter((s) => s.length > 0);
      const token = state.push('math_block', 'math', 0);
      token.content = parts.join('\n');
      token.block = true;
      token.map = [startLine, line + 1];
      token.children = [];
      state.line = line + 1;
      return true;
    }
    return false;
  },
  { alt: ['paragraph', 'reference', 'blockquote', 'list'] },
);

md.block.ruler.before(
  'fence',
  'math_bracket',
  (state, startLine, endLine, silent) => {
    const firstLine = lineTextOf(state, startLine);
    if (!firstLine.trimStart().startsWith('\\[')) return false;

    const trimmed = firstLine.trim();
    if (trimmed.length >= 4 && trimmed.startsWith('\\[') && trimmed.endsWith('\\]')) {
      if (silent) return true;
      const token = state.push('math_block', 'math', 0);
      token.content = trimmed.slice(2, -2).trim();
      token.block = true;
      token.map = [startLine, startLine + 1];
      token.children = [];
      state.line = startLine + 1;
      return true;
    }

    for (let line = startLine; line < endLine; line++) {
      const text = lineTextOf(state, line);
      const searchFrom = line === startLine ? 2 : 0;
      const closeIdx = text.indexOf('\\]', searchFrom);
      if (closeIdx === -1) continue;
      if (silent) return true;
      const content = state
        .getLines(startLine, line + 1, state.tShift[startLine], false)
        .replace(/^\s*\\\[?/, '')
        .replace(/\\\]\s*$/, '')
        .trim();
      const token = state.push('math_block', 'math', 0);
      token.content = content;
      token.block = true;
      token.map = [startLine, line + 1];
      token.children = [];
      state.line = line + 1;
      return true;
    }
    return false;
  },
  { alt: ['paragraph', 'reference', 'blockquote', 'list'] },
);

// ============================================================================
// ruler2 后处理：math_inline（$...$ 与 \(...\)）+ file_ref（文件路径引用）
// ============================================================================

/** 行内 $ 公式：开界 $ 后非空白；闭界 $ 前非空白、后非字母数字（防 a$b / $10 and $20） */
function findInlineMathDollar(src: string, start: number): { end: number; tex: string } | null {
  if (start + 1 >= src.length || /\s/.test(src[start + 1])) return null;
  for (let i = start + 1; i < src.length; i++) {
    if (src[i] !== '$') continue;
    if (/\s/.test(src[i - 1])) continue;
    const next = src[i + 1];
    if (next !== undefined && /[0-9a-zA-Z]/.test(next)) continue;
    const tex = src.slice(start + 1, i);
    if (tex.length === 0 || tex.includes('\n')) return null;
    return { end: i, tex };
  }
  return null;
}

/** 行内 \(...\) 公式 */
function findInlineMathParen(src: string, start: number): { end: number; tex: string } | null {
  const close = src.indexOf('\\)', start + 2);
  if (close === -1) return null;
  const tex = src.slice(start + 2, close);
  if (tex.length === 0 || tex.includes('\n')) return null;
  return { end: close + 1, tex };
}

/** 文件引用：绝对路径（盘符 / ~ / /）或 ./ ../ 开头 + 白名单扩展名；前导须为行首/空白/开括号 */
const FILE_REF_RE =
  /(?:^|(?<=[\s(（\[【<“"‘']))((?:[A-Za-z]:[\\/]|~\/|\/|\.{1,2}\/)[^\s`*\[\](){}<>"'“”‘’]+?\.(?:docx|xlsx|pptx|pdf|glb|gltf|obj|stl|png|jpe?g|gif|webp|svg|txt|md))(?=[)\s.,;:!?，。；：！？）】》"”]|$)/gu;

interface ScanMatch {
  kind: 'math' | 'file';
  start: number;
  end: number; // 含
  value: string;
}

/** 在 text token 内容中扫描 math_inline / file_ref（单次遍历，math 优先） */
function scanInlineSpecials(src: string): ScanMatch[] {
  const matches: ScanMatch[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '$') {
      const prev = src[i - 1];
      if (prev === undefined || !/[0-9a-zA-Z]/.test(prev)) {
        const found = findInlineMathDollar(src, i);
        if (found) {
          matches.push({ kind: 'math', start: i, end: found.end, value: found.tex });
          i = found.end + 1;
          continue;
        }
      }
      i++;
      continue;
    }
    if (ch === '\\' && src[i + 1] === '(') {
      const found = findInlineMathParen(src, i);
      if (found) {
        matches.push({ kind: 'math', start: i, end: found.end - 1, value: found.tex });
        i = found.end + 1;
        continue;
      }
      i += 2;
      continue;
    }
    if (/[A-Za-z.~/]/.test(ch)) {
      FILE_REF_RE.lastIndex = i;
      const m = FILE_REF_RE.exec(src);
      if (m && m.index === i && m[1]) {
        matches.push({ kind: 'file', start: i, end: i + m[1].length - 1, value: m[1] });
        i += m[1].length;
        continue;
      }
    }
    i++;
  }
  return matches;
}

function makeTextToken(content: string): InlineToken {
  return {
    type: 'text',
    tag: '',
    attrs: null,
    map: null,
    nesting: 0,
    level: 0,
    children: null,
    content,
    markup: '',
    info: '',
    meta: null,
    block: false,
    hidden: false,
  } as InlineToken;
}

/** 把 inline children 中 text token 按 scanInlineSpecials 拆分 */
function splitTextTokenChildren(children: InlineToken[]): InlineToken[] {
  const out: InlineToken[] = [];
  for (const token of children) {
    if (token.type !== 'text' || !token.content) {
      out.push(token);
      continue;
    }
    const src = token.content;
    const matches = scanInlineSpecials(src);
    if (matches.length === 0) {
      out.push(token);
      continue;
    }
    let cursor = 0;
    for (const m of matches) {
      if (m.start > cursor) out.push(makeTextToken(src.slice(cursor, m.start)));
      const special = makeTextToken(m.value) as InlineToken;
      special.type = m.kind === 'math' ? 'math_inline' : 'file_ref';
      special.markup = src.slice(m.start, m.end + 1);
      out.push(special);
      cursor = m.end + 1;
    }
    if (cursor < src.length) out.push(makeTextToken(src.slice(cursor)));
  }
  return out;
}

md.core.ruler.push('inline_specials', (state) => {
  const walk = (tokens: Token[]): void => {
    for (const token of tokens) {
      if (token.type === 'inline' && token.children) {
        token.children = splitTextTokenChildren(token.children);
      } else if (token.children) {
        walk(token.children);
      }
    }
  };
  walk(state.tokens);
});

/** 解析块文本（MarkdownBlock 调用；env 未使用传空对象） */
export function parseBlock(raw: string): Token[] {
  return md.parse(raw, {});
}
