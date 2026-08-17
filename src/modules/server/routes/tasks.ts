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
import { getSessionTodoPath, readSessionTodoStore } from '../../tools/todo/shared/store';
import { ErrorCode } from '../../../core/error-codes';

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
  reorderTasks?: (taskIds: string[]) => boolean;
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
  getActiveSkill?: (id: string) => { name: string; mode: 'system' | 'message'; content: string } | undefined;
  /** 获取会话权限模式（前端刷新后恢复 PermissionModeSelector 徽章） */
  getPermissionMode?: (id: string) => 'ask' | 'auto' | 'skip' | undefined;
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
      return { status: 503, body: { error: ErrorCode.AGENT_ENGINE_UNAVAILABLE } };
    }
    const body = (req.body ?? {}) as { title?: string; groupId?: string };
    if (!body.title) {
      return { status: 400, body: { error: ErrorCode.TASK_TITLE_REQUIRED } };
    }
    const task = engine.createTask(body.title, body.groupId);
    return { status: 201, body: task };
  };
}

export function createGetTaskHandler(services: ServiceRegistry, env: Environment): RouteHandler {
  return async (_req: HttpRequest, params?: Record<string, string>): Promise<HttpResponse> => {
    const id = params?.id;
    if (!id) {
      return { status: 400, body: { error: ErrorCode.TASK_ID_REQUIRED } };
    }
    const engine = resolveEngine(services);
    if (!engine?.getTask) {
      return { status: 503, body: { error: ErrorCode.AGENT_ENGINE_UNAVAILABLE } };
    }
    const task = engine.getTask(id);
    if (!task) {
      return { status: 404, body: { error: ErrorCode.TASK_NOT_FOUND } };
    }

    // 消息历史
    const history = engine.getHistory?.(id) ?? [];

    // todos（会话级存储：读该 session 的独立文件）
    const todoStore = readSessionTodoStore(getSessionTodoPath(env, id));
    const todos = todoStore.items;

    // contextFiles（暂为空，阶段 5.1 由工具执行轨迹回填）
    const contextFiles: Array<{ path: string; tokens?: number; reason?: string }> = [];

    // 当前激活的 skill 模式（前端刷新后恢复 Badge）
    const activeSkill = engine.getActiveSkill?.(id) ?? undefined;

    // 会话级权限模式（前端刷新后恢复 PermissionModeSelector 徽章）
    const permissionMode = engine.getPermissionMode?.(id) ?? undefined;

    return {
      status: 200,
      body: {
        task,
        messages: history,
        todos,
        contextFiles,
        ...(activeSkill ? { activeSkill } : {}),
        ...(permissionMode ? { permissionMode } : {}),
      },
    };
  };
}

export function createUpdateTaskHandler(services: ServiceRegistry): RouteHandler {
  return async (req: HttpRequest, params?: Record<string, string>): Promise<HttpResponse> => {
    const id = params?.id;
    if (!id) {
      return { status: 400, body: { error: ErrorCode.TASK_ID_REQUIRED } };
    }
    const engine = resolveEngine(services);
    if (!engine?.updateTask) {
      return { status: 503, body: { error: ErrorCode.AGENT_ENGINE_UNAVAILABLE } };
    }
    const body = (req.body ?? {}) as { title?: string; groupId?: string };
    const task = engine.updateTask(id, body);
    if (!task) {
      return { status: 404, body: { error: ErrorCode.TASK_NOT_FOUND } };
    }
    return { status: 200, body: task };
  };
}

export function createDeleteTaskHandler(services: ServiceRegistry): RouteHandler {
  return async (_req: HttpRequest, params?: Record<string, string>): Promise<HttpResponse> => {
    const id = params?.id;
    if (!id) {
      return { status: 400, body: { error: ErrorCode.TASK_ID_REQUIRED } };
    }
    const engine = resolveEngine(services);
    if (!engine?.deleteTask) {
      return { status: 503, body: { error: ErrorCode.AGENT_ENGINE_UNAVAILABLE } };
    }
    const deleted = engine.deleteTask(id);
    // 同时删除关联的 session
    engine.deleteSession?.(id);
    if (!deleted) {
      return { status: 404, body: { error: ErrorCode.TASK_NOT_FOUND } };
    }
    return { status: 200, body: { deleted: true } };
  };
}

/**
 * PUT /api/tasks/reorder —— 按给定 id 顺序重排任务 order（分组内排序持久化）。
 * body: { taskIds: string[] }
 */
export function createReorderTasksHandler(services: ServiceRegistry): RouteHandler {
  return async (req: HttpRequest): Promise<HttpResponse> => {
    const body = (req.body ?? {}) as { taskIds?: string[] };
    if (!body.taskIds || !Array.isArray(body.taskIds) || body.taskIds.length === 0) {
      return { status: 400, body: { error: ErrorCode.TASK_IDS_ARRAY_REQUIRED } };
    }
    const engine = resolveEngine(services);
    if (!engine?.reorderTasks) {
      return { status: 503, body: { error: ErrorCode.AGENT_ENGINE_UNAVAILABLE } };
    }
    const ok = engine.reorderTasks(body.taskIds);
    if (!ok) {
      return { status: 400, body: { error: ErrorCode.SOME_TASK_NOT_FOUND } };
    }
    const tasks = engine.listTasks?.() ?? [];
    return { status: 200, body: { reordered: true, tasks } };
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
      return { status: 503, body: { error: ErrorCode.AGENT_ENGINE_UNAVAILABLE } };
    }
    const body = (req.body ?? {}) as { name?: string };
    if (!body.name) {
      return { status: 400, body: { error: ErrorCode.TASK_NAME_REQUIRED } };
    }
    const group = engine.createTaskGroup(body.name);
    return { status: 201, body: group };
  };
}

export function createUpdateTaskGroupHandler(services: ServiceRegistry): RouteHandler {
  return async (req: HttpRequest, params?: Record<string, string>): Promise<HttpResponse> => {
    const id = params?.id;
    if (!id) {
      return { status: 400, body: { error: ErrorCode.GROUP_ID_REQUIRED } };
    }
    const engine = resolveEngine(services);
    if (!engine?.updateTaskGroup) {
      return { status: 503, body: { error: ErrorCode.AGENT_ENGINE_UNAVAILABLE } };
    }
    const body = (req.body ?? {}) as { name?: string };
    const group = engine.updateTaskGroup(id, body);
    if (!group) {
      return { status: 404, body: { error: ErrorCode.GROUP_NOT_FOUND } };
    }
    return { status: 200, body: group };
  };
}

export function createDeleteTaskGroupHandler(services: ServiceRegistry): RouteHandler {
  return async (req: HttpRequest, params?: Record<string, string>): Promise<HttpResponse> => {
    const id = params?.id;
    if (!id) {
      return { status: 400, body: { error: ErrorCode.GROUP_ID_REQUIRED } };
    }
    const engine = resolveEngine(services);
    if (!engine?.deleteTaskGroup) {
      return { status: 503, body: { error: ErrorCode.AGENT_ENGINE_UNAVAILABLE } };
    }
    const body = (req.body ?? {}) as { moveTasksTo?: string };
    const deleted = engine.deleteTaskGroup(id, body.moveTasksTo);
    if (!deleted) {
      return {
        status: 404,
        body: { error: ErrorCode.GROUP_NOT_FOUND_OR_DEFAULT },
      };
    }
    return { status: 200, body: { deleted: true } };
  };
}