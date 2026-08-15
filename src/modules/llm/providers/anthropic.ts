// src/modules/llm/providers/anthropic.ts
// Anthropic Messages API provider。
// 端点：/v1/messages
// 鉴权：x-api-key + anthropic-version
// 思考：thinking: {type: "enabled", budget_tokens} 或 {type: "adaptive"} + output_config.effort

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

const ANTHROPIC_VERSION = '2023-06-01';

export class AnthropicProvider implements LLMProvider {
  readonly format: ProviderFormat = 'anthropic';

  transformRequest(req: UnifiedRequest, cfg: ModelConfig): unknown {
    // Anthropic：system 在顶层，messages 数组不含 system
    let systemText = '';
    const messages: unknown[] = [];
    for (const m of req.messages) {
      if (m.role === 'system') {
        systemText += (systemText ? '\n' : '') + m.content;
      } else {
        messages.push(toAnthropicMessage(m));
      }
    }

    const body: Record<string, unknown> = {
      model: req.model,
      messages,
      max_tokens: req.max_tokens ?? 4096,
      stream: req.stream,
    };
    if (systemText) body.system = systemText;
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.top_p !== undefined) body.top_p = req.top_p;

    // 工具
    if (req.tools && req.tools.length > 0) {
      body.tools = req.tools.map(t => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      }));
      if (req.toolChoice) {
        if (req.toolChoice === 'auto') body.tool_choice = { type: 'auto' };
        else if (req.toolChoice === 'required') body.tool_choice = { type: 'any' };
        else if (req.toolChoice === 'none') body.tool_choice = { type: 'none' };
      }
    }

    // 思考控制
    const thinking = mergeThinking(cfg.thinking, req.thinking);
    const thinkingParams = toAnthropicThinking(thinking);
    Object.assign(body, thinkingParams);

    return body;
  }

  transformResponse(raw: unknown): UnifiedResponse {
    const data = raw as AnthropicResponse;
    let content = '';
    let thinking: string | undefined;
    const toolCalls: UnifiedToolCall[] = [];

    for (const block of data.content ?? []) {
      if (block.type === 'text') {
        content += block.text;
      } else if (block.type === 'thinking') {
        thinking = (thinking ?? '') + (block.thinking ?? '');
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id ?? '',
          type: 'function',
          function: {
            name: block.name ?? '',
            arguments: typeof block.input === 'string' ? block.input : JSON.stringify(block.input ?? {}),
          },
        });
      }
    }

    const usage: UnifiedUsage = {
      prompt_tokens: data.usage?.input_tokens ?? 0,
      completion_tokens: data.usage?.output_tokens ?? 0,
      total_tokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
      reasoning_tokens: undefined,
    };

    return {
      content,
      thinking,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      finish_reason: mapStopReason(data.stop_reason),
      usage,
      raw,
    };
  }

  transformStreamChunk(raw: string): StreamDelta | StreamDelta[] | null {
    let data: AnthropicStreamEvent;
    try {
      data = JSON.parse(raw) as AnthropicStreamEvent;
    } catch {
      return null;
    }

    const deltas: StreamDelta[] = [];
    switch (data.type) {
      case 'content_block_start':
        if (data.content_block?.type === 'tool_use') {
          deltas.push({
            type: 'tool_call',
            toolCallId: data.content_block.id ?? '',
            name: data.content_block.name ?? '',
            argumentsDelta: '',
            index: data.index ?? 0,
          });
        }
        break;
      case 'content_block_delta':
        if (data.delta?.type === 'text_delta') {
          deltas.push({ type: 'text', text: data.delta.text ?? '' });
        } else if (data.delta?.type === 'thinking_delta') {
          deltas.push({ type: 'thinking', text: data.delta.thinking ?? '' });
        } else if (data.delta?.type === 'input_json_delta') {
          deltas.push({
            type: 'tool_call',
            toolCallId: '',
            name: '',
            argumentsDelta: data.delta.partial_json ?? '',
            index: data.index ?? 0,
          });
        }
        break;
      case 'message_delta':
        if (data.usage) {
          deltas.push({
            type: 'usage',
            usage: {
              prompt_tokens: 0,
              completion_tokens: data.usage.output_tokens ?? 0,
              total_tokens: data.usage.output_tokens ?? 0,
            },
          });
        }
        if (data.delta?.stop_reason) {
          deltas.push({ type: 'finish', finishReason: mapStopReason(data.delta.stop_reason) });
        }
        break;
      case 'message_start':
        if (data.message?.usage) {
          deltas.push({
            type: 'usage',
            usage: {
              prompt_tokens: data.message.usage.input_tokens ?? 0,
              completion_tokens: data.message.usage.output_tokens ?? 0,
              total_tokens: (data.message.usage.input_tokens ?? 0) + (data.message.usage.output_tokens ?? 0),
            },
          });
        }
        break;
      default:
        return null;
    }
    return deltas.length === 0 ? null : deltas.length === 1 ? deltas[0] : deltas;
  }

  resolveEndpoint(cfg: ModelConfig): string {
    const base = cfg.endpoint.replace(/\/$/, '');
    if (base.endsWith('/v1')) return `${base}/messages`;
    return `${base}/v1/messages`;
  }

  resolveHeaders(cfg: ModelConfig): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': cfg.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    };
  }
}

// ============================================================================
// 思考参数转换
// ============================================================================

export function toAnthropicThinking(t: ThinkingConfig): Record<string, unknown> {
  if (!t.enabled) return {}; // Anthropic 不需要显式 disabled，省略即可
  if (t.budgetTokens) {
    return {
      thinking: { type: 'enabled', budget_tokens: t.budgetTokens },
    };
  }
  // adaptive 模式 + effort
  return {
    thinking: { type: 'adaptive' },
    output_config: { effort: t.effort ?? 'high' },
  };
}

// ============================================================================
// 内部 helper
// ============================================================================

function toAnthropicMessage(msg: UnifiedMessage): unknown {
  // Anthropic：tool 结果用 role: 'user' + tool_result content block
  if (msg.role === 'tool') {
    return {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: msg.toolCallId,
          content: msg.content,
        },
      ],
    };
  }
  // assistant 消息含 tool_calls：用 content blocks
  if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
    const blocks: unknown[] = [];
    if (msg.content) {
      blocks.push({ type: 'text', text: msg.content });
    }
    for (const tc of msg.toolCalls) {
      let input: unknown;
      try {
        input = JSON.parse(tc.function.arguments);
      } catch {
        input = {};
      }
      blocks.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.function.name,
        input,
      });
    }
    return { role: 'assistant', content: blocks };
  }
  // 普通消息
  return { role: msg.role, content: msg.content };
}

function mapStopReason(r: string | undefined): 'stop' | 'tool_use' | 'length' | 'error' {
  if (!r) return 'stop';
  if (r === 'tool_use') return 'tool_use';
  if (r === 'max_tokens') return 'length';
  if (r === 'end_turn' || r === 'stop') return 'stop';
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
// 类型定义（Anthropic 原生格式）
// ============================================================================

interface AnthropicResponse {
  content?: Array<{
    type: string;
    text?: string;
    thinking?: string;
    id?: string;
    name?: string;
    input?: unknown;
  }>;
  stop_reason?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

interface AnthropicStreamEvent {
  type: string;
  index?: number;
  content_block?: {
    type?: string;
    id?: string;
    name?: string;
  };
  delta?: {
    type?: string;
    text?: string;
    thinking?: string;
    partial_json?: string;
    stop_reason?: string;
  };
  message?: {
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  usage?: { output_tokens?: number };
}
