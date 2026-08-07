// src/modules/server/routes/todos.ts
// GET /api/todos/:sessionId  —— 列出某 session 的 todos
// PUT /api/todos/:sessionId  —— 整体替换某 session 的 todos

import type { HttpRequest, HttpResponse, RouteHandler } from '../types';
import type { Environment } from '../../../core/types';
import {
  getTodoStorePath,
  readTodoStore,
  writeTodoStore,
  type TodoItem,
  type TodoStatus,
  type TodoPriority,
} from '../../tools/todo';

/** 入参可能缺 id/createdAt/updatedAt，由后端补齐。兼容旧字段 content。 */
interface TodoInput {
  id?: string;
  text: string;
  status: TodoStatus;
  priority: TodoPriority;
  createdAt?: string;
  updatedAt?: string;
}

export function createListTodosHandler(env: Environment): RouteHandler {
  const storePath = getTodoStorePath(env);
  return async (_req: HttpRequest, params?: Record<string, string>): Promise<HttpResponse> => {
    const sessionId = params?.sessionId;
    if (!sessionId) {
      return { status: 400, body: { error: 'sessionId required' } };
    }
    const store = readTodoStore(storePath);
    const todos = store.items.filter(it => it.sessionId === sessionId);
    return { status: 200, body: { sessionId, todos } };
  };
}

export function createReplaceTodosHandler(env: Environment): RouteHandler {
  const storePath = getTodoStorePath(env);
  return async (req: HttpRequest, params?: Record<string, string>): Promise<HttpResponse> => {
    const sessionId = params?.sessionId;
    if (!sessionId) {
      return { status: 400, body: { error: 'sessionId required' } };
    }
    const body = (req.body ?? {}) as { todos?: TodoInput[] };
    if (!Array.isArray(body.todos)) {
      return { status: 400, body: { error: 'body.todos must be an array' } };
    }

    const store = readTodoStore(storePath);
    // 移除该 session 的旧 todos，保留其他 session / 全局的
    store.items = store.items.filter(it => it.sessionId !== sessionId);

    // 追加新 todos，补齐 id/时间戳
    const now = new Date().toISOString();
    const newItems: TodoItem[] = body.todos.map((t, idx) => {
      const id = t.id ?? String(store.nextId + idx);
      return {
        id,
        text: t.text,
        status: t.status,
        priority: t.priority,
        createdAt: t.createdAt ?? now,
        updatedAt: t.updatedAt ?? now,
        sessionId,
      };
    });

    // 更新 nextId（取最大数字 id + 1）
    const maxNumericId = newItems
      .map(it => parseInt(it.id, 10))
      .filter(n => !Number.isNaN(n))
      .reduce((max, n) => Math.max(max, n), store.nextId - 1);
    store.nextId = maxNumericId + 1;

    store.items.push(...newItems);
    writeTodoStore(storePath, store);

    return { status: 200, body: { sessionId, todos: newItems } };
  };
}
