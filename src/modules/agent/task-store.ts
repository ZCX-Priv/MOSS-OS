// src/modules/agent/task-store.ts
// 任务持久化存储：~/.moss/tasks.json
// 结构：{ groups: TaskGroup[], tasks: TaskItem[] }
// TaskItem.id 即 sessionId（简化模型，1 task ↔ 1 session）

import { t } from '../../core/i18n';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { Environment, Logger } from '../../core/types';

export interface TaskItem {
  id: string;
  title: string;
  groupId: string;
  createdAt: string;
  updatedAt: string;
  active?: boolean;
  /** 关联的 sessionId（task.id 即 sessionId） */
  sessionId?: string;
  /** 分组内排序权重（小→前）；缺失视为最后，回退 createdAt 倒序 */
  order?: number;
}

export interface TaskGroup {
  id: string;
  name: string;
  expanded?: boolean;
  taskCount?: number;
}

interface TaskStoreData {
  groups: TaskGroup[];
  tasks: TaskItem[];
}

const DEFAULT_GROUP_ID = 'default';
const DEFAULT_GROUP_NAME = '默认任务';

const DEFAULT_STORE: TaskStoreData = {
  groups: [{ id: DEFAULT_GROUP_ID, name: DEFAULT_GROUP_NAME, expanded: true }],
  tasks: [],
};

export class TaskStore {
  private readonly storePath: string;
  private readonly logger: Logger;
  private data: TaskStoreData;

  constructor(env: Environment, logger: Logger) {
    this.storePath = join(env.dataDir, 'tasks.json');
    this.logger = logger;
    this.data = this.load();
  }

  // ==========================================================================
  // 任务 CRUD
  // ==========================================================================

  listTasks(): TaskItem[] {
    return this.data.tasks
      .map(t => ({ ...t }))
      .sort((a, b) => {
        const oa = a.order ?? Number.MAX_SAFE_INTEGER;
        const ob = b.order ?? Number.MAX_SAFE_INTEGER;
        if (oa !== ob) return oa - ob;
        // order 相同（含均缺失）时回退 createdAt 倒序
        return b.createdAt.localeCompare(a.createdAt);
      });
  }

  getTask(id: string): TaskItem | null {
    const task = this.data.tasks.find(t => t.id === id);
    return task ? { ...task } : null;
  }

  createTask(title: string, groupId?: string): TaskItem {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const gid = groupId ?? DEFAULT_GROUP_ID;
    // 新任务置于分组末尾：取分组内现有最大 order + 1（无任务时 0）
    const groupOrders = this.data.tasks
      .filter(t => t.groupId === gid)
      .map(t => t.order ?? -1);
    const nextOrder = groupOrders.length ? Math.max(...groupOrders) + 1 : 0;
    const task: TaskItem = {
      id,
      title: title || '新任务',
      groupId: gid,
      createdAt: now,
      updatedAt: now,
      sessionId: id, // task.id 即 sessionId
      order: nextOrder,
    };
    this.data.tasks.push(task);
    this.save();
    this.logger.debug(t('agent.taskCreated', { id }), { title, groupId: task.groupId });
    return { ...task };
  }

  updateTask(id: string, patch: { title?: string; groupId?: string }): TaskItem | null {
    const task = this.data.tasks.find(t => t.id === id);
    if (!task) return null;
    if (patch.title !== undefined) task.title = patch.title;
    if (patch.groupId !== undefined) task.groupId = patch.groupId;
    task.updatedAt = new Date().toISOString();
    this.save();
    return { ...task };
  }

  deleteTask(id: string): boolean {
    const idx = this.data.tasks.findIndex(t => t.id === id);
    if (idx === -1) return false;
    this.data.tasks.splice(idx, 1);
    this.save();
    return true;
  }

  /**
   * 按给定 id 顺序重写对应任务的 order（0,1,2...）。
   * 通常入参为某分组内的全部任务 id，重排后组内顺序即入参顺序。
   * 任一 id 不存在则整体失败、不写入。返回是否全部命中。
   */
  reorderTasks(taskIds: string[]): boolean {
    const idToTask = new Map(this.data.tasks.map(t => [t.id, t]));
    for (const id of taskIds) {
      if (!idToTask.has(id)) return false;
    }
    const now = new Date().toISOString();
    taskIds.forEach((id, idx) => {
      const task = idToTask.get(id)!;
      task.order = idx;
      task.updatedAt = now;
    });
    this.save();
    return true;
  }

  /** 按标题搜索任务（大小写不敏感子串匹配） */
  searchTasks(query: string): TaskItem[] {
    const q = query.toLowerCase();
    return this.data.tasks
      .filter(t => t.title.toLowerCase().includes(q))
      .map(t => ({ ...t }));
  }

  // ==========================================================================
  // 分组 CRUD
  // ==========================================================================

  listGroups(): TaskGroup[] {
    // 附带 taskCount
    return this.data.groups.map(g => ({
      ...g,
      taskCount: this.data.tasks.filter(t => t.groupId === g.id).length,
    }));
  }

  createGroup(name: string): TaskGroup {
    const id = crypto.randomUUID();
    const group: TaskGroup = {
      id,
      name: name || '新分组',
      expanded: true,
    };
    this.data.groups.push(group);
    this.save();
    return { ...group };
  }

  updateGroup(id: string, patch: { name?: string }): TaskGroup | null {
    const group = this.data.groups.find(g => g.id === id);
    if (!group) return null;
    if (patch.name !== undefined) group.name = patch.name;
    this.save();
    return { ...group, taskCount: this.data.tasks.filter(t => t.groupId === id).length };
  }

  deleteGroup(id: string, moveTasksTo?: string): boolean {
    // 不允许删除默认分组
    if (id === DEFAULT_GROUP_ID) return false;
    const idx = this.data.groups.findIndex(g => g.id === id);
    if (idx === -1) return false;

    // 迁移任务到目标分组或默认分组
    const targetGroup = moveTasksTo ?? DEFAULT_GROUP_ID;
    for (const task of this.data.tasks) {
      if (task.groupId === id) {
        task.groupId = targetGroup;
        task.updatedAt = new Date().toISOString();
      }
    }

    this.data.groups.splice(idx, 1);
    this.save();
    return true;
  }

  // ==========================================================================
  // 持久化
  // ==========================================================================

  private load(): TaskStoreData {
    try {
      if (!existsSync(this.storePath)) {
        return { ...DEFAULT_STORE, groups: [...DEFAULT_STORE.groups], tasks: [] };
      }
      const raw = readFileSync(this.storePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<TaskStoreData>;
      if (!Array.isArray(parsed.groups) || !Array.isArray(parsed.tasks)) {
        return { ...DEFAULT_STORE, groups: [...DEFAULT_STORE.groups], tasks: [] };
      }
      // 确保默认分组存在
      if (!parsed.groups.find(g => g.id === DEFAULT_GROUP_ID)) {
        parsed.groups.unshift({ id: DEFAULT_GROUP_ID, name: DEFAULT_GROUP_NAME, expanded: true });
      }
      return { groups: parsed.groups, tasks: parsed.tasks };
    } catch {
      return { ...DEFAULT_STORE, groups: [...DEFAULT_STORE.groups], tasks: [] };
    }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.storePath), { recursive: true });
      writeFileSync(this.storePath, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (err) {
      this.logger.error(t('agent.saveTasksFailed'), {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
