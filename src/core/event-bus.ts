// src/core/event-bus.ts
// 事件总线（Hook 系统）：Filter 模式（链式数据修改）+ Action 模式（并行副作用）。

import type {
  EventBus,
  EventBusSubscription,
  FilterHandler,
  ActionHandler,
  Logger,
} from './types';

interface FilterEntry {
  event: string;
  handler: FilterHandler<unknown>;
  priority: number;
  sequence: number; // 同 priority 内的注册顺序
  scope: string;
}

interface ActionEntry {
  event: string;
  handler: ActionHandler;
  scope: string;
}

class EventBusImpl implements EventBus {
  private readonly filters = new Map<string, FilterEntry[]>();
  private readonly actions = new Map<string, ActionEntry[]>();
  private sequence = 0;
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  on<T>(
    event: string,
    handler: FilterHandler<T>,
    priority = 10,
    scope = '__global__',
  ): EventBusSubscription {
    const entry: FilterEntry = {
      event,
      handler: handler as FilterHandler<unknown>,
      priority,
      sequence: this.sequence++,
      scope,
    };
    const list = this.filters.get(event) ?? [];
    list.push(entry);
    // 按 priority 升序，priority 相同按 sequence 升序
    list.sort((a, b) => a.priority - b.priority || a.sequence - b.sequence);
    this.filters.set(event, list);

    return { unsubscribe: () => this.off(event, handler) };
  }

  onAction(event: string, handler: ActionHandler, scope = '__global__'): EventBusSubscription {
    const entry: ActionEntry = { event, handler, scope };
    const list = this.actions.get(event) ?? [];
    list.push(entry);
    this.actions.set(event, list);

    return {
      unsubscribe: () => {
        const arr = this.actions.get(event);
        if (!arr) return;
        const idx = arr.findIndex(e => e.handler === handler);
        if (idx >= 0) arr.splice(idx, 1);
        if (arr.length === 0) this.actions.delete(event);
      },
    };
  }

  async emit<T>(event: string, data: T): Promise<T> {
    const list = this.filters.get(event);
    if (!list || list.length === 0) return data;

    let current = data;
    for (const entry of list) {
      try {
        const result = await entry.handler(current);
        // handler 必须返回同类型数据；若返回 undefined 视为不修改
        if (result !== undefined) {
          current = result as T;
        }
      } catch (err) {
        this.logger.error(`Filter handler for "${event}" threw`, {
          scope: entry.scope,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err; // 中断链，让上层感知
      }
    }
    return current;
  }

  async broadcast(event: string, data: unknown): Promise<void> {
    const list = this.actions.get(event);
    if (!list || list.length === 0) return;

    // 并行执行，单个失败不影响其他
    const results = await Promise.allSettled(list.map(entry => entry.handler(data)));
    let failureCount = 0;
    results.forEach((r, idx) => {
      if (r.status === 'rejected') {
        failureCount++;
        const entry = list[idx];
        this.logger.error(`Action handler for "${event}" failed`, {
          scope: entry.scope,
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
        });
      }
    });
    if (failureCount > 0) {
      this.logger.warn(`Event "${event}" had ${failureCount}/${list.length} failed handlers`);
    }
  }

  off(event: string, handler: Function): void {
    // Filter
    const fList = this.filters.get(event);
    if (fList) {
      const idx = fList.findIndex(e => e.handler === handler as FilterHandler<unknown>);
      if (idx >= 0) fList.splice(idx, 1);
      if (fList.length === 0) this.filters.delete(event);
    }
    // Action
    const aList = this.actions.get(event);
    if (aList) {
      const idx = aList.findIndex(e => e.handler === handler as ActionHandler);
      if (idx >= 0) aList.splice(idx, 1);
      if (aList.length === 0) this.actions.delete(event);
    }
  }

  offAll(scope: string): void {
    // Filter
    for (const [event, list] of this.filters) {
      const remaining = list.filter(e => e.scope !== scope);
      if (remaining.length === 0) this.filters.delete(event);
      else this.filters.set(event, remaining);
    }
    // Action
    for (const [event, list] of this.actions) {
      const remaining = list.filter(e => e.scope !== scope);
      if (remaining.length === 0) this.actions.delete(event);
      else this.actions.set(event, remaining);
    }
  }

  listEvents(): string[] {
    const events = new Set<string>();
    for (const e of this.filters.keys()) events.add(e);
    for (const e of this.actions.keys()) events.add(e);
    return Array.from(events);
  }
}

export function createEventBus(logger: Logger): EventBus {
  return new EventBusImpl(logger);
}
