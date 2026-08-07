// src/core/config-service.ts
// 配置服务：加载 config.json + api.json，Zod 校验，热重载，分发。

import { z } from 'zod';
import { join } from 'node:path';
import type {
  AppConfig,
  ApiConfig,
  ConfigService,
  Environment,
  EventBus,
  EventBusSubscription,
  Logger,
  LogLevel,
  ModelConfig,
} from './types';
import { buildToolsSchema, buildToolsDefaults } from '../modules/tools/manifest';

// ============================================================================
// Zod Schemas
// ============================================================================

const logLevelSchema = z.enum(['debug', 'info', 'warn', 'error', 'fatal']);

const providerThinkingSchema = z.object({
  enabled: z.boolean(),
  effort: z
    .enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh'])
    .optional(),
  budgetTokens: z.number().int().positive().optional(),
});

const modelConfigSchema: z.ZodType<ModelConfig> = z.object({
  id: z.string().min(1),
  name: z.string(),
  model: z.string(),
  format: z.enum(['openai-chat', 'openai-responses', 'anthropic', 'gemini']),
  endpoint: z.string(),
  apiKey: z.string(),
  thinking: providerThinkingSchema,
  contextWindow: z.string().optional(),
});

const appConfigSchema = z.object({
  version: z.number().int().positive(),
  server: z.object({
    host: z.string(),
    port: z.number().int().min(1).max(65535),
    autoPort: z.boolean(),
  }),
  daemon: z.object({
    enabled: z.boolean(),
    logLevel: logLevelSchema,
  }),
  update: z.object({
    autoCheck: z.boolean(),
    channel: z.enum(['stable', 'beta']),
    checkIntervalHours: z.number().int().min(1),
  }),
  agent: z.object({
    defaultModel: z.string(),
    maxTokens: z.number().int().positive(),
    maxTurns: z.number().int().positive(),
    workingDirectory: z.string(),
  }),
  // tools schema 从 manifest 自动构建（单一真相源），新增工具无需手动改此文件
  tools: buildToolsSchema(),
  mcpServers: z.record(z.string(), z.unknown()),
  security: z.object({
    authToken: z.string(),
    bindLocalhostOnly: z.boolean(),
  }),
});

const apiConfigSchema = z.object({
  version: z.number().int().positive(),
  models: z.array(modelConfigSchema),
});

// ============================================================================
// 默认配置模板（首次运行使用）
// ============================================================================

export function defaultAppConfig(): AppConfig {
  return {
    version: 1,
    server: { host: '127.0.0.1', port: 7766, autoPort: true },
    daemon: { enabled: true, logLevel: 'info' },
    update: { autoCheck: true, channel: 'stable', checkIntervalHours: 24 },
    agent: {
      defaultModel: '',
      maxTokens: 8192,
      maxTurns: 25,
      workingDirectory: '',
    },
    // tools 默认值从 manifest 自动构建（单一真相源）
    tools: buildToolsDefaults() as AppConfig['tools'],
    mcpServers: {},
    security: { authToken: '', bindLocalhostOnly: true },
  };
}

export function defaultApiConfig(): ApiConfig {
  return {
    version: 1,
    models: [],
  };
}

// ============================================================================
// ConfigService 实现
// ============================================================================

interface FsOps {
  exists(path: string): boolean;
  readText(path: string): string;
  writeText(path: string, content: string): void;
  mkdirRecursive(path: string): void;
  copyFile(src: string, dest: string): void;
}

class ConfigServiceImpl implements ConfigService {
  private appConfig: AppConfig | null = null;
  private apiConfig: ApiConfig | null = null;
  private readonly env: Environment;
  private readonly eventBus: EventBus;
  private readonly logger: Logger;
  private readonly fs: FsOps;
  private readonly changeHandlers: Array<(which: 'app' | 'api') => void> = [];
  private watcherStarted = false;

