// src/plugins/server/routes/config.ts
// GET /api/config, PUT /api/config, GET /api/api-config, PUT /api/api-config

import type { HttpRequest, HttpResponse, RouteHandler } from '../types';
import type { ConfigService } from '../../../core/types';

export function createGetAppConfigHandler(config: ConfigService): RouteHandler {
  return async (): Promise<HttpResponse> => {
    return { status: 200, body: config.getAppConfig() };
  };
}

export function createUpdateAppConfigHandler(config: ConfigService): RouteHandler {
  return async (req: HttpRequest): Promise<HttpResponse> => {
    if (!req.body || typeof req.body !== 'object') {
      return { status: 400, body: { error: 'Invalid body, expected object' } };
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
    return { status: 200, body: config.getApiConfig() };
  };
}

export function createUpdateApiConfigHandler(config: ConfigService): RouteHandler {
  return async (req: HttpRequest): Promise<HttpResponse> => {
    if (!req.body || typeof req.body !== 'object') {
      return { status: 400, body: { error: 'Invalid body, expected object' } };
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
