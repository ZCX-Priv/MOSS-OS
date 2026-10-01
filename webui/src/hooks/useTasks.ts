// UI/src/hooks/useTasks.ts
// 任务 hook：阶段3.4 后端 tasks 路由已就绪，直接使用 api.listTasks()。

import { useEffect, useCallback } from 'react';
import { useStore } from '../store';
import { api } from '../api/http';
import type { TaskItem } from '../types/api';

export function useTasks() {
  const setTasks = useStore((s) => s.setTasks);
  const setTaskGroups = useStore((s) => s.setTaskGroups);

  const load = useCallback(async () => {
    // 优先尝试 api.listTasks()（阶段3.4 后端就绪后）
    try {
      const { groups, tasks } = await api.listTasks();
      setTaskGroups(groups);
      setTasks(tasks);
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
    createTask,
    updateTask,
    deleteTask,
    reorderTasks,
    createTaskGroup,
    updateTaskGroup,
    deleteTaskGroup,
  };
}