  constructor(
    env: Environment,
    eventBus: EventBus,
    logger: Logger,
    fs: FsOps,
  ) {
    this.env = env;
    this.eventBus = eventBus;
    this.logger = logger;
    this.fs = fs;
  }

  async load(): Promise<void> {
    // 1. 确保配置目录存在
    this.fs.mkdirRecursive(this.env.configDir);

    const appPath = join(this.env.configDir, 'config.json');
    const apiPath = join(this.env.configDir, 'api.json');

    // 2. 首次运行：从包内模板复制（若存在）；否则写入默认模板
    const pkgAppTemplate = join(this.env.packageRoot, 'config', 'config.json');
    const pkgApiTemplate = join(this.env.packageRoot, 'config', 'api.json');

    if (!this.fs.exists(appPath)) {
      if (this.fs.exists(pkgAppTemplate)) {
        this.fs.copyFile(pkgAppTemplate, appPath);
        this.logger.info('Copied config.json template from package');
      } else {
        this.fs.writeText(appPath, JSON.stringify(defaultAppConfig(), null, 2));
        this.logger.info('Created default config.json');
      }
    }
    if (!this.fs.exists(apiPath)) {
      if (this.fs.exists(pkgApiTemplate)) {
        this.fs.copyFile(pkgApiTemplate, apiPath);
        this.logger.info('Copied api.json template from package');
      } else {
        this.fs.writeText(apiPath, JSON.stringify(defaultApiConfig(), null, 2));
        this.logger.info('Created default api.json');
      }
    }

    // 3. 读取并校验
    this.appConfig = this.readAndValidateApp(appPath);
    this.apiConfig = this.readAndValidateApi(apiPath);

    // 4. 启动文件 watcher（仅一次）
    if (!this.watcherStarted) {
      this.startWatcher(appPath, apiPath);
      this.watcherStarted = true;
    }
  }

  /**
   * 配置加载失败时回退到默认配置（降级运行）。
   * 仅在 load() 抛错时由 kernel 调用，保证后续 getAppConfig()/getApiConfig() 可用。
   */
  loadDefaults(): void {
    this.appConfig = defaultAppConfig();
    this.apiConfig = defaultApiConfig();
    this.logger.warn('Config fallback to defaults (in-memory only, disk file unchanged)');
  }

  getAppConfig(): AppConfig {
    if (!this.appConfig) throw new Error('Config not loaded. Call load() first.');
    // 返回深拷贝避免外部意外修改
    return deepClone(this.appConfig);
  }

  getApiConfig(): ApiConfig {
    if (!this.apiConfig) throw new Error('Config not loaded. Call load() first.');
    return deepClone(this.apiConfig);
  }

  async updateAppConfig(patch: Partial<AppConfig>): Promise<void> {
    if (!this.appConfig) throw new Error('Config not loaded.');
    const merged = deepMerge(this.appConfig, patch) as AppConfig;
    const parsed = appConfigSchema.parse(merged);
    this.appConfig = parsed;
    this.fs.writeText(join(this.env.configDir, 'config.json'), JSON.stringify(parsed, null, 2));
    await this.eventBus.broadcast('config:changed', { which: 'app' });
    this.notifyChange('app');
  }

  async updateApiConfig(patch: Partial<ApiConfig>): Promise<void> {
    if (!this.apiConfig) throw new Error('Config not loaded.');
    const merged = deepMerge(this.apiConfig, patch) as ApiConfig;
    const parsed = apiConfigSchema.parse(merged);
    this.apiConfig = parsed;
    this.fs.writeText(join(this.env.configDir, 'api.json'), JSON.stringify(parsed, null, 2));
    await this.eventBus.broadcast('config:changed', { which: 'api' });
    this.notifyChange('api');
  }

  async reload(): Promise<void> {
    const appPath = join(this.env.configDir, 'config.json');
    const apiPath = join(this.env.configDir, 'api.json');
    this.appConfig = this.readAndValidateApp(appPath);
    this.apiConfig = this.readAndValidateApi(apiPath);
    await this.eventBus.broadcast('config:changed', { which: 'app' });
    await this.eventBus.broadcast('config:changed', { which: 'api' });
    this.notifyChange('app');
    this.notifyChange('api');
    this.logger.info('Config reloaded from disk');
  }

