// src/modules/tools/todo.ts
// todo 工具：创建/更新待办项，持久化到 ~/.moss/todos.json。
// 单工具 + action 参数区分 create / update。
// TodoItem.text 字段与文档/前端对齐（向后兼容旧数据中的 content 字段）。

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { Tool, ToolResult } from './types';
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

/**
 * 创建 todo 工具。需要 env 以定位持久化路径 ~/.moss/todos.json。
 * create action 接受可选 sessionId 参数，写入新 item 的 sessionId 字段。
 */
export function createTodoTool(env: Environment): Tool {
  const storePath = getTodoStorePath(env);

  return {
    name: 'todo',
    description:
      'Create or update a todo item. ' +
      'Use action="create" with text (and optional priority) to add a new todo; returns the new item with its id. ' +
      'Use action="update" with id and at least one of text/status/priority to modify an existing todo. ' +
      'Todos are persisted across sessions.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'update'],
          description: 'Operation to perform.',
        },
        text: {
          type: 'string',
          description: 'Todo text content. Required for create. Optional for update.',
        },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: 'Priority (default medium).',
        },
        id: {
          type: 'string',
          description: 'Todo id. Required for update.',
        },
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'completed'],
          description: 'New status. Only for update.',
        },
        sessionId: {
          type: 'string',
          description: 'Optional session id to associate the todo with a specific session (create only).',
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    annotations: {
      idempotentHint: false,
    },
    async execute(params): Promise<ToolResult> {
      const p = params as {
        action: 'create' | 'update';
        text?: string;
        priority?: TodoPriority;
        id?: string;
        status?: TodoStatus;
        sessionId?: string;
      };

      const store = readTodoStore(storePath);

      if (p.action === 'create') {
        if (!p.text || typeof p.text !== 'string' || p.text.trim() === '') {
          return { content: [{ type: 'text', text: 'Error: text is required for create' }], isError: true };
        }
        const now = new Date().toISOString();
        const item: TodoItem = {
          id: String(store.nextId),
          text: p.text,
          status: 'pending',
          priority: p.priority ?? 'medium',
          createdAt: now,
          updatedAt: now,
          ...(p.sessionId ? { sessionId: p.sessionId } : {}),
        };
        store.items.push(item);
        store.nextId += 1;
        writeTodoStore(storePath, store);
        return {
          content: [{ type: 'text', text: `Todo created (id=${item.id}):\n${JSON.stringify(item, null, 2)}` }],
          metadata: { action: 'create', id: item.id },
        };
      }

      if (p.action === 'update') {
        if (!p.id) {
          return { content: [{ type: 'text', text: 'Error: id is required for update' }], isError: true };
        }
        const item = store.items.find(it => it.id === p.id);
        if (!item) {
          return { content: [{ type: 'text', text: `Error: todo with id="${p.id}" not found` }], isError: true };
        }
        if (p.text !== undefined) item.text = p.text;
        if (p.status !== undefined) item.status = p.status;
        if (p.priority !== undefined) item.priority = p.priority;
        item.updatedAt = new Date().toISOString();
        writeTodoStore(storePath, store);
        return {
          content: [{ type: 'text', text: `Todo updated (id=${item.id}):\n${JSON.stringify(item, null, 2)}` }],
          metadata: { action: 'update', id: item.id },
        };
      }

      return { content: [{ type: 'text', text: `Error: unknown action "${p.action}"` }], isError: true };
    },
  };
}
