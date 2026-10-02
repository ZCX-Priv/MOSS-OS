// UI/src/hooks/useTasks.ts
// 任务 hook：分页首载 + 滚动追加；WS 广播实时同步（后端 task.created/updated/deleted）。
// 重连后的兜底刷新由 useWebSocket 负责（restored 时全量重拉）。

import { useEffect, useCallback, useRef, useState } from 'react';
import { useStore } from '../store';
import { api } from '../api/http';
import type { TaskItem } from '../types/api';

/** 列表每页条数：首载与滚动追加共用（百级内首屏秒开，超出滚动加载） */
const TASKS_PAGE_SIZE = 100;

export function useTasks() {
  const setTasks = useStore((s) => s.setTasks);
  const setTaskGroups = useStore((s) => s.setTaskGroups);
  /** 分页状态（hasMore：服务端还有更早的任务页） */
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  /** loadMore 防重入（读取最新值用 ref，避免闭包过期） */
  const loadingMoreRef = useRef(false);

  const load = useCallback(async () => {
    // 优先分页首载（首页 TASKS_PAGE_SIZE 条；WS 广播与全量调用方不受影响）
    try {
      const { groups, tasks, page } = await api.listTasks({ limit: TASKS_PAGE_SIZE });
      setTaskGroups(groups);
      setTasks(tasks);
      setHasMore(page?.hasMore ?? false);
      return;
    } catch {
      // 后端 tasks 路由未就绪，降级到 session 适配
    }

    // 降级：api.listSessions() 适配为 TaskItem[]
    try {
      const { sessions } = await api.listSessions();
      const tasks: TaskItem[] = sessions.map((s) => ({
        id: s.id,
        title: `任务 ${s.id.slice(-6)}`,
        groupId: 'default',
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        sessionId: s.id,
      }));
      setTasks(tasks);
      setHasMore(false);
      // 默认分组
      setTaskGroups([{ id: 'default', name: '默认', expanded: true }]);
    } catch (err) {
      // 后端未启动，静默
      console.warn('useTasks load failed:', err);
    }
  }, [setTasks, setTaskGroups]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 滚动到底部附近时追加下一页（按 id 去重合并：与 WS 全量广播交错时安全） */
  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMore) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const offset = useStore.getState().tasks.length;
      const { tasks, page } = await api.listTasks({ limit: TASKS_PAGE_SIZE, offset });
      const st = useStore.getState();
      const existing = new Set(st.tasks.map((t) => t.id));
      const merged = [...st.tasks, ...tasks.filter((t) => !existing.has(t.id))];
      st.setTasks(merged);
      setHasMore(page?.hasMore ?? false);
    } catch {
      // 追加失败保持现状，用户再滚动会重试
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [hasMore]);

  const createTask = useCallback(
    async (title: string, groupId?: string) => {
      try {
        const task = await api.createTask(title, groupId);
        useStore.getState().addTask(task);
        return task;
      } catch (err) {
        console.warn('createTask failed:', err);
        return null;
      }
    },
    [],
  );

  const updateTask = useCallback(async (id: string, patch: { title?: string; groupId?: string }) => {
    try {
      const sourceGroupId = useStore.getState().tasks.find((t) => t.id === id)?.groupId;
      const task = await api.updateTask(id, patch);
      useStore.getState().updateTask(id, task);
      // 移组后源组可能作为空文件夹分组被后端销毁：后端已广播最新分组列表，
      // 广播不可用（WS 未连接）时才兜底重拉
      if (patch.groupId !== undefined && sourceGroupId && sourceGroupId !== task.groupId) {
        if (useStore.getState().wsStatus !== 'open') await load();
      }
      return task;
    } catch (err) {
      console.warn('updateTask failed:', err);
      return null;
    }
  }, [load]);

  const deleteTask = useCallback(async (id: string) => {
    try {
      await api.deleteTask(id);
      useStore.getState().removeTask(id);
      // 后端已广播 task.deleted + task-groups.changed（含空分组自动销毁）→ 无需重拉；
      // 仅在广播不可用（WS 未连接）时兜底刷新，避免列表与后端漂移
      if (useStore.getState().wsStatus !== 'open') await load();
    } catch (err) {
      console.warn('deleteTask failed:', err);
    }
  }, [load]);

  const reorderTasks = useCallback(async (taskIds: string[]) => {
    try {
      const { tasks } = await api.reorderTasks(taskIds);
      useStore.getState().setTasks(tasks);
      return tasks;
    } catch (err) {
      console.warn('reorderTasks failed:', err);
      return null;
    }
  }, []);

  const createTaskGroup = useCallback(async (name: string) => {
    try {
      const group = await api.createTaskGroup(name);
      useStore.getState().addTaskGroup(group);
      return group;
    } catch (err) {
      console.warn('createTaskGroup failed:', err);
      return null;
    }
  }, []);

  const updateTaskGroup = useCallback(async (id: string, patch: { name?: string }) => {
    try {
      const group = await api.updateTaskGroup(id, patch);
      if (group) {
        useStore.getState().updateTaskGroup(id, group);
      }
      return group;
    } catch (err) {
      console.warn('updateTaskGroup failed:', err);
      return null;
    }
  }, []);

  const deleteTaskGroup = useCallback(async (id: string, moveTasksTo?: string, deleteTasks?: boolean) => {
    try {
      await api.deleteTaskGroup(id, moveTasksTo, deleteTasks);
      useStore.getState().removeTaskGroup(id);
      // 组内任务可能被迁移/批量删除：后端已广播完整任务+分组快照；WS 不可用时兜底重拉
      if (useStore.getState().wsStatus !== 'open') await load();
    } catch (err) {
      console.warn('deleteTaskGroup failed:', err);
    }
  }, [load]);

  return {
    tasks: useStore((s) => s.tasks),
    taskGroups: useStore((s) => s.taskGroups),
    activeTaskId: useStore((s) => s.activeTaskId),
    reload: load,
    /** 滚动追加下一页（Sidebar 距底 <300px 时调用） */
    loadMore,
    /** 服务端还有未加载的任务页 */
    hasMore,
    /** 正在追加下一页 */
    loadingMore,
    createTask,
    updateTask,
    deleteTask,
    reorderTasks,
    createTaskGroup,
    updateTaskGroup,
    deleteTaskGroup,
  };
}
