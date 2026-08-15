// src/core/index.ts
// 微内核统一导出。

export * from './types';
export { Microkernel, type KernelStartOptions } from './kernel';
export { createEventBus } from './event-bus';
export { createServiceRegistry } from './service-registry';
export { createConfigService, defaultAppConfig, defaultApiConfig, appConfigSchema, apiConfigSchema } from './config-service';
export { createRootLogger } from './logger';
export { detectEnvironment } from './env';
