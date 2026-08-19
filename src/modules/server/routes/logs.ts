// src/modules/server/routes/logs.ts
// 日志查询/清理 API：
//   GET  /api/logs/files   日志文件列表（mtime 降序）
//   GET  /api/logs         日志行查询（file/minLevel/search/limit/offset 过滤分页，最新优先）
//   POST /api/logs/cleanup 立即清理过期日志

import type { HttpRequest, HttpResponse, RouteHandler } from '../types';
import { ServiceNames } from '../../../core/types';
import type { LogService, LogLevel } from '../../../core/types';

const VALID_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error', 'fatal'];

function resolveLogService(services: { tryResolve: <T>(name: string) => T | null }): LogService | null {
  return services.tryResolve<LogService>(ServiceNames.LOGGER);
}

export function createLogFilesHandler(
  services: { tryResolve: <T>(name: string) => T | null },
): RouteHandler {
  return async (_req: HttpRequest): Promise<HttpResponse> => {
    const log = resolveLogService(services);
    if (!log) {
      return { status: 503, body: { error: 'logger service unavailable' } };
    }
    return { status: 200, body: { files: log.getLogFiles() } };
  };
}

export function createQueryLogsHandler(
  services: { tryResolve: <T>(name: string) => T | null },
): RouteHandler {
  return async (req: HttpRequest): Promise<HttpResponse> => {
    const log = resolveLogService(services);
    if (!log) {
      return { status: 503, body: { error: 'logger service unavailable' } };
    }

    const { file, minLevel, search, limit, offset } = req.query;

    // minLevel 容错：非法值忽略
    const level =
      minLevel && VALID_LEVELS.includes(minLevel as LogLevel) ? (minLevel as LogLevel) : undefined;

    // 数值容错：非法回退默认
    const parsedLimit = Number.parseInt(limit ?? '', 10);
    const parsedOffset = Number.parseInt(offset ?? '', 10);

    const result = log.readLogs({
      file: file || undefined,
      minLevel: level,
      search: search || undefined,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
      offset: Number.isFinite(parsedOffset) ? parsedOffset : undefined,
    });

    return { status: 200, body: result };
  };
}

export function createCleanupLogsHandler(
  services: { tryResolve: <T>(name: string) => T | null },
): RouteHandler {
  return async (_req: HttpRequest): Promise<HttpResponse> => {
    const log = resolveLogService(services);
    if (!log) {
      return { status: 503, body: { error: 'logger service unavailable' } };
    }
    const removed = log.cleanupNow();
    return { status: 200, body: { removed } };
  };
}
