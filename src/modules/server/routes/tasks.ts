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
import { ServiceNames } from '../../../core/types';
import type { AgentEngine } from '../../contracts';
import { getSessionTodoPath, readSessionTodoStore } from '../../tools/todo/shared/store';
import { ErrorCode } from '../../../core/error-codes';

/**
 * 任务列表实时广播（所有客户端侧边栏零刷新同步）。
 * 广播失败绝不影响 CRUD 主流程；隐藏分组（subagent / agenteam 衍生会话）始终不出现在载荷中。
 */
function broadcastWS(services: ServiceRegistry, message: unknown): void {
  try {
    services
      .tryResolve<{ broadcastWS?: (m: unknown) => void }>(ServiceNames.SERVER_INSTANCE)
      ?.broadcastWS?.(message);
  } catch {
    // 广播通道不可用：静默（前端仍可通过刷新拿到最新列表）
  }
}

/** 可见任务（剔除隐藏分组） */
function visibleTasks(engine: AgentEngineWithTasks): ReturnType<NonNullable<AgentEngineWithTasks['listTasks']>> {
  const hidden = hiddenGroupIds(engine);
  return (engine.listTasks?.() ?? []).filter((tk) => !hidden.has(tk.groupId));
}

/** 可见分组（剔除隐藏分组） */
function visibleGroups(engine: AgentEngineWithTasks): ReturnType<NonNullable<AgentEngineWithTasks['listTaskGroups']>> {
  return (engine.listTaskGroups?.() ?? []).filter((g) => g.hidden !== true);
}

/** 广播完整任务 + 分组快照（分组增删 / 批量迁移等无法局部描述的场景） */
function broadcastTasksChanged(services: ServiceRegistry, engine: AgentEngineWithTasks): void {
  broadcastWS(services, {
    type: 'tasks.changed',
    payload: { tasks: visibleTasks(engine), groups: visibleGroups(engine) },
  });
}

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
    source?: 'folder' | 'manual';
    dir?: string;
    hidden?: boolean;
  }>;
  createTaskGroup?: (
    name: string,
    source?: 'folder' | 'manual',
    opts?: { id?: string; dir?: string; hidden?: boolean },
  ) => {
    id: string;
    name: string;
    expanded?: boolean;
    taskCount?: number;
    source?: 'folder' | 'manual';
    dir?: string;
    hidden?: boolean;
  };
  updateTaskGroup?: (id: string, patch: { name?: string }) => {
    id: string;
    name: string;
    expanded?: boolean;
    taskCount?: number;
  } | null;
  deleteTaskGroup?: (
    id: string,
    opts?: { moveTasksTo?: string; deleteTasks?: boolean },
  ) => boolean;
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

/** 隐藏分组（subagent / agenteam 衍生会话）不出现在侧边栏列表；直接访问 /api/tasks/:id 仍可用 */
function hiddenGroupIds(engine: AgentEngineWithTasks): Set<string> {
  const groups = engine.listTaskGroups?.() ?? [];
  return new Set(groups.filter((g) => g.hidden === true).map((g) => g.id));
}

export function createListTasksHandler(services: ServiceRegistry): RouteHandler {
  return (): HttpResponse => {
    const engine = resolveEngine(services);
    if (!engine) {
      return { status: 200, body: { groups: [], tasks: [] } };
    }
    // 运行态随列表一并返回（权威来源为 server 实例的 activeRuns）：
    // 刷新后首屏即可渲染「运行中」转圈，彻底修复「任务在后台跑却显示已完成」。
    const server = services.tryResolve<{ isSessionRunning?: (sid: string) => boolean }>(
      ServiceNames.SERVER_INSTANCE,
    );
    const tasks = visibleTasks(engine).map((tk) => ({
      ...tk,
      running: server?.isSessionRunning?.(tk.sessionId ?? tk.id) ?? false,
    }));
    return { status: 200, body: { groups: visibleGroups(engine), tasks } };
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
    broadcastWS(services, { type: 'task.created', payload: { task } });
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
    // 移组可能触发空分组自动销毁 → 一并广播分组列表
    broadcastWS(services, { type: 'task.updated', payload: { taskId: task.id, task } });
    broadcastWS(services, { type: 'task-groups.changed', payload: { groups: visibleGroups(engine) } });
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
    // 先删 session 再删 task：session 文件路径按任务总管索引解析分组目录，
    // 任务元信息先删会导致索引失效（只能兜底扫描），先删 session 路径即精确命中
    engine.deleteSession?.(id);
    const deleted = engine.deleteTask(id);
    if (!deleted) {
      return { status: 404, body: { error: ErrorCode.TASK_NOT_FOUND } };
    }
    // 删除可能触发空分组自动销毁 → 一并广播分组列表
    broadcastWS(services, { type: 'task.deleted', payload: { taskId: id } });
    broadcastWS(services, { type: 'task-groups.changed', payload: { groups: visibleGroups(engine) } });
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
    // 顺序是全局信息，广播完整可见列表（拖拽一次 = 一次广播，低频）
    const tasks = visibleTasks(engine);
    broadcastWS(services, { type: 'tasks.reordered', payload: { tasks } });
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
    const groups = (engine.listTaskGroups?.() ?? []).filter((g) => g.hidden !== true);
    return { status: 200, body: { groups } };
  };
}

export function createCreateTaskGroupHandler(services: ServiceRegistry): RouteHandler {
  return async (req: HttpRequest): Promise<HttpResponse> => {
    const engine = resolveEngine(services);
    if (!engine?.createTaskGroup) {
      return { status: 503, body: { error: ErrorCode.AGENT_ENGINE_UNAVAILABLE } };
    }
    const body = (req.body ?? {}) as { name?: string; source?: 'folder' | 'manual' };
    if (!body.name) {
      return { status: 400, body: { error: ErrorCode.TASK_NAME_REQUIRED } };
    }
    const group = engine.createTaskGroup(body.name, body.source);
    broadcastWS(services, { type: 'task-groups.changed', payload: { groups: visibleGroups(engine) } });
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
    broadcastWS(services, { type: 'task-groups.changed', payload: { groups: visibleGroups(engine) } });
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
    const body = (req.body ?? {}) as { moveTasksTo?: string; deleteTasks?: boolean };
    const deleted = engine.deleteTaskGroup(id, {
      moveTasksTo: body.moveTasksTo,
      deleteTasks: body.deleteTasks,
    });
    if (!deleted) {
      return {
        status: 404,
        body: { error: ErrorCode.GROUP_NOT_FOUND_OR_DEFAULT },
      };
    }
    // 组内任务可能被迁移或批量删除 → 广播完整任务 + 分组快照
    broadcastTasksChanged(services, engine);
    return { status: 200, body: { deleted: true } };
  };
}