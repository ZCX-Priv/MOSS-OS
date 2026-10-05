// render/latex/LatexPreview.tsx
// LaTeX 源码预览：把 .tex/.latex/.ltx 渲染为「公式 + 结构化文档」，而非裸文本。
//
// 解析策略（纯前端、无新依赖）：
//  1. 取 \begin{document}…\end{document} 之间为正文（无则用全文）；
//  2. 行级状态机识别显示公式：$$…$$、\[…\]、\begin{equation|align|gather|eqnarray|multline|displaymath|matrix 系列}；
//  3. 识别 \section/\subsection/\subsubsection 标题、itemize/enumerate 列表；
//  4. 段落内识别行内公式（$…$ / \(…\)）与 \textbf/\emph/\textit/\underline/\texttt；
//  5. 公式统一交给 MathSpan（KaTeX 优先，失败懒加载 MathJax 回退）渲染；
//  6. 顶部工具栏可切换「渲染 / 源码」（源码走 CodeFileViewer）。
// 解析失败/未知命令不报错：保留原始文本（结构语义不丢）。
// 本组件经 React.lazy 懒加载（FilePreviewPane 分发）。

import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { FileCode2, Sigma } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { MathSpan } from '../math/MathSpan';
import { CodeFileViewer } from '../code/CodeFileViewer';

export interface LatexPreviewProps {
  text: string;
  /** 展示用文件名（源码模式传给 CodeFileViewer 决定高亮语言） */
  path: string;
}

// ── 通用工具 ────────────────────────────────────────────────────────────────
/** 返回下标 braceOpen（指向 '{'）对应的匹配 '}' 下标；无匹配返回 -1 */
function matchBrace(src: string, braceOpen: number): number {
  let depth = 0;
  for (let i = braceOpen; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** 去掉行内注释（未转义的 % 起） */
function stripComment(line: string): string {
  let out = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '\\' && i + 1 < line.length) {
      out += c + line[i + 1];
      i++;
      continue;
    }
    if (c === '%') break;
    out += c;
  }
  return out;
}

