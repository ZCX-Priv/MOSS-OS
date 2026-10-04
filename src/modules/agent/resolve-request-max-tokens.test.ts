// src/modules/agent/resolve-request-max-tokens.test.ts
// 请求 max_tokens 解析单测：模型输出窗口优先，全局 agent.maxTokens 兜底，非法值回退。
// 回归背景：旧实现无条件用 agent.maxTokens(8192) 覆盖模型 outputTokens，
// 导致推理模型思考 token 耗尽预算而被截断（finish_reason=length）。

import { describe, it, expect } from 'bun:test';
import { resolveRequestMaxTokens } from './engine';
import type { ApiConfig, ProviderModelConfig } from '../../core/types';

function model(over: Partial<ProviderModelConfig> & { id: string; model: string }): ProviderModelConfig {
  return { name: over.id, thinking: { enabled: false }, ...over };
}

function api(models: ProviderModelConfig[]): ApiConfig {
  return {
    version: 2,
    providers: [
      {
        id: 'provider_test',
        name: 'Test',
        format: 'openai-chat',
        endpoint: 'https://example.com',
        apiKey: 'sk-test',
        models,
      },
    ],
  };
}

describe('resolveRequestMaxTokens', () => {
  it('按模型 id 命中 → 返回 outputTokens', () => {
    const cfg = api([model({ id: 'model_a', model: 'deepseek-flash', outputTokens: 384000 })]);
    expect(resolveRequestMaxTokens(cfg, 'model_a', 8192)).toBe(384000);
  });

  it('按 API 模型名兜底命中 → 返回 outputTokens', () => {
    const cfg = api([model({ id: 'model_a', model: 'deepseek-flash', outputTokens: 128000 })]);
    expect(resolveRequestMaxTokens(cfg, 'deepseek-flash', 8192)).toBe(128000);
  });

  it('未命中模型 → 回退 fallback', () => {
    const cfg = api([model({ id: 'model_a', model: 'deepseek-flash', outputTokens: 384000 })]);
    expect(resolveRequestMaxTokens(cfg, 'nope', 8192)).toBe(8192);
  });

  it('模型未配置 outputTokens → 回退 fallback', () => {
    const cfg = api([model({ id: 'model_a', model: 'deepseek-flash' })]);
    expect(resolveRequestMaxTokens(cfg, 'model_a', 8192)).toBe(8192);
  });

  it('outputTokens 非法（0 / 负数 / NaN）→ 回退 fallback', () => {
    const cfg = api([
      model({ id: 'model_a', model: 'm-a', outputTokens: 0 }),
      model({ id: 'model_b', model: 'm-b', outputTokens: -5 }),
      model({ id: 'model_c', model: 'm-c', outputTokens: Number.NaN }),
    ]);
    expect(resolveRequestMaxTokens(cfg, 'model_a', 8192)).toBe(8192);
    expect(resolveRequestMaxTokens(cfg, 'model_b', 8192)).toBe(8192);
    expect(resolveRequestMaxTokens(cfg, 'model_c', 8192)).toBe(8192);
  });

  it('空 providers → 回退 fallback（不产生 NaN）', () => {
    const cfg: ApiConfig = { version: 2, providers: [] };
    const out = resolveRequestMaxTokens(cfg, 'model_a', 8192);
    expect(out).toBe(8192);
    expect(Number.isFinite(out)).toBe(true);
  });
});
