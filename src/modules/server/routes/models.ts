// src/modules/server/routes/models.ts
// GET /api/models, PUT /api/models/current, POST /api/models,
// PATCH /api/models/:id, DELETE /api/models/:id
//
// 数据模型已扁平化：apiConfig.models 为 ModelConfig[]，每个模型独立持有
// format/endpoint/apiKey/thinking 等字段，不再有 provider 概念。

import type { HttpRequest, HttpResponse, RouteHandler } from '../types';
import type { ConfigService, ModelConfig, ServiceRegistry } from '../../../core/types';
import { ServiceNames } from '../../../core/types';
import type { LLMRouter } from '../../contracts';
import { ErrorCode } from '../../../core/error-codes';

/** 生成模型 id：model_{timestamp}_{random} */
function generateModelId(): string {
  return `model_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

type ThinkingPatch = {
  enabled?: boolean;
  effort?: string;
  label?: string;
  budgetTokens?: number;
};

/** 合并 thinking 配置：patch 覆盖 existing 的字段 */
function mergeThinking(
  existing: ModelConfig['thinking'],
  patch?: ThinkingPatch,
): ModelConfig['thinking'] {
  if (!patch) return existing;
  const out: ModelConfig['thinking'] = {
    enabled: patch.enabled !== undefined ? patch.enabled : existing.enabled,
  };
  if (patch.effort !== undefined || existing.effort !== undefined) {
    out.effort = patch.effort !== undefined ? patch.effort : existing.effort;
  }
  if (patch.label !== undefined || existing.label !== undefined) {
    out.label = patch.label !== undefined ? patch.label : existing.label;
  }
  if (patch.budgetTokens !== undefined || existing.budgetTokens !== undefined) {
    out.budgetTokens = patch.budgetTokens !== undefined ? patch.budgetTokens : existing.budgetTokens;
  }
  return out;
}

export function createListModelsHandler(config: ConfigService): RouteHandler {
  return async (): Promise<HttpResponse> => {
    const apiConfig = config.getApiConfig();
    const appConfig = config.getAppConfig();
    return {
      status: 200,
      body: {
        models: apiConfig.models,
        current: appConfig.agent.defaultModel,
      },
    };
  };
}

export function createSetCurrentModelHandler(config: ConfigService): RouteHandler {
  return async (req: HttpRequest): Promise<HttpResponse> => {
    const body = (req.body ?? {}) as { modelId?: string };
    if (!body.modelId) {
      return { status: 400, body: { error: ErrorCode.MODEL_ID_REQUIRED } };
    }
    try {
      await config.updateAppConfig({
        agent: { ...config.getAppConfig().agent, defaultModel: body.modelId },
      });
      return { status: 200, body: { current: body.modelId } };
    } catch (err) {
      return {
        status: 400,
        body: { error: err instanceof Error ? err.message : String(err) },
      };
    }
  };
}

export function createCreateModelHandler(config: ConfigService): RouteHandler {
  return async (req: HttpRequest): Promise<HttpResponse> => {
    const body = (req.body ?? {}) as {
      name?: string;
      model?: string;
      format?: ModelConfig['format'];
      endpoint?: string;
      apiKey?: string;
      contextWindow?: string;
      inputTokens?: number;
      outputTokens?: number;
      temperature?: number;
      topP?: number;
      topK?: number;
      thinking?: ThinkingPatch;
    };
    if (!body.name || !body.model || !body.format || !body.endpoint) {
      return { status: 400, body: { error: ErrorCode.MODEL_FIELDS_REQUIRED } };
    }
    try {
      const apiConfig = config.getApiConfig();
      const newModel: ModelConfig = {
        id: generateModelId(),
        name: body.name,
        model: body.model,
        format: body.format,
        endpoint: body.endpoint,
        apiKey: body.apiKey ?? '',
        thinking: mergeThinking({ enabled: false }, body.thinking),
        ...(body.contextWindow !== undefined ? { contextWindow: body.contextWindow } : {}),
        ...(body.inputTokens !== undefined ? { inputTokens: body.inputTokens } : {}),
        ...(body.outputTokens !== undefined ? { outputTokens: body.outputTokens } : {}),
        ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
        ...(body.topP !== undefined ? { topP: body.topP } : {}),
        ...(body.topK !== undefined ? { topK: body.topK } : {}),
      };
      await config.updateApiConfig({ models: [...apiConfig.models, newModel] });
      return { status: 201, body: newModel };
    } catch (err) {
      return {
        status: 400,
        body: { error: err instanceof Error ? err.message : String(err) },
      };
    }
  };
}

export function createDeleteModelHandler(config: ConfigService): RouteHandler {
  return async (_req: HttpRequest, params?: Record<string, string>): Promise<HttpResponse> => {
    const id = params?.id;
    if (!id) {
      return { status: 400, body: { error: ErrorCode.MODEL_ID_REQUIRED } };
    }
    try {
      const apiConfig = config.getApiConfig();
      const exists = apiConfig.models.some(m => m.id === id);
      if (!exists) {
        return { status: 404, body: { error: ErrorCode.MODEL_NOT_FOUND } };
      }
      const newModels = apiConfig.models.filter(m => m.id !== id);
      await config.updateApiConfig({ models: newModels });
      return { status: 200, body: { deleted: true } };
    } catch (err) {
      return {
        status: 400,
        body: { error: err instanceof Error ? err.message : String(err) },
      };
    }
  };
}

/**
 * PATCH /api/models/:id —— 更新模型属性。
 * body 可含 name/model/format/endpoint/apiKey/contextWindow/采样参数/thinking 的任意子集。
 * thinking 为部分更新（合并到现有值），其余字段直接覆盖。
 */
export function createUpdateModelHandler(config: ConfigService): RouteHandler {
  return async (req: HttpRequest, params?: Record<string, string>): Promise<HttpResponse> => {
    const id = params?.id;
    if (!id) {
      return { status: 400, body: { error: ErrorCode.MODEL_ID_REQUIRED } };
    }
    const body = (req.body ?? {}) as {
      name?: string;
      model?: string;
      format?: ModelConfig['format'];
      endpoint?: string;
      apiKey?: string;
      contextWindow?: string;
      inputTokens?: number;
      outputTokens?: number;
      temperature?: number;
      topP?: number;
      topK?: number;
      thinking?: ThinkingPatch;
    };
    try {
      const apiConfig = config.getApiConfig();
      const idx = apiConfig.models.findIndex(m => m.id === id);
      if (idx < 0) {
        return { status: 404, body: { error: ErrorCode.MODEL_NOT_FOUND } };
      }
      const existing = apiConfig.models[idx];
      const newModel: ModelConfig = {
        id: existing.id,
        name: body.name ?? existing.name,
        model: body.model ?? existing.model,
        format: body.format ?? existing.format,
        endpoint: body.endpoint ?? existing.endpoint,
        apiKey: body.apiKey ?? existing.apiKey,
        thinking: mergeThinking(existing.thinking, body.thinking),
        ...(body.contextWindow !== undefined
          ? { contextWindow: body.contextWindow }
          : existing.contextWindow !== undefined
            ? { contextWindow: existing.contextWindow }
            : {}),
        ...(body.inputTokens !== undefined
          ? { inputTokens: body.inputTokens }
          : existing.inputTokens !== undefined
            ? { inputTokens: existing.inputTokens }
            : {}),
        ...(body.outputTokens !== undefined
          ? { outputTokens: body.outputTokens }
          : existing.outputTokens !== undefined
            ? { outputTokens: existing.outputTokens }
            : {}),
        ...(body.temperature !== undefined
          ? { temperature: body.temperature }
          : existing.temperature !== undefined
            ? { temperature: existing.temperature }
            : {}),
        ...(body.topP !== undefined
          ? { topP: body.topP }
          : existing.topP !== undefined
            ? { topP: existing.topP }
            : {}),
        ...(body.topK !== undefined
          ? { topK: body.topK }
          : existing.topK !== undefined
            ? { topK: existing.topK }
            : {}),
      };
      const newModels = [...apiConfig.models];
      newModels[idx] = newModel;
      await config.updateApiConfig({ models: newModels });
      return { status: 200, body: newModel };
    } catch (err) {
      return {
        status: 400,
        body: { error: err instanceof Error ? err.message : String(err) },
      };
    }
  };
}

/**
 * POST /api/models/:id/test —— 测试模型连通性。
 * 通过 LLMRouter 发送最小请求（max_tokens=1），返回成功/失败 + 延迟。
 */
export function createTestModelHandler(services: ServiceRegistry): RouteHandler {
  return async (_req: HttpRequest, params?: Record<string, string>): Promise<HttpResponse> => {
    const id = params?.id;
    if (!id) {
      return { status: 400, body: { error: ErrorCode.MODEL_ID_REQUIRED } };
    }
    const router = services.tryResolve<LLMRouter>(ServiceNames.LLM_ROUTER);
    if (!router) {
      return { status: 503, body: { error: ErrorCode.LLM_ROUTER_UNAVAILABLE } };
    }
    const start = Date.now();
    try {
      await router.complete({
        model: id,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 1,
        stream: false,
      });
      const latencyMs = Date.now() - start;
      return { status: 200, body: { success: true, latencyMs, model: id } };
    } catch (err) {
      const latencyMs = Date.now() - start;
      return {
        status: 200,
        body: {
          success: false,
          latencyMs,
          error: err instanceof Error ? err.message : String(err),
        },
      };
    }
  };
}

/**
 * PUT /api/models/reorder —— 按给定 id 顺序重排模型列表。
 * body: { modelIds: string[] }
 */
export function createReorderModelsHandler(config: ConfigService): RouteHandler {
  return async (req: HttpRequest): Promise<HttpResponse> => {
    const body = (req.body ?? {}) as { modelIds?: string[] };
    if (!body.modelIds || !Array.isArray(body.modelIds)) {
      return { status: 400, body: { error: ErrorCode.MODEL_IDS_ARRAY_REQUIRED } };
    }
    try {
      const apiConfig = config.getApiConfig();
      const existingIds = new Set(apiConfig.models.map((m) => m.id));
      if (body.modelIds.length !== apiConfig.models.length) {
        return { status: 400, body: { error: ErrorCode.MODEL_IDS_LENGTH_MISMATCH } };
      }
      for (const id of body.modelIds) {
        if (!existingIds.has(id)) {
          return { status: 400, body: { error: ErrorCode.UNKNOWN_MODEL_ID } };
        }
      }
      const idToModel = new Map(apiConfig.models.map((m) => [m.id, m]));
      const reordered = body.modelIds.map((id) => idToModel.get(id)!);
      await config.updateApiConfig({ models: reordered });
      return { status: 200, body: { models: reordered } };
    } catch (err) {
      return {
        status: 400,
        body: { error: err instanceof Error ? err.message : String(err) },
      };
    }
  };
}