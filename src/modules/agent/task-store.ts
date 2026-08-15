// src/modules/agent/task-store.ts
// 任务持久化存储：~/.moss/tasks.json
// 结构：{ groups: TaskGroup[], tasks: TaskItem[] }
// TaskItem.id 即 sessionId（简化模型，1 task ↔ 1 session）

import { t } from '../../core/i18n';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readJsonStore, writeJsonStore } from '../filesys/store-io';
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
  /** 数据版本：3 = 已按 updatedAt 倒序规范化 order（修复 v2 反转迁移重复执行导致的顺序污染） */
  version?: number;
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
    this.migrateIfNeeded();
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
    // 新任务置于分组顶部：取分组内现有最小 order - 1（无任务时 0）
    const groupOrders = this.data.tasks
      .filter(t => t.groupId === gid)
      .map(t => t.order ?? Number.MAX_SAFE_INTEGER);
    const nextOrder = groupOrders.length ? Math.min(...groupOrders) - 1 : 0;
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

  /**
   * 任务活跃置顶：更新 updatedAt；若非组内最前，将 order 改为组内（除自身）最小 order - 1。
   * task.id 即 sessionId，engine 在每次用户消息时调用。任务不存在返回 null。
   */
  touchTask(id: string): TaskItem | null {
    const task = this.data.tasks.find(t => t.id === id);
    if (!task) return null;
    task.updatedAt = new Date().toISOString();
    const minOther = this.data.tasks
      .filter(t => t.groupId === task.groupId && t.id !== id)
      .reduce((min, t) => Math.min(min, t.order ?? Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
    if (task.order === undefined || task.order >= minOther) {
      task.order = minOther - 1;
    }
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
    // 拖拽只改顺序，不污染 updatedAt（updatedAt 语义 = 最近活跃，由 touchTask 维护）
    taskIds.forEach((id, idx) => {
      const task = idToTask.get(id)!;
      task.order = idx;
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

  /**
   * 一次性数据迁移（version 3）：按组内 updatedAt 倒序（缺失回退 createdAt）重排 order = 0,1,2...
   * 背景：v2 迁移（order 反转）曾因 load() 丢弃 version 字段而每次启动重复执行，
   * 把 createTask/touchTask 维护的"新/活跃任务 order 小（置顶）"反复翻转为沉底，
   * 磁盘顺序已被污染且无法从数据推断原始意图。v3 以 updatedAt（touchTask 维护的
   * 最近活跃时间）为唯一基准一次性规范化，与 touchTask 置顶语义一致；此后手动拖拽
   * （reorderTasks）与置顶（createTask/touchTask）的 order 被永久尊重。
   */
  private migrateIfNeeded(): void {
    if (this.data.version === 3) return;
    if (this.data.tasks.length === 0) {
      // 空数据直接标记已迁移（内存标记即可，下次写盘随 save 持久化），
      // 避免后续新建任务（置顶 order）后重启被本迁移覆盖
      this.data.version = 3;
      return;
    }
    const byGroup = new Map<string, TaskItem[]>();
    for (const t of this.data.tasks) {
      const list = byGroup.get(t.groupId) ?? [];
      list.push(t);
      byGroup.set(t.groupId, list);
    }
    for (const list of byGroup.values()) {
      list.sort((a, b) =>
        (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt), // 倒序：最近活跃在前
      );
      list.forEach((t, idx) => { t.order = idx; });
    }
    this.data.version = 3;
    this.save();
  }

  private load(): TaskStoreData {
    try {
      const fallback = (): TaskStoreData => ({ ...DEFAULT_STORE, groups: [...DEFAULT_STORE.groups], tasks: [] });
      if (!existsSync(this.storePath)) {
        return fallback();
      }
      const parsed = readJsonStore<Partial<TaskStoreData>>(this.storePath, {} as Partial<TaskStoreData>, this.logger);
      if (!Array.isArray(parsed.groups) || !Array.isArray(parsed.tasks)) {
        return fallback();
      }
      // 确保默认分组存在
      if (!parsed.groups.find(g => g.id === DEFAULT_GROUP_ID)) {
        parsed.groups.unshift({ id: DEFAULT_GROUP_ID, name: DEFAULT_GROUP_NAME, expanded: true });
      }
      return { groups: parsed.groups, tasks: parsed.tasks, version: parsed.version };
    } catch {
      return { ...DEFAULT_STORE, groups: [...DEFAULT_STORE.groups], tasks: [] };
    }
  }

  private save(): void {
    try {
      // store-io 统一原子写（tmp+fsync+rename）：修复旧版裸 writeFileSync 写一半崩溃丢全部任务
      writeJsonStore(this.storePath, this.data);
    } catch (err) {
      this.logger.error(t('agent.saveTasksFailed'), {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
