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
      // 拖拽移组后，源组若为空文件夹分组则后端已自动销毁，刷新列表保持一致
      if (patch.groupId !== undefined && sourceGroupId && sourceGroupId !== task.groupId) {
        const state = useStore.getState();
        const sourceEmpty = state.tasks.every((t) => t.groupId !== sourceGroupId);
        const sourceIsFolder = state.taskGroups.find((g) => g.id === sourceGroupId)?.source === 'folder';
        if (sourceEmpty && sourceIsFolder) await load();
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
      // 删除后源组若为空文件夹分组则后端已自动销毁，刷新列表保持一致
      await load();
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
      // 重新加载以获取迁移/删除后的任务
      await load();
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
