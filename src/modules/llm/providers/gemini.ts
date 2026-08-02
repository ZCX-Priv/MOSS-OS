// src/plugins/llm/providers/gemini.ts
// Gemini generateContent API provider。
// 端点：/v1beta/models/{model}:generateContent
// 鉴权：x-goog-api-key
// 思考：generationConfig.thinkingConfig.thinkingBudget（整数或 -1 动态）+ includeThoughts
// Gemini 3 用 thinkingLevel（low/medium/high/minimal）

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

export class GeminiProvider implements LLMProvider {
  readonly format: ProviderFormat = 'gemini';

  transformRequest(req: UnifiedRequest, cfg: ProviderConfig): unknown {
    // Gemini：systemInstruction 在顶层，contents 数组不含 system
    let systemText = '';
    const contents: unknown[] = [];
    for (const m of req.messages) {
      if (m.role === 'system') {
        systemText += (systemText ? '\n' : '') + m.content;
      } else {
        contents.push(toGeminiContent(m));
      }
    }

    const body: Record<string, unknown> = { contents };
    if (systemText) {
      body.systemInstruction = { parts: [{ text: systemText }] };
    }

    // generationConfig
    const genConfig: Record<string, unknown> = {};
    if (req.temperature !== undefined) genConfig.temperature = req.temperature;
    if (req.max_tokens !== undefined) genConfig.maxOutputTokens = req.max_tokens;
    if (req.top_p !== undefined) genConfig.topP = req.top_p;

    // 思考控制
    const thinking = mergeThinking(cfg.thinking, req.thinking);
    const thinkingParams = toGeminiThinking(thinking);
    if (Object.keys(thinkingParams).length > 0) {
      genConfig.thinkingConfig = (thinkingParams as { thinkingConfig: unknown }).thinkingConfig;
    }
    if (Object.keys(genConfig).length > 0) {
      body.generationConfig = genConfig;
    }

    // 工具：functionDeclarations
    if (req.tools && req.tools.length > 0) {
      body.tools = [
        {
          functionDeclarations: req.tools.map(t => ({
            name: t.function.name,
            description: t.function.description,
            parameters: t.function.parameters,
          })),
        },
      ];
      if (req.toolChoice) {
        if (req.toolChoice === 'auto') body.toolConfig = { functionCallingConfig: { mode: 'AUTO' } };
        else if (req.toolChoice === 'required') body.toolConfig = { functionCallingConfig: { mode: 'ANY' } };
        else if (req.toolChoice === 'none') body.toolConfig = { functionCallingConfig: { mode: 'NONE' } };
      }
    }

    return body;
  }

  transformResponse(raw: unknown): UnifiedResponse {
    const data = raw as GeminiResponse;
    let content = '';
    let thinking: string | undefined;
    const toolCalls: UnifiedToolCall[] = [];

    for (const candidate of data.candidates ?? []) {
      for (const part of candidate.content?.parts ?? []) {
        if (part.text) {
          if (part.thought === true) {
            thinking = (thinking ?? '') + part.text;
          } else {
            content += part.text;
          }
        }
        if (part.functionCall) {
          toolCalls.push({
            id: `gemini-${Math.random().toString(36).slice(2, 10)}`,
            type: 'function',
            function: {
              name: part.functionCall.name,
              arguments: JSON.stringify(part.functionCall.args ?? {}),
            },
          });
        }
      }
    }

    const usage: UnifiedUsage = {
      prompt_tokens: data.usageMetadata?.promptTokenCount ?? 0,
      completion_tokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      total_tokens: data.usageMetadata?.totalTokenCount ?? 0,
      reasoning_tokens: undefined,
    };
    if (typeof data.usageMetadata === 'object' && data.usageMetadata !== null && 'thoughtsTokenCount' in data.usageMetadata) {
      const thoughts = (data.usageMetadata as { thoughtsTokenCount?: number }).thoughtsTokenCount;
      if (thoughts !== undefined) usage.reasoning_tokens = thoughts;
    }

    return {
      content,
      thinking,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      finish_reason: mapFinishReason(data.candidates?.[0]?.finishReason),
      usage,
      raw,
    };
  }

