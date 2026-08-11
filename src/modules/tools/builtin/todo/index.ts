// builtin/todo/index.ts
// todo 工具 execute 逻辑：创建/更新待办项，持久化到 ~/.moss/todos.json。
// 工厂模式：需要 env 以定位持久化路径。
// 持久化函数（readTodoStore/writeTodoStore 等）位于 ../../todo.ts，被 server 路由和 agent 引擎复用。
// 元数据见同目录 tool.json。

import type { Environment } from '../../../../core/types';
import type { ToolContext, ToolResult } from '../../types';
import {
  readTodoStore,
  writeTodoStore,
  getTodoStorePath,
  type TodoItem,
  type TodoPriority,
  type TodoStatus,
} from '../../todo';

export default function createExecute(env: Environment) {
  const storePath = getTodoStorePath(env);

  return {
    async execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
      const p = params as {
        action: 'create' | 'update';
        text?: string;
        priority?: TodoPriority;
        id?: string;
        status?: TodoStatus;
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
          sessionId: ctx.sessionId,
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
