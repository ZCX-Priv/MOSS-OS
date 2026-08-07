// src/modules/server/routes/tasks.ts
// 任务 + 分组 CRUD 路由
// GET    /api/tasks          —— 列出全部任务 + 分组
// POST   /api/tasks          —— 创建任务
// GET    /api/tasks/:id      —— 获取任务详情（含消息、todos、contextFiles）
// PATCH  /api/tasks/:id      —— 更新任务
// DELETE /api/tasks/:id      —— 删除任务
// GET    /api/task-groups    —— 列出分组
// POST   /api/task-groups    —— 创建分组
// PATCH  /api/task-groups/:id —— 更新分组
// DELETE /api/task-groups/:id —— 删除分组

import type { HttpRequest, HttpResponse, RouteHandler } from '../types';
import type { ServiceRegistry, Environment } from '../../../core/types';
import type { AgentEngine } from '../../contracts';
import { getTodoStorePath, readTodoStore } from '../../tools/todo';

type AgentEngineWithTasks = AgentEngine & {
  listTasks?: () => Array<{
    id: string;
    title: string;
    groupId: string;
    createdAt: string;
    updatedAt: string;
    active?: boolean;
    sessionId?: string;
  }>;
  getTask?: (id: string) => {
    id: string;
    title: string;
    groupId: string;
    createdAt: string;
    updatedAt: string;
    active?: boolean;
    sessionId?: string;
  } | null;
  createTask?: (title: string, groupId?: string) => {
    id: string;
    title: string;
    groupId: string;
    createdAt: string;
    updatedAt: string;
    active?: boolean;
    sessionId?: string;
  };
  updateTask?: (id: string, patch: { title?: string; groupId?: string }) => {
    id: string;
    title: string;
    groupId: string;
    createdAt: string;
    updatedAt: string;
    active?: boolean;
    sessionId?: string;
  } | null;
  deleteTask?: (id: string) => boolean;
  listTaskGroups?: () => Array<{
    id: string;
    name: string;
    expanded?: boolean;
    taskCount?: number;
  }>;
  createTaskGroup?: (name: string) => {
    id: string;
    name: string;
    expanded?: boolean;
    taskCount?: number;
  };
  updateTaskGroup?: (id: string, patch: { name?: string }) => {
    id: string;
    name: string;
    expanded?: boolean;
    taskCount?: number;
  } | null;
  deleteTaskGroup?: (id: string, moveTasksTo?: string) => boolean;
  getHistory?: (id: string) => unknown[];
  deleteSession?: (id: string) => void;
};

function resolveEngine(services: ServiceRegistry): AgentEngineWithTasks | null {
  return services.tryResolve<AgentEngineWithTasks>('agent.engine');
}

// ============================================================================
// 任务
// ============================================================================

export function createListTasksHandler(services: ServiceRegistry): RouteHandler {
  return async (): Promise<HttpResponse> => {
    const engine = resolveEngine(services);
    if (!engine) {
      return { status: 200, body: { groups: [], tasks: [] } };
    }
    const tasks = engine.listTasks?.() ?? [];
    const groups = engine.listTaskGroups?.() ?? [];
    return { status: 200, body: { groups, tasks } };
  };
}

export function createCreateTaskHandler(services: ServiceRegistry): RouteHandler {
  return async (req: HttpRequest): Promise<HttpResponse> => {
    const engine = resolveEngine(services);
    if (!engine?.createTask) {
      return { status: 503, body: { error: 'agent engine not available' } };
    }
    const body = (req.body ?? {}) as { title?: string; groupId?: string };
    if (!body.title) {
      return { status: 400, body: { error: 'title required' } };
    }
    const task = engine.createTask(body.title, body.groupId);
    return { status: 201, body: task };
  };
}

export function createGetTaskHandler(services: ServiceRegistry, env: Environment): RouteHandler {
  return async (_req: HttpRequest, params?: Record<string, string>): Promise<HttpResponse> => {
    const id = params?.id;
    if (!id) {
      return { status: 400, body: { error: 'task id required' } };
    }
    const engine = resolveEngine(services);
    if (!engine?.getTask) {
      return { status: 503, body: { error: 'agent engine not available' } };
    }
    const task = engine.getTask(id);
    if (!task) {
      return { status: 404, body: { error: `task '${id}' not found` } };
    }

    // 消息历史
    const history = engine.getHistory?.(id) ?? [];

    // todos（从 todos.json 按 sessionId 过滤）
    const todoStore = readTodoStore(getTodoStorePath(env));
    const todos = todoStore.items.filter(it => it.sessionId === id);

    // contextFiles（暂为空，阶段 5.1 由工具执行轨迹回填）
    const contextFiles: Array<{ path: string; tokens?: number; reason?: string }> = [];

    return {
      status: 200,
      body: {
        task,
        messages: history,
        todos,
        contextFiles,
      },
    };
  };
}

