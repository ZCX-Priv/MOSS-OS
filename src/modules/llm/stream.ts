// src/modules/llm/stream.ts
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

  /**
   * 从 buffer 头部切出一个完整 SSE 事件。
   * 兼容 \n\n 与 \r\n\r\n 两种分隔符（不同供应商实现各异），取先出现者。
   * 返回事件文本；无完整事件返回 null。
   */
  const shiftEvent = (): string | null => {
    const idxLF = buffer.indexOf('\n\n');
    const idxCRLF = buffer.indexOf('\r\n\r\n');
    if (idxLF === -1 && idxCRLF === -1) return null;
    const idx = idxCRLF === -1 ? idxLF : idxLF === -1 ? idxCRLF : Math.min(idxLF, idxCRLF);
    const sepLen = buffer[idx] === '\r' ? 4 : 2;
    const eventText = buffer.slice(0, idx);
    buffer = buffer.slice(idx + sepLen);
    return eventText;
  };

  // 空闲超时：响应头已返回但流中途停滞（弱网半开连接）时，取消读取避免无限挂起
  const IDLE_TIMEOUT_MS = 120_000;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const resetIdle = (): void => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      try {
        reader.cancel();
      } catch {
        // 忽略
      }
    }, IDLE_TIMEOUT_MS);
  };

  try {
    while (true) {
      resetIdle();
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let eventText: string | null;
      while ((eventText = shiftEvent()) !== null) {
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
    if (idleTimer) clearTimeout(idleTimer);
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
