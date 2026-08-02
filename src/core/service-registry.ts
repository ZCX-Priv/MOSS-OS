// src/core/service-registry.ts
// 服务注册表：插件向内核注册服务实例，其他插件按需消费。

import type { ServiceRegistry } from './types';

interface ServiceEntry {
  service: unknown;
  scope: string;
  name: string;
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
    options: { override?: boolean; scope?: string } = {},
  ): void {
    const scope = options.scope ?? '__global__';
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
    this.services.set(name, { service, scope, name });
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
