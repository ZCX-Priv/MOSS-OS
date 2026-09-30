// lib/attachment-block.ts
// 附件块文本格式的唯一真源：构建（发送端）+ 解析（渲染端/任务标题/队列预览）共用。
//
// 格式：`<正文>\n\n<标签行>\n- <绝对路径>\n- <绝对路径>…`
//   - 标签行以 `：`/`:` 结尾（文案随 i18n 变化，故按结构匹配，不硬编码"附件："）
//   - 路径行必须是「盘符绝对路径（C:\… / C:/…）」或「Unix 根路径（/…）」
//   - 只发附件不打字时正文为空：build 端产出 "\n\n附件：…"，但 useTask 的 content.trim()
//     会去掉前导空行 → 块落在消息开头。因此正则必须同时接受「开头」与「空行之后」。

const ATTACHMENT_BLOCK_RE =
  /(?:^|\n\n)(?:[^\n]+[:：])\n((?:- (?:[A-Za-z]:[\\/][^\n]+|\/[^\n]+)\n?)+)[\s]*$/;

/**
 * 构建附件块（不含与正文之间的空行；调用方负责拼 `${body}\n\n${block}`）。
 * 输出格式与历史实现逐字一致，保证 LLM 侧上下文契约不变。
 */
export function buildAttachmentBlock(paths: string[], label: string): string {
  return `${label}\n${paths.map((p) => `- ${p}`).join('\n')}`;
}

/**
 * 解析消息尾部（或开头）的附件块。
 * @returns 命中时返回 `{ body, paths }`（body 为剥离附件块后的正文，可能为空串）；未命中返回 null
 */
export function parseAttachmentBlock(content: string): { body: string; paths: string[] } | null {
  const m = ATTACHMENT_BLOCK_RE.exec(content);
  if (!m) return null;
  const paths = m[1]
    .split('\n')
    .map((l) => l.replace(/^- /, '').trim())
    .filter(Boolean);
  if (paths.length === 0) return null;
  return { body: content.slice(0, m.index), paths };
}

/** 仅取「剥离附件块后的正文」（未命中则原样返回）。用于任务标题 / 队列预览等无需路径的场景 */
export function stripAttachmentBlock(content: string): string {
  const parsed = parseAttachmentBlock(content);
  return parsed ? parsed.body : content;
}