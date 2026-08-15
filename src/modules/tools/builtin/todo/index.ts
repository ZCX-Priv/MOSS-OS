// builtin/todo/index.ts
// todo 工具 execute 逻辑：会话级待办管理（create/update/delete/list/reorder/batch_update），
// 持久化到 ~/.moss/todo/<sessionId>.json（每会话一文件）。
// 工厂模式：需要 env 以定位持久化路径。
// 持久化函数位于 ./shared/store.ts，被 server 路由和 agent 引擎复用。
// 元数据见同目录 tool.json。

import type { Environment } from '../../../../core/types';
import type { ToolContext, ToolResult } from '../../types';
import {
  readSessionTodoStore,
  writeSessionTodoStore,
  getSessionTodoPath,
  bumpNextId,
  type TodoItem,
  type TodoPriority,
  type TodoStatus,
} from './shared/store';

interface TodoUpdatePatch {
  id: string;
  text?: string;
  status?: TodoStatus;
  priority?: TodoPriority;
}

export default function createExecute(env: Environment) {
  return {
    async execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
      const p = params as {
        action: 'create' | 'update' | 'delete' | 'list' | 'reorder' | 'batch_update';
        text?: string;
        priority?: TodoPriority;
        id?: string;
        status?: TodoStatus;
        orderedIds?: string[];
        updates?: TodoUpdatePatch[];
      };

      if (!ctx.sessionId) {
        return { content: [{ type: 'text', text: 'Error: sessionId is required for todo operations' }], isError: true };
      }
      const storePath = getSessionTodoPath(env, ctx.sessionId);
      const store = readSessionTodoStore(storePath);

      const persist = (): void => {
        bumpNextId(store);
        writeSessionTodoStore(storePath, store);
      };

      switch (p.action) {
        case 'create': {
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
          };
          store.items.push(item);
          store.nextId += 1;
          persist();
          return {
            content: [{ type: 'text', text: `Todo created (id=${item.id}):\n${JSON.stringify(item, null, 2)}` }],
            metadata: { action: 'create', id: item.id },
          };
        }

        case 'update': {
          if (!p.id) {
            return { content: [{ type: 'text', text: 'Error: id is required for update' }], isError: true };
          }
          const item = store.items.find(it => it.id === p.id);
          if (!item) {
            return { content: [{ type: 'text', text: `Error: todo with id="${p.id}" not found. Use action="list" to see current todos.` }], isError: true };
          }
          if (p.text !== undefined) item.text = p.text;
          if (p.status !== undefined) item.status = p.status;
          if (p.priority !== undefined) item.priority = p.priority;
          item.updatedAt = new Date().toISOString();
          persist();
          return {
            content: [{ type: 'text', text: `Todo updated (id=${item.id}):\n${JSON.stringify(item, null, 2)}` }],
            metadata: { action: 'update', id: item.id },
          };
        }

        case 'delete': {
          if (!p.id) {
            return { content: [{ type: 'text', text: 'Error: id is required for delete' }], isError: true };
          }
          const idx = store.items.findIndex(it => it.id === p.id);
          if (idx === -1) {
            return { content: [{ type: 'text', text: `Error: todo with id="${p.id}" not found. Use action="list" to see current todos.` }], isError: true };
          }
          const [removed] = store.items.splice(idx, 1);
          persist();
          return {
            content: [{ type: 'text', text: `Todo deleted (id=${removed.id}): ${removed.text}` }],
            metadata: { action: 'delete', id: removed.id },
          };
        }

        case 'list': {
          const todos = store.items.map(it => ({ id: it.id, text: it.text, status: it.status, priority: it.priority }));
          return {
            content: [{ type: 'text', text: todos.length === 0 ? 'No todos in this session.' : `Todos (${todos.length}):\n${JSON.stringify(todos, null, 2)}` }],
            metadata: { action: 'list', count: todos.length },
          };
        }

        case 'reorder': {
          if (!Array.isArray(p.orderedIds) || p.orderedIds.length === 0) {
            return { content: [{ type: 'text', text: 'Error: orderedIds (full id list in new order) is required for reorder' }], isError: true };
          }
          const currentIds = new Set(store.items.map(it => it.id));
          const incoming = new Set(p.orderedIds);
          if (p.orderedIds.length !== store.items.length || p.orderedIds.some(id => !currentIds.has(id)) || [...currentIds].some(id => !incoming.has(id))) {
            return { content: [{ type: 'text', text: `Error: orderedIds must be a permutation of all current todo ids (${[...currentIds].join(', ')}). Use action="list" first.` }], isError: true };
          }
          const byId = new Map(store.items.map(it => [it.id, it]));
          store.items = p.orderedIds.map(id => byId.get(id)!);
          persist();
          return {
            content: [{ type: 'text', text: `Todos reordered. New order: ${store.items.map(it => `${it.id}(${it.text})`).join(' -> ')}` }],
            metadata: { action: 'reorder', count: store.items.length },
          };
        }

        case 'batch_update': {
          const updates = p.updates;
          if (!Array.isArray(updates) || updates.length === 0) {
            return { content: [{ type: 'text', text: 'Error: updates (array of {id, status?, text?, priority?}) is required for batch_update' }], isError: true };
          }
          // 预校验全通过才写入（原子语义）：任一 id 不存在则整体报错
          const missing = updates.filter(u => !u.id || !store.items.some(it => it.id === u.id));
          if (missing.length > 0) {
            return { content: [{ type: 'text', text: `Error: todos not found: ${missing.map(u => u.id).join(', ')}. Nothing was modified. Use action="list" to see current todos.` }], isError: true };
          }
          const now = new Date().toISOString();
          const updateIds = new Set(updates.map(u => u.id));
          for (const u of updates) {
            const item = store.items.find(it => it.id === u.id)!;
            if (u.text !== undefined) item.text = u.text;
            if (u.status !== undefined) item.status = u.status;
            if (u.priority !== undefined) item.priority = u.priority;
            item.updatedAt = now;
          }
          persist();
          return {
            content: [{ type: 'text', text: `Updated ${updates.length} todos:\n${JSON.stringify(store.items.filter(it => updateIds.has(it.id)), null, 2)}` }],
            metadata: { action: 'batch_update', count: updates.length },
          };
        }

        default:
          return { content: [{ type: 'text', text: `Error: unknown action "${String(p.action)}"` }], isError: true };
      }
    },
  };
}
