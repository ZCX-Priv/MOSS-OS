// webui/src/lib/inject-block.ts
// 命令注入块的唯一真源：构建（发送端）+ 剥离（渲染端/标题/队列预览/搜索）。
//
// 背景：`/命令` 发送时要把「命令模板（$ARGUMENTS 已替换）」送进 LLM 上下文，
// 但 UI 只应显示用户自己写的内容。会话历史即多轮上下文，模板必须留在 content 里
// （丢了命令在后续轮次就失效），因此只能「UI 侧剥离」。
//
// 格式：`<可见正文>\n\n<<<MOSS-INJECT>>>\n<模板正文>`
//   - 哨兵是 ASCII 定界符（模板正文可能是任意自然语言，用文案定界会被误判）
//   - 块**尾部锚定**：剥离时取最后一个哨兵行起到结尾，正文中间出现同串也不受影响
//   - 与 attachment-block 的拼装顺序约定：`正文 + 附件块 + 注入块`（注入块必须在最后）
//     剥离顺序即：先注入块（尾）→ 再附件块（此时成为尾）

/** 命令注入块哨兵行（首尾独占一行） */
export const INJECT_SENTINEL = '<<<MOSS-INJECT>>>';

/** 构建注入块（不含与正文之间的空行；调用方负责拼 `${body}\n\n${block}`） */
export function buildInjectBlock(template: string): string {
  return `${INJECT_SENTINEL}\n${template}`;
}

/**
 * 剥离尾部注入块。
 * @returns 可见正文（未命中则原样返回）
 */
export function stripInjectBlock(content: string): string {
  const marker = `\n\n${INJECT_SENTINEL}\n`;
  const idx = content.lastIndexOf(marker);
  if (idx < 0) {
    // 兼容「注入块落在消息开头」（正文为空时 build 端产出 "\n\n<哨兵>"，
    // 上游 content.trim() 会去掉前导空行）
    if (content.startsWith(`${INJECT_SENTINEL}\n`)) return '';
    return content;
  }
  return content.slice(0, idx);
}