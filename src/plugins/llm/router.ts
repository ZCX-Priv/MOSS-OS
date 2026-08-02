// src/plugins/llm/router.ts
// LLM 路由器：按 provider 路由 + 按模型自动匹配 + 流式/非流式分发。

import { getProvider } from './providers';
import { httpRequest } from './client';
import { parseSSEStream } from './stream';
import { LLMError } from './types';
import type {
  LLMProvider,
  ProviderConfig,
  StreamDelta,
  UnifiedRequest,
  UnifiedResponse,
} from './types';
import type { ApiConfig, Logger, ConfigService, EventBus } from '../../core/types';
import type { LLMRouter } from '../contracts';

export class LLMRouterImpl implements LLMRouter {
  private readonly config: ConfigService;
  private readonly eventBus: EventBus;
  private readonly logger: Logger;

  constructor(config: ConfigService, eventBus: EventBus, logger: Logger) {
    this.config = config;
    this.eventBus = eventBus;
    this.logger = logger;
  }

  async complete(req: UnifiedRequest, providerName?: string): Promise<UnifiedResponse> {
    const { provider, cfg } = this.resolveProvider(req.model, providerName);

    const endpoint = provider.resolveEndpoint(cfg, req.model);
    const headers = provider.resolveHeaders(cfg);
    const body = provider.transformRequest({ ...req, stream: false }, cfg);

    // 发出前 hook
    const processed = await this.eventBus.emit('llm:request:before', {
      endpoint,
      body,
      provider: cfg.format,
      model: req.model,
    });
    const finalEndpoint = processed.endpoint;
    const finalBody = processed.body;

    this.logger.debug(`LLM request: ${req.model}`, {
      provider: cfg.format,
      endpoint: finalEndpoint,
    });

    const resp = await httpRequest(
      {
        url: finalEndpoint,
        method: 'POST',
        headers,
        body: finalBody,
        stream: false,
      },
      this.logger,
    );

    if (!resp.text) {
      throw new LLMError('Empty response body', resp.status, false);
    }

    let raw: unknown;
    try {
      raw = JSON.parse(resp.text);
    } catch (err) {
      throw new LLMError(
        `Invalid JSON response: ${err instanceof Error ? err.message : err}`,
        resp.status,
        false,
        resp.text,
      );
    }

    const result = provider.transformResponse(raw);

    // 响应后 hook
    await this.eventBus.broadcast('llm:response:after', {
      provider: cfg.format,
      model: req.model,
      usage: result.usage,
    });

    return result;
  }

  async *stream(req: UnifiedRequest, providerName?: string): AsyncIterable<StreamDelta> {
    const { provider, cfg } = this.resolveProvider(req.model, providerName);

    const endpoint = this.resolveStreamEndpoint(provider, cfg, req.model);
    const headers = provider.resolveHeaders(cfg);
    const body = provider.transformRequest({ ...req, stream: true }, cfg);

    const processed = await this.eventBus.emit('llm:request:before', {
      endpoint,
      body,
      provider: cfg.format,
      model: req.model,
    });

    this.logger.debug(`LLM stream request: ${req.model}`, {
      provider: cfg.format,
      endpoint: processed.endpoint,
    });

    const resp = await httpRequest(
      {
        url: processed.endpoint,
        method: 'POST',
        headers,
        body: processed.body,
        stream: true,
      },
      this.logger,
    );

    if (!resp.stream) {
      throw new LLMError('No stream in response', resp.status, false);
    }
    // 双保险：client.ts 已检查流式状态码，这里再校验一次
    if (resp.status >= 400) {
      throw new LLMError(
        `LLM stream HTTP ${resp.status}`,
        resp.status,
        false,
      );
    }

    for await (const chunkText of parseSSEStream(resp.stream)) {
      const delta = provider.transformStreamChunk(chunkText);
      if (delta === null) continue;
      if (Array.isArray(delta)) {
        for (const d of delta) yield d;
      } else {
        yield delta;
      }
    }

    await this.eventBus.broadcast('llm:response:after', {
      provider: cfg.format,
      model: req.model,
      stream: true,
    });
  }

  listProviders(): string[] {
    return Object.keys(this.config.getApiConfig().providers);
  }

  resolveProviderForModel(model: string): string | null {
    const apiCfg = this.config.getApiConfig();
    for (const [name, p] of Object.entries(apiCfg.providers)) {
      if (p.models.includes(model)) return name;
    }
    return null;
  }

  // ========================================================================

  private resolveProvider(
    model: string,
    providerName?: string,
  ): { provider: LLMProvider; cfg: ProviderConfig } {
    const apiCfg = this.config.getApiConfig();
    let cfg: ProviderConfig | undefined;
    let name: string | undefined = providerName;

    if (!name) {
      name = this.resolveProviderForModel(model) ?? apiCfg.defaultProvider;
    }
    cfg = apiCfg.providers[name];

    if (!cfg) {
      throw new LLMError(
        `Provider "${name}" not found in api.json. Available: ${Object.keys(apiCfg.providers).join(', ')}`,
        undefined,
        false,
      );
    }

    // 空 apiKey 校验：避免无意义的 401 往返，给用户明确指引
    if (!cfg.apiKey) {
      throw new LLMError(
        `Provider "${name}" 的 API Key 未配置，请在"API 配置"面板中填写。`,
        undefined,
        false,
      );
    }

    return { provider: getProvider(cfg.format), cfg };
  }

  /** 流式端点：Gemini 用 streamGenerateContent，其他 provider 用同 endpoint */
  private resolveStreamEndpoint(
    provider: LLMProvider,
    cfg: ProviderConfig,
    model: string,
  ): string {
    // Gemini 专用流式端点
    if (cfg.format === 'gemini') {
      const base = cfg.endpoint.replace(/\/$/, '');
      return `${base}/models/${model}:streamGenerateContent?alt=sse`;
    }
    return provider.resolveEndpoint(cfg, model);
  }
}
