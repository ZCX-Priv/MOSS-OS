// src/modules/tools/todo.ts
// Todo 持久化层：读写 ~/.moss/todos.json。
// 工具 execute 逻辑已迁移到 builtin/todo/index.ts（工厂模式），此处仅保留
// 被 server 路由（todos.ts / tasks.ts）和 agent 引擎复用的持久化函数与类型。

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { Environment } from '../../core/types';

export type TodoStatus = 'pending' | 'in_progress' | 'completed';
export type TodoPriority = 'low' | 'medium' | 'high';

export interface TodoItem {
  id: string;
  text: string;
  status: TodoStatus;
  priority: TodoPriority;
  createdAt: string;
  updatedAt: string;
  /** 关联的会话 ID。缺失视为全局任务（向后兼容旧数据）。 */
  sessionId?: string;
}

export interface TodoStore {
  nextId: number;
  items: TodoItem[];
}

const DEFAULT_STORE: TodoStore = { nextId: 1, items: [] };

/** 获取 todos.json 持久化路径（~/.moss/todos.json）。 */
export function getTodoStorePath(env: Environment): string {
  return join(env.dataDir, 'todos.json');
}

/**
 * 读取持久化存储。文件不存在或损坏时返回空状态。
 * 向后兼容：旧数据中的 content 字段映射为 text。
 */
export function readTodoStore(path: string): TodoStore {
  try {
    if (!existsSync(path)) return { ...DEFAULT_STORE };
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as Partial<TodoStore> & { items?: Array<Record<string, unknown>> };
    if (
      typeof parsed.nextId !== 'number' ||
      !Array.isArray(parsed.items)
    ) {
      return { ...DEFAULT_STORE };
    }
    // 兼容旧数据：content → text
    const items = (parsed.items as Array<Record<string, unknown>>).map((it) => {
      if (it.text === undefined && typeof it.content === 'string') {
        it.text = it.content;
        delete it.content;
      }
      return it as unknown as TodoItem;
    });
    return { nextId: parsed.nextId, items };
  } catch {
    return { ...DEFAULT_STORE };
  }
}

/** 原子写入持久化存储（先建目录再写）。 */
export function writeTodoStore(path: string, store: TodoStore): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(store, null, 2), 'utf8');
}
