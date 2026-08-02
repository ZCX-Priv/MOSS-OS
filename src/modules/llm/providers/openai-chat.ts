// src/plugins/llm/providers/openai-chat.ts
// OpenAI Chat Completions provider。
// 兼容 DeepSeek、通义千问、智谱 GLM、Kimi 等。

import type {
  LLMProvider,
  ProviderConfig,
  ProviderFormat,
  StreamDelta,
  UnifiedMessage,
  UnifiedRequest,
  UnifiedResponse,
  UnifiedToolCall,
  UnifiedUsage,
  ThinkingConfig,
} from '../types';

export class OpenAIChatProvider implements LLMProvider {
  readonly format: ProviderFormat = 'openai-chat';

  transformRequest(req: UnifiedRequest, cfg: ProviderConfig): unknown {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages.map(toOpenAIMessage),
      stream: req.stream,
    };
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.max_tokens !== undefined) body.max_tokens = req.max_tokens;
    if (req.top_p !== undefined) body.top_p = req.top_p;
    if (req.tools && req.tools.length > 0) {
      body.tools = req.tools.map(t => ({
        type: 'function',
        function: {
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        },
      }));
      if (req.toolChoice) {
        body.tool_choice = req.toolChoice === 'required' ? 'required' : req.toolChoice;
      }
    }

    // 思考控制：合并配置与请求级覆盖
    const thinking = mergeThinking(cfg.thinking, req.thinking);
    const thinkingParams = toOpenAIChatThinking(thinking);
    Object.assign(body, thinkingParams);

    return body;
  }

  transformResponse(raw: unknown): UnifiedResponse {
    const data = raw as OpenAIChatResponse;
    const choice = data.choices?.[0];
    if (!choice) {
      throw new Error('OpenAI Chat response missing choices');
    }
    const msg = choice.message;
    const content = msg?.content ?? '';
    const toolCalls: UnifiedToolCall[] | undefined = msg?.tool_calls?.map(tc => ({
      id: tc.id,
      type: 'function',
      function: {
        name: tc.function.name,
        arguments: tc.function.arguments,
      },
    }));

    const usage: UnifiedUsage = {
      prompt_tokens: data.usage?.prompt_tokens ?? 0,
      completion_tokens: data.usage?.completion_tokens ?? 0,
      total_tokens: data.usage?.total_tokens ?? 0,
      reasoning_tokens: (data.usage as { reasoning_tokens?: number } | undefined)?.reasoning_tokens,
    };

    return {
      content,
      tool_calls: toolCalls,
      finish_reason: mapFinishReason(choice.finish_reason),
      usage,
      raw,
    };
  }

  transformStreamChunk(raw: string): StreamDelta | StreamDelta[] | null {
    let data: OpenAIChatStreamChunk;
    try {
      data = JSON.parse(raw) as OpenAIChatStreamChunk;
    } catch {
      return null;
    }
    if (!data.choices || data.choices.length === 0) {
      // 可能是 usage chunk
      if (data.usage) {
        return {
          type: 'usage',
          usage: {
            prompt_tokens: data.usage.prompt_tokens ?? 0,
            completion_tokens: data.usage.completion_tokens ?? 0,
            total_tokens: data.usage.total_tokens ?? 0,
            reasoning_tokens: (data.usage as { reasoning_tokens?: number }).reasoning_tokens,
          },
        };
      }
      return null;
    }
    const choice = data.choices[0];
    const deltas: StreamDelta[] = [];

    const delta = choice.delta;
    if (delta?.content) {
      deltas.push({ type: 'text', text: delta.content });
    }
    if (delta?.reasoning_content) {
      deltas.push({ type: 'thinking', text: delta.reasoning_content });
    }
    if (delta?.tool_calls) {
      for (const tc of delta.tool_calls) {
        deltas.push({
          type: 'tool_call',
          toolCallId: tc.id ?? '',
          name: tc.function?.name ?? '',
          argumentsDelta: tc.function?.arguments ?? '',
          index: tc.index ?? 0,
        });
      }
    }
    if (choice.finish_reason) {
      deltas.push({ type: 'finish', finishReason: mapFinishReason(choice.finish_reason) });
    }
    return deltas.length === 0 ? null : deltas.length === 1 ? deltas[0] : deltas;
  }

  resolveEndpoint(cfg: ProviderConfig, _model: string): string {
    // cfg.endpoint 通常是 https://api.deepseek.com 或 https://api.openai.com/v1
    // 兼容两种形式：已含 /v1 和未含 /v1
    const base = cfg.endpoint.replace(/\/$/, '');
    if (base.endsWith('/v1')) return `${base}/chat/completions`;
    if (base.endsWith('/compatible-mode/v1')) return `${base}/chat/completions`;
    // 默认追加 /v1/chat/completions
    return `${base}/v1/chat/completions`;
  }

  resolveHeaders(cfg: ProviderConfig): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    };
  }
}

// ============================================================================
// 思考参数转换
// ============================================================================

export function toOpenAIChatThinking(t: ThinkingConfig): Record<string, unknown> {
  if (!t.enabled) return { reasoning_effort: 'none' };
  return { reasoning_effort: t.effort ?? 'medium' };
}

// ============================================================================
// 内部 helper
// ============================================================================

function toOpenAIMessage(msg: UnifiedMessage): unknown {
  const out: Record<string, unknown> = { role: msg.role, content: msg.content };
  if (msg.name) out.name = msg.name;
  if (msg.toolCallId) out.tool_call_id = msg.toolCallId;
  if (msg.toolCalls) {
    out.tool_calls = msg.toolCalls.map(tc => ({
      id: tc.id,
      type: 'function',
      function: {
        name: tc.function.name,
        arguments: tc.function.arguments,
      },
    }));
  }
  return out;
}

function mapFinishReason(r: string | undefined): 'stop' | 'tool_use' | 'length' | 'error' {
  if (!r) return 'stop';
  if (r === 'tool_calls' || r === 'function_call') return 'tool_use';
  if (r === 'length') return 'length';
  if (r === 'stop') return 'stop';
  return 'stop';
}

/** 合并配置级与请求级 thinking：请求级覆盖配置级 */
function mergeThinking(
  cfgThinking: ThinkingConfig,
  reqThinking?: ThinkingConfig,
): ThinkingConfig {
  if (!reqThinking) return cfgThinking;
  return {
    enabled: reqThinking.enabled,
    effort: reqThinking.effort ?? cfgThinking.effort,
    budgetTokens: reqThinking.budgetTokens ?? cfgThinking.budgetTokens,
  };
}

// ============================================================================
// 类型定义（OpenAI Chat 原生格式）
// ============================================================================

interface OpenAIChatResponse {
  choices?: Array<{
    message: {
      content?: string;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    reasoning_tokens?: number;
  };
}

interface OpenAIChatStreamChunk {
  choices?: Array<{
    delta: {
      content?: string;
      reasoning_content?: string;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    reasoning_tokens?: number;
  };
}
