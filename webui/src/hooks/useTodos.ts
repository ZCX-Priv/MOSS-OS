// UI/src/hooks/useTodos.ts
// Todo hook：按 sessionId 拉取/更新 todos；订阅 WS todo-updated 自动刷新。

import { useEffect, useCallback } from 'react';
import { useStore } from '../store';
import { api } from '../api/http';
import { wsClient } from '../api/ws';
import type { TodoItem } from '../types/api';
import { toast } from 'sonner';

export function useTodos(sessionId: string | null) {
  const setTodos = useStore((s) => s.setTodos);

  const load = useCallback(async () => {
    if (!sessionId) return;
    try {
      const { todos } = await api.listTodos(sessionId);
      setTodos(sessionId, todos);
    } catch (err) {
      console.warn('useTodos load failed:', err);
    }
  }, [sessionId, setTodos]);

  useEffect(() => {
    void load();
    // 订阅 todo-updated（仅处理当前 session）
    const unsub = wsClient.onMessage((msg) => {
      if (msg.type === 'todo-updated' && msg.sessionId === sessionId) {
        const p = (msg.payload ?? {}) as { todos?: TodoItem[] };
        if (p.todos) {
          setTodos(sessionId, p.todos);
        } else {
          // 无 payload 时重新拉取
          void load();
        }
      }
    });
    return unsub;
  }, [load, sessionId, setTodos]);

  const setTodosFn = useCallback(
    async (todos: TodoItem[]) => {
      if (!sessionId) return;
      try {
        await api.setTodos(sessionId, todos);
        setTodos(sessionId, todos);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    [sessionId, setTodos],
  );

  return {
    todos: useStore((s) => (sessionId ? s.todosBySession[sessionId] ?? [] : [])),
    reload: load,
    setTodos: setTodosFn,
  };
}
