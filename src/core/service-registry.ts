// src/core/service-registry.ts
// 服务注册表：模组/插件向内核注册服务实例，其他扩展按需消费。
// - 模组（registrantType='module'）可注册任意服务名
// - 插件（registrantType='plugin'）不可注册 ProtectedServiceNames 中的服务名

import type { ProtectedServiceRegistry, ServiceRegistry } from './types';
import { ProtectedServiceNames } from './types';

interface ServiceEntry {
  service: unknown;
  scope: string;
  name: string;
  registrantType: 'module' | 'plugin' | 'unknown';
}

class ServiceRegistryImpl implements ServiceRegistry {
  private readonly services = new Map<string, ServiceEntry>();
  private readonly logger: { warn: (m: string, ctx?: Record<string, unknown>) => void };

  constructor(logger: { warn: (m: string, ctx?: Record<string, unknown>) => void }) {
    this.logger = logger;
  }

  register<T>(
    name: string,
    service: T,
    options: {
      override?: boolean;
      scope?: string;
      registrantType?: 'module' | 'plugin';
    } = {},
  ): void {
    const scope = options.scope ?? '__global__';
    const registrantType = options.registrantType ?? 'unknown';

    // 插件注册受保护服务名 → 拒绝
    if (registrantType === 'plugin' && ProtectedServiceNames.has(name)) {
      throw new Error(
        `Plugin scope "${scope}" is not allowed to register protected service "${name}". ` +
          `Protected services can only be registered by modules.`,
      );
    }

    const existing = this.services.get(name);
    if (existing) {
      if (!options.override) {
        throw new Error(
          `Service "${name}" already registered by scope "${existing.scope}". ` +
            `Use { override: true } to force override.`,
        );
      }
      this.logger.warn(`Service "${name}" overridden by scope "${scope}" (was "${existing.scope}")`);
    }
    this.services.set(name, { service, scope, name, registrantType });
  }

  resolve<T>(name: string): T {
    const entry = this.services.get(name);
    if (!entry) {
      throw new Error(`Service "${name}" not registered`);
    }
    return entry.service as T;
  }

  tryResolve<T>(name: string): T | null {
    const entry = this.services.get(name);
    return entry ? (entry.service as T) : null;
  }

  has(name: string): boolean {
    return this.services.has(name);
  }

  unregister(name: string): void {
    if (!this.services.delete(name)) {
      this.logger.warn(`Service "${name}" not registered, cannot unregister`);
    }
  }

  unregisterScope(scope: string): void {
    const toRemove: string[] = [];
    for (const [name, entry] of this.services) {
      if (entry.scope === scope) toRemove.push(name);
    }
    for (const name of toRemove) {
      this.services.delete(name);
    }
  }

  list(): string[] {
    return Array.from(this.services.keys());
  }
}

export function createServiceRegistry(
  logger: { warn: (m: string, ctx?: Record<string, unknown>) => void },
): ServiceRegistry {
  return new ServiceRegistryImpl(logger);
}

/**
 * 创建服务注册表的受保护视图（供 PluginContext 使用）。
 * - resolve / tryResolve 仅允许访问 allowedNames 中的服务
 * - register 强制 registrantType='plugin'，受 ProtectedServiceNames 约束
 */
export function createProtectedView(
  registry: ServiceRegistry,
  allowedNames: ReadonlySet<string>,
  pluginScope: string,
): ProtectedServiceRegistry {
  const assertConsume = (name: string): void => {
    if (!allowedNames.has(name)) {
      throw new Error(
        `Plugin "${pluginScope}" is not allowed to consume service "${name}". ` +
          `Declare it in plugin.json permissions.consumeServices.`,
      );
    }
  };

  return {
    resolve<T>(name: string): T {
      assertConsume(name);
      return registry.resolve<T>(name);
    },
    tryResolve<T>(name: string): T | null {
      // 白名单外的服务静默返回 null（避免插件探测未授权服务）
      if (!allowedNames.has(name)) return null;
      return registry.tryResolve<T>(name);
    },
    has(name: string): boolean {
      if (!allowedNames.has(name)) return false;
      return registry.has(name);
    },
    list(): string[] {
      // 仅返回白名单内且已注册的服务
      return registry.list().filter(n => allowedNames.has(n));
    },
    register<T>(
      name: string,
      service: T,
      options: { override?: boolean; scope?: string; registrantType?: 'plugin' } = {},
    ): void {
      // 强制 registrantType='plugin'，由 registry 内部校验保护服务名
      registry.register(name, service, {
        ...options,
        scope: options.scope ?? pluginScope,
        registrantType: 'plugin',
      });
    },
    unregister(name: string): void {
      registry.unregister(name);
    },
  };
}