  transformStreamChunk(raw: string): StreamDelta | StreamDelta[] | null {
    let data: GeminiResponse;
    try {
      data = JSON.parse(raw) as GeminiResponse;
    } catch {
      return null;
    }

    const deltas: StreamDelta[] = [];
    for (const candidate of data.candidates ?? []) {
      for (const part of candidate.content?.parts ?? []) {
        if (part.text) {
          if (part.thought === true) {
            deltas.push({ type: 'thinking', text: part.text });
          } else {
            deltas.push({ type: 'text', text: part.text });
          }
        }
        if (part.functionCall) {
          deltas.push({
            type: 'tool_call',
            toolCallId: `gemini-${Math.random().toString(36).slice(2, 10)}`,
            name: part.functionCall.name,
            argumentsDelta: JSON.stringify(part.functionCall.args ?? {}),
            index: 0,
          });
        }
      }
      if (candidate.finishReason) {
        deltas.push({ type: 'finish', finishReason: mapFinishReason(candidate.finishReason) });
      }
    }
    if (data.usageMetadata) {
      deltas.push({
        type: 'usage',
        usage: {
          prompt_tokens: data.usageMetadata.promptTokenCount ?? 0,
          completion_tokens: data.usageMetadata.candidatesTokenCount ?? 0,
          total_tokens: data.usageMetadata.totalTokenCount ?? 0,
        },
      });
    }
    return deltas.length === 0 ? null : deltas.length === 1 ? deltas[0] : deltas;
  }

  resolveEndpoint(cfg: ProviderConfig, model: string): string {
    const base = cfg.endpoint.replace(/\/$/, '');
    const method = 'stream' in cfg ? 'streamGenerateContent' : 'generateContent';
    // 我们通过请求体的 stream 字段控制，endpoint 始终用 generateContent
    // 真正流式用 streamGenerateContent，但为简化，统一用 generateContent + SSE
    // Gemini 流式：streamGenerateContent?alt=sse
    return `${base}/models/${model}:generateContent`;
  }

  /** 流式端点单独构造 */
  resolveStreamEndpoint(cfg: ProviderConfig, model: string): string {
    const base = cfg.endpoint.replace(/\/$/, '');
    return `${base}/models/${model}:streamGenerateContent?alt=sse`;
  }

  resolveHeaders(cfg: ProviderConfig): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-goog-api-key': cfg.apiKey,
    };
  }
}

// ============================================================================
// 思考参数转换
// ============================================================================

export function toGeminiThinking(t: ThinkingConfig): Record<string, unknown> {
  if (!t.enabled) return { thinkingConfig: { thinkingBudget: 0 } };
  if (t.budgetTokens) {
    return {
      thinkingConfig: {
        thinkingBudget: t.budgetTokens,
        includeThoughts: true,
      },
    };
  }
  // 无 budget：动态思考（-1）
  return {
    thinkingConfig: {
      thinkingBudget: -1,
      includeThoughts: true,
    },
  };
}

// ============================================================================
// 内部 helper
// ============================================================================

function toGeminiContent(msg: UnifiedMessage): unknown {
  // Gemini：role 只支持 user / model
  const role = msg.role === 'assistant' ? 'model' : msg.role === 'tool' ? 'user' : msg.role;

  // tool 结果：functionResponse part
  if (msg.role === 'tool') {
    let responseObj: unknown;
    try {
      responseObj = JSON.parse(msg.content);
    } catch {
      responseObj = { result: msg.content };
    }
    return {
      role: 'user',
      parts: [
        {
          functionResponse: {
            name: msg.name ?? 'tool',
            response: responseObj,
          },
        },
      ],
    };
  }

  // assistant 含 tool_calls：functionCall parts
  if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
    const parts: unknown[] = [];
    if (msg.content) {
      parts.push({ text: msg.content });
    }
    for (const tc of msg.toolCalls) {
      let args: unknown;
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        args = {};
      }
      parts.push({
        functionCall: { name: tc.function.name, args },
      });
    }
    return { role: 'model', parts };
  }

  // 普通消息
  return { role, parts: [{ text: msg.content }] };
}

function mapFinishReason(r: string | undefined): 'stop' | 'tool_use' | 'length' | 'error' {
  if (!r) return 'stop';
  if (r === 'STOP') return 'stop';
  if (r === 'MAX_TOKENS') return 'length';
  if (r === 'SAFETY' || r === 'RECITATION') return 'error';
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
// 类型定义（Gemini 原生格式）
// ============================================================================

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        thought?: boolean;
        functionCall?: { name: string; args?: unknown };
      }>;
    };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
    thoughtsTokenCount?: number;
  };
}