  onChange(handler: (which: 'app' | 'api') => void): EventBusSubscription {
    this.changeHandlers.push(handler);
    return {
      unsubscribe: () => {
        const idx = this.changeHandlers.indexOf(handler);
        if (idx >= 0) this.changeHandlers.splice(idx, 1);
      },
    };
  }

  private notifyChange(which: 'app' | 'api'): void {
    for (const h of this.changeHandlers) {
      try {
        h(which);
      } catch (err) {
        this.logger.warn('Config change handler failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  private readAndValidateApp(path: string): AppConfig {
    const text = this.fs.readText(path);
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (err) {
      throw new Error(`config.json is not valid JSON: ${err instanceof Error ? err.message : err}`);
    }
    const result = appConfigSchema.safeParse(raw);
    if (!result.success) {
      const issues = result.error.issues
        .map(i => `  - ${i.path.join('.')}: ${i.message}`)
        .join('\n');
      throw new Error(`config.json validation failed:\n${issues}`);
    }
    return result.data as AppConfig;
  }

  private readAndValidateApi(path: string): ApiConfig {
    const text = this.fs.readText(path);
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (err) {
      throw new Error(`api.json is not valid JSON: ${err instanceof Error ? err.message : err}`);
    }
    const result = apiConfigSchema.safeParse(raw);
    if (!result.success) {
      const issues = result.error.issues
        .map(i => `  - ${i.path.join('.')}: ${i.message}`)
        .join('\n');
      throw new Error(`api.json validation failed:\n${issues}`);
    }
    return result.data as ApiConfig;
  }

  private startWatcher(appPath: string, apiPath: string): void {
    // Bun 原生支持 fs.watch
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fs = require('node:fs');
      let debounce: ReturnType<typeof setTimeout> | null = null;
      const handle = (which: 'app' | 'api') => {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => {
          this.logger.info(`Config file changed on disk, reloading: ${which}`);
          this.reload().catch(err => {
            this.logger.error('Config reload failed', {
              error: err instanceof Error ? err.message : String(err),
            });
          });
        }, 300);
      };
      fs.watch(appPath, () => handle('app'));
      fs.watch(apiPath, () => handle('api'));
      this.logger.debug('Config file watcher started');
    } catch (err) {
      this.logger.warn('Failed to start config watcher', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

// ============================================================================
// 工具函数
// ============================================================================

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}

function deepMerge(target: unknown, patch: unknown): unknown {
  if (patch === null || patch === undefined) return target;
  if (typeof patch !== 'object' || Array.isArray(patch)) return patch;
  if (typeof target !== 'object' || target === null || Array.isArray(target)) {
    return patch;
  }
  const result: Record<string, unknown> = { ...(target as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    result[k] = deepMerge((target as Record<string, unknown>)[k], v);
  }
  return result;
}

// ============================================================================
// FsOps 默认实现（基于 node:fs）
// ============================================================================

function createNodeFsOps(): FsOps {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('node:path');
  return {
    exists: (p: string) => {
      try {
        return fs.existsSync(p);
      } catch {
        return false;
      }
    },
    readText: (p: string) => fs.readFileSync(p, 'utf8'),
    writeText: (p: string, content: string) => {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, content, 'utf8');
    },
    mkdirRecursive: (p: string) => fs.mkdirSync(p, { recursive: true }),
    copyFile: (src: string, dest: string) => {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    },
  };
}

export function createConfigService(
  env: Environment,
  eventBus: EventBus,
  logger: Logger,
): ConfigService {
  return new ConfigServiceImpl(env, eventBus, logger, createNodeFsOps());
}

// 导出 schema 供外部校验使用
export { appConfigSchema, apiConfigSchema };
export type { FsOps };
export type { LogLevel };
