// src/modules/llm/providers/openai-responses.ts
// OpenAI Responses API provider（2025 年新格式）。
// 端点：/v1/responses，使用 input/output 结构，reasoning.effort + reasoning.summary。

import type {
  LLMProvider,
  ModelConfig,
  ProviderFormat,
  StreamDelta,
  UnifiedMessage,
  UnifiedRequest,
  UnifiedResponse,
  UnifiedToolCall,
  UnifiedUsage,
  ThinkingConfig,
} from '../types';

export class OpenAIResponsesProvider implements LLMProvider {
  readonly format: ProviderFormat = 'openai-responses';

  transformRequest(req: UnifiedRequest, cfg: ModelConfig): unknown {
    // Responses API 用 input 数组替代 messages
    const input = req.messages.map(toResponsesInput);

    const body: Record<string, unknown> = {
      model: req.model,
      input,
      stream: req.stream,
    };
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.max_tokens !== undefined) body.max_output_tokens = req.max_tokens;
    if (req.top_p !== undefined) body.top_p = req.top_p;

    // 工具（Responses API 用 tools 数组，type 为 function）
    if (req.tools && req.tools.length > 0) {
      body.tools = req.tools.map(t => ({
        type: 'function',
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
      }));
      if (req.toolChoice) {
        body.tool_choice = req.toolChoice === 'required' ? 'required' : req.toolChoice;
      }
    }

    // 思考控制
    const thinking = mergeThinking(cfg.thinking, req.thinking);
    const thinkingParams = toOpenAIResponsesThinking(thinking);
    Object.assign(body, thinkingParams);

    return body;
  }

  transformResponse(raw: unknown): UnifiedResponse {
    const data = raw as OpenAIResponsesResponse;
    // 解析 output 数组：提取 message + reasoning + function_call
    let content = '';
    let thinking: string | undefined;
    const toolCalls: UnifiedToolCall[] = [];

    for (const item of data.output ?? []) {
      if (item.type === 'message' && item.role === 'assistant') {
        for (const part of item.content ?? []) {
          if (part.type === 'output_text') {
            content += part.text;
          }
        }
      } else if (item.type === 'reasoning') {
        // reasoning 摘要
        for (const part of item.content ?? []) {
          if (part.type === 'summary_text' || part.type === 'output_text') {
            thinking = (thinking ?? '') + (part.text ?? '');
          }
        }
      } else if (item.type === 'function_call') {
        toolCalls.push({
          id: item.call_id ?? item.id ?? '',
          type: 'function',
          function: {
            name: item.name ?? '',
            arguments: item.arguments ?? '',
          },
        });
      }
    }

    const usage: UnifiedUsage = {
      prompt_tokens: data.usage?.input_tokens ?? 0,
      completion_tokens: data.usage?.output_tokens ?? 0,
      total_tokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
      reasoning_tokens: undefined,
      cached_tokens: (
        data.usage as { input_tokens_details?: { cached_tokens?: number } } | undefined
      )?.input_tokens_details?.cached_tokens,
    };
    if (typeof data.usage === 'object' && data.usage !== null && 'output_tokens_details' in data.usage) {
      const details = (data.usage as { output_tokens_details?: { reasoning_tokens?: number } }).output_tokens_details;
      if (details?.reasoning_tokens !== undefined) {
        usage.reasoning_tokens = details.reasoning_tokens;
      }
    }

    return {
      content,
      thinking,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      finish_reason: mapStatus(data.status),
      usage,
      raw,
    };
  }

  transformStreamChunk(raw: string): StreamDelta | StreamDelta[] | null {
    let data: OpenAIResponsesStreamEvent;
    try {
      data = JSON.parse(raw) as OpenAIResponsesStreamEvent;
    } catch {
      return null;
    }

    const deltas: StreamDelta[] = [];
    switch (data.type) {
      case 'response.output_text.delta':
        if (data.delta) deltas.push({ type: 'text', text: data.delta });
        break;
      case 'response.reasoning_summary_text.delta':
        if (data.delta) deltas.push({ type: 'thinking', text: data.delta });
        break;
      case 'response.function_call_arguments.delta':
        deltas.push({
          type: 'tool_call',
          toolCallId: data.item_id ?? '',
          name: '',
          argumentsDelta: data.delta ?? '',
          index: data.output_index ?? 0,
        });
        break;
      case 'response.output_item.added':
        if (data.item?.type === 'function_call') {
          deltas.push({
            type: 'tool_call',
            toolCallId: data.item.call_id ?? '',
            name: data.item.name ?? '',
            argumentsDelta: '',
            index: data.output_index ?? 0,
          });
        }
        break;
      case 'response.completed':
        if (data.response?.usage) {
          const u = data.response.usage as {
            input_tokens?: number;
            output_tokens?: number;
            input_tokens_details?: { cached_tokens?: number };
          };
          deltas.push({
            type: 'usage',
            usage: {
              prompt_tokens: u.input_tokens ?? 0,
              completion_tokens: u.output_tokens ?? 0,
              total_tokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0),
              cached_tokens: u.input_tokens_details?.cached_tokens,
            },
          });
        }
        deltas.push({ type: 'finish', finishReason: mapStatus(data.response?.status) });
        break;
      default:
        // 忽略其他事件类型
        return null;
    }
    return deltas.length === 0 ? null : deltas.length === 1 ? deltas[0] : deltas;
  }

  resolveEndpoint(cfg: ModelConfig): string {
    const base = cfg.endpoint.replace(/\/$/, '');
    if (base.endsWith('/v1')) return `${base}/responses`;
    return `${base}/v1/responses`;
  }

  resolveHeaders(cfg: ModelConfig): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    };
  }
}

// ============================================================================
// 思考参数转换
// ============================================================================

export function toOpenAIResponsesThinking(t: ThinkingConfig): Record<string, unknown> {
  if (!t.enabled) return { reasoning: { effort: 'none' } };
  return {
    reasoning: {
      effort: t.effort ?? 'medium',
      summary: 'auto',
    },
  };
}

// ============================================================================
// 内部 helper
// ============================================================================

function toResponsesInput(msg: UnifiedMessage): unknown {
  // system 消息在 Responses API 中用 instructions 字段，或作为 input 中的 system 项
  if (msg.role === 'system') {
    return { type: 'system', content: msg.content };
  }
  if (msg.role === 'tool') {
    // 工具结果：function_call_output
    return {
      type: 'function_call_output',
      call_id: msg.toolCallId,
      output: msg.content,
    };
  }
  // user / assistant
  return {
    type: 'message',
    role: msg.role,
    content: msg.content,
  };
}

function mapStatus(s: string | undefined): 'stop' | 'tool_use' | 'length' | 'error' {
  if (!s) return 'stop';
  if (s === 'completed') return 'stop';
  if (s === 'incomplete') return 'length';
  if (s === 'failed') return 'error';
  return 'stop';
}

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
// 类型定义（OpenAI Responses 原生格式）
// ============================================================================

interface OpenAIResponsesResponse {
  output?: Array<{
    type: string;
    id?: string;
    call_id?: string;
    name?: string;
    arguments?: string;
    role?: string;
    status?: string;
    content?: Array<{
      type: string;
      text?: string;
    }>;
  }>;
  status?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    output_tokens_details?: { reasoning_tokens?: number };
  };
}

interface OpenAIResponsesStreamEvent {
  type: string;
  delta?: string;
  item_id?: string;
  output_index?: number;
  item?: {
    type?: string;
    call_id?: string;
    name?: string;
  };
  response?: OpenAIResponsesResponse;
}
