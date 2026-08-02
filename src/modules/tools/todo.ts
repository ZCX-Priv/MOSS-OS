// src/modules/tools/todo.ts
// todo 工具：创建/更新待办项，持久化到 ~/.moss/todos.json。
// 单工具 + action 参数区分 create / update。

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { Tool, ToolResult } from './types';
import type { Environment } from '../../core/types';

type TodoStatus = 'pending' | 'in_progress' | 'completed';
type TodoPriority = 'low' | 'medium' | 'high';

interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
  priority: TodoPriority;
  createdAt: string;
  updatedAt: string;
}

interface TodoStore {
  nextId: number;
  items: TodoItem[];
}

const DEFAULT_STORE: TodoStore = { nextId: 1, items: [] };

/**
 * 创建 todo 工具。需要 env 以定位持久化路径 ~/.moss/todos.json。
 */
export function createTodoTool(env: Environment): Tool {
  const storePath = join(env.dataDir, 'todos.json');

  return {
    name: 'todo',
    description:
      'Create or update a todo item. ' +
      'Use action="create" with content (and optional priority) to add a new todo; returns the new item with its id. ' +
      'Use action="update" with id and at least one of content/status/priority to modify an existing todo. ' +
      'Todos are persisted across sessions.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'update'],
          description: 'Operation to perform.',
        },
        content: {
          type: 'string',
          description: 'Todo content text. Required for create. Optional for update.',
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
        content?: string;
        priority?: TodoPriority;
        id?: string;
        status?: TodoStatus;
      };

      const store = readStore(storePath);

      if (p.action === 'create') {
        if (!p.content || typeof p.content !== 'string' || p.content.trim() === '') {
          return { content: [{ type: 'text', text: 'Error: content is required for create' }], isError: true };
        }
        const now = new Date().toISOString();
        const item: TodoItem = {
          id: String(store.nextId),
          content: p.content,
          status: 'pending',
          priority: p.priority ?? 'medium',
          createdAt: now,
          updatedAt: now,
        };
        store.items.push(item);
        store.nextId += 1;
        writeStore(storePath, store);
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
        if (p.content !== undefined) item.content = p.content;
        if (p.status !== undefined) item.status = p.status;
        if (p.priority !== undefined) item.priority = p.priority;
        item.updatedAt = new Date().toISOString();
        writeStore(storePath, store);
        return {
          content: [{ type: 'text', text: `Todo updated (id=${item.id}):\n${JSON.stringify(item, null, 2)}` }],
          metadata: { action: 'update', id: item.id },
        };
      }

      return { content: [{ type: 'text', text: `Error: unknown action "${p.action}"` }], isError: true };
    },
  };
}

/** 读取持久化存储。文件不存在或损坏时返回空状态。 */
function readStore(path: string): TodoStore {
  try {
    if (!existsSync(path)) return { ...DEFAULT_STORE };
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as Partial<TodoStore>;
    if (
      typeof parsed.nextId !== 'number' ||
      !Array.isArray(parsed.items)
    ) {
      return { ...DEFAULT_STORE };
    }
    return parsed as TodoStore;
  } catch {
    return { ...DEFAULT_STORE };
  }
}

/** 原子写入持久化存储（先建目录再写）。 */
function writeStore(path: string, store: TodoStore): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(store, null, 2), 'utf8');
}
