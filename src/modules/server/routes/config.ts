// src/plugins/server/routes/config.ts
// GET /api/config, PUT /api/config, GET /api/api-config, PUT /api/api-config

import type { HttpRequest, HttpResponse, RouteHandler } from '../types';
import type { ConfigService } from '../../../core/types';
import { ErrorCode } from '../../../core/error-codes';

export function createGetAppConfigHandler(config: ConfigService): RouteHandler {
  return async (): Promise<HttpResponse> => {
    const cfg = config.getAppConfig();
    // 脱敏：不回传鉴权令牌（避免经 HTTP 泄露；空 token 表示未设置）
    const sanitized = { ...cfg, security: { ...cfg.security, authToken: '' } };
    return { status: 200, body: sanitized };
  };
}

export function createUpdateAppConfigHandler(config: ConfigService): RouteHandler {
  return async (req: HttpRequest): Promise<HttpResponse> => {
    if (!req.body || typeof req.body !== 'object') {
      return { status: 400, body: { error: ErrorCode.CONFIG_INVALID_BODY } };
    }
    try {
      await config.updateAppConfig(req.body as Record<string, unknown> as never);
      return { status: 200, body: config.getAppConfig() };
    } catch (err) {
      return {
        status: 400,
        body: { error: err instanceof Error ? err.message : String(err) },
      };
    }
  };
}

export function createGetApiConfigHandler(config: ConfigService): RouteHandler {
  return async (): Promise<HttpResponse> => {
    const cfg = config.getApiConfig();
    // 脱敏：不回传每个模型的 apiKey（避免经 HTTP 泄露；前端编辑时留空表示不修改）
    const sanitized = {
      ...cfg,
      models: cfg.models.map((m) => ({ ...m, apiKey: '' })),
    };
    return { status: 200, body: sanitized };
  };
}

export function createUpdateApiConfigHandler(config: ConfigService): RouteHandler {
  return async (req: HttpRequest): Promise<HttpResponse> => {
    if (!req.body || typeof req.body !== 'object') {
      return { status: 400, body: { error: ErrorCode.CONFIG_INVALID_BODY } };
    }
    try {
      await config.updateApiConfig(req.body as Record<string, unknown> as never);
      return { status: 200, body: config.getApiConfig() };
    } catch (err) {
      return {
        status: 400,
        body: { error: err instanceof Error ? err.message : String(err) },
      };
    }
  };
}