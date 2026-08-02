// src/plugins/llm/stream.ts
// SSE 流式响应统一解析。
// 把 HTTP 响应的 ReadableStream 解析为 SSE 事件序列。

/**
 * 把 ReadableStream<Uint8Array> 转换为 SSE 事件字符串的异步迭代器。
 * SSE 协议：
 *  - 事件以 \n\n 分隔
 *  - 每行格式 "data: <text>" 或 "event: <name>" 或 ":comment"
 *  - "data: [DONE]" 表示流结束
 */
export async function* parseSSEStream(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // 按事件分隔符 \n\n 切分
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const eventText = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const data = extractDataField(eventText);
        if (data !== null) {
          if (data === '[DONE]') return;
          yield data;
        }
      }
    }
    // 处理剩余 buffer
    if (buffer.trim()) {
      const data = extractDataField(buffer);
      if (data !== null && data !== '[DONE]') yield data;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * 从 SSE 事件文本中提取 data: 字段内容。
 * 多行 data: 用 \n 连接（按 SSE 规范）。
 */
function extractDataField(eventText: string): string | null {
  const lines = eventText.split('\n');
  const dataLines: string[] = [];
  for (const line of lines) {
    const trimmed = line.replace(/\r$/, '');
    if (trimmed.startsWith(':')) continue; // 注释
    if (trimmed.startsWith('data:')) {
      dataLines.push(trimmed.slice(5).replace(/^\s/, ''));
    }
    // 忽略 event: id: retry: 等其他字段（多数 LLM API 只用 data:）
  }
  return dataLines.length > 0 ? dataLines.join('\n') : null;
}