export function createUpdateTaskHandler(services: ServiceRegistry): RouteHandler {
  return async (req: HttpRequest, params?: Record<string, string>): Promise<HttpResponse> => {
    const id = params?.id;
    if (!id) {
      return { status: 400, body: { error: 'task id required' } };
    }
    const engine = resolveEngine(services);
    if (!engine?.updateTask) {
      return { status: 503, body: { error: 'agent engine not available' } };
    }
    const body = (req.body ?? {}) as { title?: string; groupId?: string };
    const task = engine.updateTask(id, body);
    if (!task) {
      return { status: 404, body: { error: `task '${id}' not found` } };
    }
    return { status: 200, body: task };
  };
}

export function createDeleteTaskHandler(services: ServiceRegistry): RouteHandler {
  return async (_req: HttpRequest, params?: Record<string, string>): Promise<HttpResponse> => {
    const id = params?.id;
    if (!id) {
      return { status: 400, body: { error: 'task id required' } };
    }
    const engine = resolveEngine(services);
    if (!engine?.deleteTask) {
      return { status: 503, body: { error: 'agent engine not available' } };
    }
    const deleted = engine.deleteTask(id);
    // 同时删除关联的 session
    engine.deleteSession?.(id);
    if (!deleted) {
      return { status: 404, body: { error: `task '${id}' not found` } };
    }
    return { status: 200, body: { deleted: true } };
  };
}

// ============================================================================
// 分组
// ============================================================================

export function createListTaskGroupsHandler(services: ServiceRegistry): RouteHandler {
  return async (): Promise<HttpResponse> => {
    const engine = resolveEngine(services);
    if (!engine) {
      return { status: 200, body: { groups: [] } };
    }
    const groups = engine.listTaskGroups?.() ?? [];
    return { status: 200, body: { groups } };
  };
}

export function createCreateTaskGroupHandler(services: ServiceRegistry): RouteHandler {
  return async (req: HttpRequest): Promise<HttpResponse> => {
    const engine = resolveEngine(services);
    if (!engine?.createTaskGroup) {
      return { status: 503, body: { error: 'agent engine not available' } };
    }
    const body = (req.body ?? {}) as { name?: string };
    if (!body.name) {
      return { status: 400, body: { error: 'name required' } };
    }
    const group = engine.createTaskGroup(body.name);
    return { status: 201, body: group };
  };
}

export function createUpdateTaskGroupHandler(services: ServiceRegistry): RouteHandler {
  return async (req: HttpRequest, params?: Record<string, string>): Promise<HttpResponse> => {
    const id = params?.id;
    if (!id) {
      return { status: 400, body: { error: 'group id required' } };
    }
    const engine = resolveEngine(services);
    if (!engine?.updateTaskGroup) {
      return { status: 503, body: { error: 'agent engine not available' } };
    }
    const body = (req.body ?? {}) as { name?: string };
    const group = engine.updateTaskGroup(id, body);
    if (!group) {
      return { status: 404, body: { error: `group '${id}' not found` } };
    }
    return { status: 200, body: group };
  };
}

export function createDeleteTaskGroupHandler(services: ServiceRegistry): RouteHandler {
  return async (req: HttpRequest, params?: Record<string, string>): Promise<HttpResponse> => {
    const id = params?.id;
    if (!id) {
      return { status: 400, body: { error: 'group id required' } };
    }
    const engine = resolveEngine(services);
    if (!engine?.deleteTaskGroup) {
      return { status: 503, body: { error: 'agent engine not available' } };
    }
    const body = (req.body ?? {}) as { moveTasksTo?: string };
    const deleted = engine.deleteTaskGroup(id, body.moveTasksTo);
    if (!deleted) {
      return {
        status: 404,
        body: { error: `group '${id}' not found or cannot delete default group` },
      };
    }
    return { status: 200, body: { deleted: true } };
  };
}