/** 转义字符 → 原始字符 */
function unescapeLatex(s: string): string {
  return s.replace(/\\([%_&#{}~$])/g, (_m, c: string) => (c === '~' ? '\u00a0' : c));
}

// ── 行内片段（文本 / 行内公式）────────────────────────────────────────────────
type InlinePart = { kind: 'text' | 'math'; value: string };

function splitInlineMath(src: string): InlinePart[] {
  const parts: InlinePart[] = [];
  let buf = '';
  let i = 0;
  while (i < src.length) {
    if (src[i] === '\\' && src[i + 1] === '$') {
      buf += '$';
      i += 2;
      continue;
    }
    if (src[i] === '\\' && src[i + 1] === '(') {
      const end = src.indexOf('\\)', i + 2);
      if (end !== -1) {
        if (buf) {
          parts.push({ kind: 'text', value: buf });
          buf = '';
        }
        parts.push({ kind: 'math', value: src.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    }
    if (src[i] === '$') {
      const end = src.indexOf('$', i + 1);
      if (end > i + 1) {
        if (buf) {
          parts.push({ kind: 'text', value: buf });
          buf = '';
        }
        parts.push({ kind: 'math', value: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    buf += src[i];
    i++;
  }
  if (buf) parts.push({ kind: 'text', value: buf });
  return parts;
}

/** 处理 \textbf/\emph/\textit/\underline/\texttt 与 \\ 换行；返回 React 节点 */
function renderFormatted(src: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\\(textbf|textit|emph|underline|texttt|textsc)\{/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const start = m.index;
    if (start > last) out.push(renderPlain(unescapeLatex(src.slice(last, start)), `${keyPrefix}-p${start}`));
    const braceOpen = re.lastIndex - 1;
    const end = matchBrace(src, braceOpen);
    if (end === -1) {
      out.push(renderPlain(unescapeLatex(src.slice(start)), `${keyPrefix}-tail`));
      last = src.length;
      break;
    }
    const inner = src.slice(braceOpen + 1, end);
    const cmd = m[1];
    const content = renderFormatted(inner, `${keyPrefix}-${start}`);
    const key = `${keyPrefix}-${start}`;
    if (cmd === 'emph' || cmd === 'textit') out.push(<em key={key}>{content}</em>);
    else if (cmd === 'underline') out.push(<u key={key}>{content}</u>);
    else if (cmd === 'texttt') out.push(<code key={key} className="rounded bg-muted px-1 py-0.5 text-[0.9em]">{content}</code>);
    else if (cmd === 'textsc') out.push(<span key={key} className="uppercase">{content}</span>);
    else out.push(<strong key={key}>{content}</strong>);
    last = end + 1;
    re.lastIndex = last;
  }
  if (last < src.length) out.push(renderPlain(unescapeLatex(src.slice(last)), `${keyPrefix}-end`));
  return out;
}

/** 纯文本（含 \\ 换行处理） */
function renderPlain(text: string, keyPrefix: string): ReactNode {
  const pieces = text.split(/\\\\/);
  if (pieces.length === 1) return pieces[0];
  return (
    <Fragment key={keyPrefix}>
      {pieces.map((piece, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          {piece}
        </Fragment>
      ))}
    </Fragment>
  );
}

/** 段落内容：拆分行内公式 + 文本格式化 */
function renderInline(src: string, keyPrefix: string): ReactNode[] {
  return splitInlineMath(src).map((part, i) =>
    part.kind === 'math' ? (
      <MathSpan key={`${keyPrefix}-m${i}`} tex={part.value} display={false} closed />
    ) : (
      <Fragment key={`${keyPrefix}-t${i}`}>{renderFormatted(part.value, `${keyPrefix}-t${i}`)}</Fragment>
    ),
  );
}

// ── 块级解析 ────────────────────────────────────────────────────────────────
type LatexNode =
  | { type: 'title'; title: string; author: string | null; date: string | null }
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'math'; tex: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] };

const MATH_ENV =
  '(equation\\*?|align\\*?|gather\\*?|eqnarray\\*?|multline\\*?|displaymath|math|split|aligned|cases|array|pmatrix|bmatrix|vmatrix|Vmatrix|matrix)';

/** 取 \cmd{...} 的参数字符串（在全文范围内首个匹配） */
function grabBraced(full: string, cmd: string): string | null {
  const m = new RegExp(`\\\\${cmd}\\{`).exec(full);
  if (!m) return null;
  const braceOpen = m.index + m[0].length - 1;
  const end = matchBrace(full, braceOpen);
  return end === -1 ? null : full.slice(braceOpen + 1, end).replace(/\s+/g, ' ').trim();
}

function parseLatex(full: string): LatexNode[] {
  const nodes: LatexNode[] = [];

  // 文档头信息（通常在导言区，正文裁剪后不可见，故从全文提取）
  const title = grabBraced(full, 'title');
  if (title) {
    nodes.push({ type: 'title', title, author: grabBraced(full, 'author'), date: grabBraced(full, 'date') });
  }

  // 取 document 环境内部正文
  const beginDoc = full.search(/\\begin\{document\}/);
  const body =
    beginDoc === -1
      ? full
      : full.slice(beginDoc).replace(/^\\begin\{document\}/, '').replace(/\\end\{document\}[\s\S]*$/, '');

  const lines = body.split(/\r?\n/);
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    const text = paragraph.join(' ').trim();
    if (text) nodes.push({ type: 'paragraph', text });
    paragraph = [];
  };
  const flushList = () => {
    if (list && list.items.length) nodes.push({ type: 'list', ordered: list.ordered, items: list.items });
    list = null;
  };

  let i = 0;
  while (i < lines.length) {
    const line = stripComment(lines[i]);
    const trimmed = line.trim();

    // 显示公式环境
    const envStart = new RegExp(`^\\\\begin\\{${MATH_ENV}\\}`).exec(trimmed);
    if (envStart) {
      flushParagraph();
      flushList();
      const env = envStart[1];
      const endMarker = `\\end{${env}}`;
      const after = trimmed.slice(envStart[0].length);
      const collected: string[] = [];
      const samePos = after.indexOf(endMarker);
      if (samePos !== -1) {
        collected.push(after.slice(0, samePos));
        i++;
      } else {
        collected.push(after);
        i++;
        while (i < lines.length) {
          const l = stripComment(lines[i]);
          const p = l.indexOf(endMarker);
          if (p !== -1) {
            collected.push(l.slice(0, p));
            i++;
            break;
          }
          collected.push(l);
          i++;
        }
      }
      nodes.push({ type: 'math', tex: collected.join('\n').trim() });
      continue;
    }

    // $$ … $$
    if (trimmed.startsWith('$$')) {
      flushParagraph();
      flushList();
      const after = trimmed.slice(2);
      const samePos = after.indexOf('$$');
      const collected: string[] = [];
      if (samePos !== -1) {
        collected.push(after.slice(0, samePos));
        i++;
      } else {
        collected.push(after);
        i++;
        while (i < lines.length) {
          const l = stripComment(lines[i]);
          const p = l.indexOf('$$');
          if (p !== -1) {
            collected.push(l.slice(0, p));
            i++;
            break;
          }
          collected.push(l);
          i++;
        }
      }
      nodes.push({ type: 'math', tex: collected.join('\n').trim() });
      continue;
    }

    // \[ … \]
    const dispOpen = trimmed.indexOf('\\[');
    if (dispOpen !== -1) {
      flushParagraph();
      flushList();
      const after = trimmed.slice(dispOpen + 2);
      const samePos = after.indexOf('\\]');
      const collected: string[] = [];
      if (samePos !== -1) {
        collected.push(after.slice(0, samePos));
        i++;
      } else {
        collected.push(after);
        i++;
        while (i < lines.length) {
          const l = stripComment(lines[i]);
          const p = l.indexOf('\\]');
          if (p !== -1) {
            collected.push(l.slice(0, p));
            i++;
            break;
          }
          collected.push(l);
          i++;
        }
      }
      nodes.push({ type: 'math', tex: collected.join('\n').trim() });
      continue;
    }

    // 标题
    const sec = /^\\(chapter|section|subsection|subsubsection|paragraph)\*?\{(.*)\}\s*$/.exec(trimmed);
    if (sec) {
      flushParagraph();
      flushList();
      const cmd = sec[1];
      const level: 1 | 2 | 3 = cmd === 'subsection' ? 2 : cmd === 'subsubsection' || cmd === 'paragraph' ? 3 : 1;
      nodes.push({ type: 'heading', level, text: sec[2].trim() });
      i++;
      continue;
    }

    // 列表
    if (new RegExp(`^\\\\begin\\{(itemize|enumerate)\\}`).test(trimmed)) {
      flushParagraph();
      flushList();
      list = { ordered: trimmed.includes('enumerate'), items: [] };
      i++;
      continue;
    }
    if (/^\\end\{(itemize|enumerate)\}/.test(trimmed)) {
      flushList();
      i++;
      continue;
    }
    if (/^\\item\b/.test(trimmed)) {
      flushParagraph();
      if (!list) list = { ordered: false, items: [] };
      list.items.push(trimmed.replace(/^\\item\s*(\[[^\]]*\])?/, '').trim());
      i++;
      continue;
    }

    // 空行：结束段落/列表
    if (trimmed === '') {
      flushParagraph();
      flushList();
      i++;
      continue;
    }

    // 无输出意义的导言类命令：整行忽略
    if (
      /^\\(documentclass|usepackage|RequirePackage|newcommand|renewcommand|providecommand|def|let|setlength|addtolength|pagestyle|thispagestyle|bibliography|bibliographystyle|label|index|vspace|hspace|noindent|centering|maketitle|tableofcontents|clearpage|newpage|linebreak|pagebreak)\b/.test(
        trimmed,
      )
    ) {
      i++;
      continue;
    }

    // 列表续行
    if (list && list.items.length > 0) {
      list.items[list.items.length - 1] += ` ${trimmed}`;
      i++;
      continue;
    }

    paragraph.push(trimmed);
    i++;
  }

  flushParagraph();
  flushList();
  return nodes;
}

// ── 渲染 ────────────────────────────────────────────────────────────────────
export function LatexPreview({ text, path }: LatexPreviewProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'render' | 'source'>('render');
  const nodes = useMemo(() => parseLatex(text), [text]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2 py-1.5">
        <Button
          variant={mode === 'render' ? 'default' : 'outline'}
          size="sm"
          className="h-7 gap-1 px-2.5 text-xs"
          onClick={() => setMode('render')}
        >
          <Sigma className="size-3.5" />
          {t('preview.latexRendered')}
        </Button>
        <Button
          variant={mode === 'source' ? 'default' : 'outline'}
          size="sm"
          className="h-7 gap-1 px-2.5 text-xs"
          onClick={() => setMode('source')}
        >
          <FileCode2 className="size-3.5" />
          {t('preview.latexSource')}
        </Button>
      </div>

      {mode === 'source' ? (
        <div className="min-h-0 flex-1">
          <CodeFileViewer text={text} path={path} />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto rounded border border-border bg-background px-4 py-3">
          {nodes.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">{t('preview.loading')}</div>
          ) : (
            <div className="mx-auto flex max-w-3xl flex-col gap-3">
              {nodes.map((node, i) => renderNode(node, i))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function renderNode(node: LatexNode, key: number): ReactNode {
  switch (node.type) {
    case 'title':
      return (
        <div key={key} className="flex flex-col items-center gap-1 border-b border-border/60 pb-3 text-center">
          <div className="text-xl font-semibold text-foreground">{renderFormatted(node.title, `ti${key}`)}</div>
          {node.author && <div className="text-sm text-muted-foreground">{renderFormatted(node.author, `au${key}`)}</div>}
          {node.date && <div className="text-xs text-muted-foreground">{renderFormatted(node.date, `da${key}`)}</div>}
        </div>
      );
    case 'heading': {
      const cls =
        node.level === 1
          ? 'text-lg font-semibold'
          : node.level === 2
            ? 'text-base font-semibold'
            : 'text-sm font-semibold';
      const Tag: 'h2' | 'h3' | 'h4' = node.level === 1 ? 'h2' : node.level === 2 ? 'h3' : 'h4';
      return (
        <Tag key={key} className={`${cls} text-foreground`}>
          {renderFormatted(node.text, `h${key}`)}
        </Tag>
      );
    }
    case 'math':
      return (
        <div key={key} className="overflow-x-auto py-1">
          <MathSpan tex={node.tex} display closed />
        </div>
      );
    case 'list':
      return node.ordered ? (
        <ol key={key} className="ml-5 list-decimal text-sm text-foreground">
          {node.items.map((item, i) => (
            <li key={i} className="leading-relaxed">
              {renderInline(item, `oli${key}-${i}`)}
            </li>
          ))}
        </ol>
      ) : (
        <ul key={key} className="ml-5 list-disc text-sm text-foreground">
          {node.items.map((item, i) => (
            <li key={i} className="leading-relaxed">
              {renderInline(item, `uli${key}-${i}`)}
            </li>
          ))}
        </ul>
      );
    case 'paragraph':
      return (
        <p key={key} className="text-sm leading-relaxed text-foreground">
          {renderInline(node.text, `p${key}`)}
        </p>
      );
    default:
      return null;
  }
}