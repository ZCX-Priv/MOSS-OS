// src/modules/agent/task-store.ts
// 任务持久化存储（v4 体系）：
//   ~/.moss/task.json                            总管：分组定义 + task↔session 索引（调度入口）
//   ~/.moss/tasks/<groupId>/task.json            组内任务元信息（TaskItem[]）
//   ~/.moss/tasks/<groupId>/<sessionId>.json     组内各任务的消息历史（由 SessionStore 写入）
// TaskItem.id 即 sessionId（简化模型，1 task ↔ 1 session）
// 旧版单文件 tasks.json + sessions/ 目录在启动时一次性迁移并删除（可重入/幂等）。

import { t } from '../../core/i18n';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  rmdirSync,
  unlinkSync,
} from 'node:fs';
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

/** 总管 task.json 结构 */
interface TaskRootStore {
  /** 数据版本：4 = 分散存储体系（总管 + 按组目录） */
  version?: number;
  groups: TaskGroup[];
  /** taskId → { groupId, sessionId }（调度索引：不读组文件即可解析归属） */
  index: Record<string, { groupId: string; sessionId: string }>;
}

/** 旧版单文件结构（仅迁移时读取） */
interface LegacyTaskStore {
  version?: number;
  groups: TaskGroup[];
  tasks: TaskItem[];
}

const DEFAULT_GROUP_ID = 'default';
const DEFAULT_GROUP_NAME = '默认任务';
/** 组内任务元信息文件名（与根总管 task.json 同名，不同层级） */
const GROUP_TASKS_FILE = 'task.json';

/** 组目录名清洗：UUID 与 'default' 均满足；防 `../` 等路径穿越 */
function safeGroupId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '');
}

export class TaskStore {
  /** 总管：~/.moss/task.json */
  private readonly rootPath: string;
  /** 旧版单文件：~/.moss/tasks.json（迁移源，迁移后删除） */
  private readonly legacyPath: string;
  /** 任务根目录：~/.moss/tasks */
  private readonly tasksDir: string;
  /** 旧版会话目录：~/.moss/sessions（迁移源，迁移后删除） */
  private readonly legacySessionsDir: string;
  private readonly logger: Logger;
  private groups!: TaskGroup[];
  private index!: Record<string, { groupId: string; sessionId: string }>;
  /** groupId → 该组任务列表 */
  private readonly tasksByGroup = new Map<string, TaskItem[]>();

  constructor(env: Environment, logger: Logger) {
    this.rootPath = join(env.dataDir, 'task.json');
    this.legacyPath = join(env.dataDir, 'tasks.json');
    this.tasksDir = join(env.dataDir, 'tasks');
    this.legacySessionsDir = join(env.dataDir, 'sessions');
    this.logger = logger;
    this.migrateFromLegacy();
    this.load();
  }

  // ==========================================================================
  // 任务 CRUD
  // ==========================================================================

  listTasks(): TaskItem[] {
    return this.allTasks()
      .map(tk => ({ ...tk }))
      .sort((a, b) => {
        const oa = a.order ?? Number.MAX_SAFE_INTEGER;
        const ob = b.order ?? Number.MAX_SAFE_INTEGER;
        if (oa !== ob) return oa - ob;
        // order 相同（含均缺失）时回退 createdAt 倒序
        return b.createdAt.localeCompare(a.createdAt);
      });
  }

  getTask(id: string): TaskItem | null {
    const task = this.findTask(id);
    return task ? { ...task } : null;
  }

  /** 查询 taskId 所属分组（供 SessionStore 解析 session 文件路径）；未知返回 null */
  getGroupIdOf(taskId: string): string | null {
    return this.index[taskId]?.groupId ?? null;
  }

  createTask(title: string, groupId?: string): TaskItem {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const gid = this.validGroupId(groupId) ?? DEFAULT_GROUP_ID;
    const groupTasks = this.tasksByGroup.get(gid) ?? [];
    // 新任务置于分组顶部：取分组内现有最小 order - 1（无任务时 0）
    const nextOrder = groupTasks.length
      ? Math.min(...groupTasks.map(tk => tk.order ?? Number.MAX_SAFE_INTEGER)) - 1
      : 0;
    const task: TaskItem = {
      id,
      title: title || '新任务',
      groupId: gid,
      createdAt: now,
      updatedAt: now,
      sessionId: id, // task.id 即 sessionId
      order: nextOrder,
    };
    groupTasks.push(task);
    this.tasksByGroup.set(gid, groupTasks);
    this.index[id] = { groupId: gid, sessionId: id };
    this.saveGroupTasks(gid);
    this.saveRoot();
    this.logger.debug(t('agent.taskCreated', { id }), { title, groupId: gid });
    return { ...task };
  }

  updateTask(id: string, patch: { title?: string; groupId?: string }): TaskItem | null {
    const task = this.findTask(id);
    if (!task) return null;
    const oldGid = task.groupId;
    if (patch.title !== undefined) task.title = patch.title;
    if (patch.groupId !== undefined && this.validGroupId(patch.groupId) && patch.groupId !== oldGid) {
      // 移动分组：从旧组移除、加入新组，并同步搬移磁盘上的 session 文件
      const newGid = patch.groupId;
      const oldList = this.tasksByGroup.get(oldGid) ?? [];
      this.tasksByGroup.set(oldGid, oldList.filter(tk => tk.id !== id));
      task.groupId = newGid;
      // 移入置顶：order = 新组内最小 order - 1（空组为 0），与 createTask/touchTask 语义一致
      const newGroupOrders = (this.tasksByGroup.get(newGid) ?? [])
        .map(tk => tk.order ?? Number.MAX_SAFE_INTEGER);
      task.order = newGroupOrders.length ? Math.min(...newGroupOrders) - 1 : 0;
      const newList = this.tasksByGroup.get(newGid) ?? [];
      newList.push(task);
      this.tasksByGroup.set(newGid, newList);
      this.index[id] = { groupId: newGid, sessionId: task.sessionId ?? id };
      this.moveSessionFile(id, oldGid, newGid);
      this.saveGroupTasks(oldGid);
      this.saveGroupTasks(newGid);
      this.saveRoot();
    } else {
      this.saveGroupTasks(oldGid);
    }
    task.updatedAt = new Date().toISOString();
    this.saveGroupTasks(task.groupId);
    return { ...task };
  }

  /**
   * 任务活跃置顶：更新 updatedAt；若非组内最前，将 order 改为组内（除自身）最小 order - 1。
   * task.id 即 sessionId，engine 在每次用户消息时调用。任务不存在返回 null。
   */
  touchTask(id: string): TaskItem | null {
    const task = this.findTask(id);
    if (!task) return null;
    task.updatedAt = new Date().toISOString();
    const groupTasks = this.tasksByGroup.get(task.groupId) ?? [];
    const minOther = groupTasks
      .filter(tk => tk.id !== id)
      .reduce((min, tk) => Math.min(min, tk.order ?? Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
    if (task.order === undefined || task.order >= minOther) {
      task.order = minOther - 1;
    }
    this.saveGroupTasks(task.groupId);
    return { ...task };
  }

  deleteTask(id: string): boolean {
    const task = this.findTask(id);
    if (!task) return false;
    const gid = task.groupId;
    this.tasksByGroup.set(gid, (this.tasksByGroup.get(gid) ?? []).filter(tk => tk.id !== id));
    delete this.index[id];
    this.saveGroupTasks(gid);
    this.saveRoot();
    return true;
  }

  /**
   * 按给定 id 顺序重写对应任务的 order（0,1,2...）。
   * 通常入参为某分组内的全部任务 id，重排后组内顺序即入参顺序。
   * 任一 id 不存在则整体失败、不写入。返回是否全部命中。
   */
  reorderTasks(taskIds: string[]): boolean {
    const idToTask = new Map(this.allTasks().map(tk => [tk.id, tk]));
    for (const id of taskIds) {
      if (!idToTask.has(id)) return false;
    }
    // 拖拽只改顺序，不污染 updatedAt（updatedAt 语义 = 最近活跃，由 touchTask 维护）
    const dirtyGroups = new Set<string>();
    taskIds.forEach((id, idx) => {
      const task = idToTask.get(id)!;
      task.order = idx;
      dirtyGroups.add(task.groupId);
    });
    for (const gid of dirtyGroups) this.saveGroupTasks(gid);
    return true;
  }

  /** 按标题搜索任务（大小写不敏感子串匹配） */
  searchTasks(query: string): TaskItem[] {
    const q = query.toLowerCase();
    return this.allTasks()
      .filter(tk => tk.title.toLowerCase().includes(q))
      .map(tk => ({ ...tk }));
  }

  // ==========================================================================
  // 分组 CRUD
  // ==========================================================================

  listGroups(): TaskGroup[] {
    // 附带 taskCount
    return this.groups.map(g => ({
      ...g,
      taskCount: (this.tasksByGroup.get(g.id) ?? []).length,
    }));
  }

  createGroup(name: string): TaskGroup {
    const id = crypto.randomUUID();
    const group: TaskGroup = {
      id,
      name: name || '新分组',
      expanded: true,
    };
    this.groups.push(group);
    this.tasksByGroup.set(id, []);
    this.saveRoot();
    return { ...group, taskCount: 0 };
  }

  updateGroup(id: string, patch: { name?: string }): TaskGroup | null {
    const group = this.groups.find(g => g.id === id);
    if (!group) return null;
    if (patch.name !== undefined) group.name = patch.name;
    this.saveRoot();
    return { ...group, taskCount: (this.tasksByGroup.get(id) ?? []).length };
  }

  deleteGroup(id: string, moveTasksTo?: string): boolean {
    // 不允许删除默认分组
    if (id === DEFAULT_GROUP_ID) return false;
    const idx = this.groups.findIndex(g => g.id === id);
    if (idx === -1) return false;

    // 迁移任务到目标分组或默认分组（组文件 + session 文件一并搬移）
    const targetGroup = this.validGroupId(moveTasksTo) ? moveTasksTo! : DEFAULT_GROUP_ID;
    const moving = this.tasksByGroup.get(id) ?? [];
    const targetList = this.tasksByGroup.get(targetGroup) ?? [];
    const now = new Date().toISOString();
    for (const task of moving) {
      task.groupId = targetGroup;
      task.updatedAt = now;
      targetList.push(task);
      this.index[task.id] = { groupId: targetGroup, sessionId: task.sessionId ?? task.id };
      this.moveSessionFile(task.id, id, targetGroup);
    }
    this.tasksByGroup.set(targetGroup, targetList);
    this.tasksByGroup.delete(id);
    this.groups.splice(idx, 1);
    this.saveGroupTasks(targetGroup);
    this.saveRoot();
    // 清理旧组目录（session 文件已搬走，仅剩组 task.json 与空目录）
    try {
      rmSync(join(this.tasksDir, id), { recursive: true, force: true });
    } catch (err) {
      this.logger.warn(t('agent.taskStoreCleanupFailed'), {
        dir: id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  // ==========================================================================
  // 旧数据迁移（一次性、可重入/幂等）
  // ==========================================================================

  /**
   * 旧版（v3 及更早）：~/.moss/tasks.json（groups+tasks 单文件）+ ~/.moss/sessions/<sid>.json。
   * 迁移顺序：写各组 task.json → 写总管 task.json → 搬 sessions → 删 tasks.json → 删 sessions/。
   * 任一步中断后重启可续跑：组文件/总管重写幂等；session 目标已存在则删源；
   * sessions/ 目录仅在清空后删除；tasks.json 最后删除。
   */
  private migrateFromLegacy(): void {
    try {
      if (existsSync(this.legacyPath) && !existsSync(this.rootPath)) {
        const legacy = readJsonStore<Partial<LegacyTaskStore>>(
          this.legacyPath,
          {} as Partial<LegacyTaskStore>,
          this.logger,
        );
        if (Array.isArray(legacy.groups) && Array.isArray(legacy.tasks)) {
          const groups = [...legacy.groups];
          if (!groups.find(g => g.id === DEFAULT_GROUP_ID)) {
            groups.unshift({ id: DEFAULT_GROUP_ID, name: DEFAULT_GROUP_NAME, expanded: true });
          }
          const byGroup = new Map<string, TaskItem[]>();
          for (const task of legacy.tasks) {
            const gid = groups.find(g => g.id === task.groupId) ? task.groupId : DEFAULT_GROUP_ID;
            const list = byGroup.get(gid) ?? [];
            list.push({ ...task, groupId: gid });
            byGroup.set(gid, list);
          }
          for (const [gid, tasks] of byGroup) {
            writeJsonStore(join(this.tasksDir, safeGroupId(gid), GROUP_TASKS_FILE), tasks);
          }
          const index: TaskRootStore['index'] = {};
          for (const [gid, tasks] of byGroup) {
            for (const task of tasks) {
              index[task.id] = { groupId: gid, sessionId: task.sessionId ?? task.id };
            }
          }
          const root: TaskRootStore = { version: 4, groups, index };
          writeJsonStore(this.rootPath, root);
          this.logger.info(t('agent.taskStoreMigrated', { count: legacy.tasks.length }));
        }
      }
      this.migrateLegacySessions();
      // sessions/ 已清理但 tasks.json 仍残留（异常中断）：数据已在总管+组文件，直接删除
      if (existsSync(this.legacyPath) && !existsSync(this.legacySessionsDir)) {
        unlinkSync(this.legacyPath);
      }
    } catch (err) {
      // 迁移失败不阻断启动：下次启动重试（幂等）
      this.logger.warn(t('agent.taskStoreMigrationFailed'), {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** 搬移旧 sessions/<sid>.json → tasks/<groupId>/<sid>.json；全部完成后删除旧目录 */
  private migrateLegacySessions(): void {
    if (!existsSync(this.legacySessionsDir)) return;
    // 迁移需总管 index 就绪；总管缺失时无法定组，留待下次启动（migrateFromLegacy 前半段已写）
    if (!existsSync(this.rootPath)) return;
    const root = readJsonStore<Partial<TaskRootStore>>(this.rootPath, {} as Partial<TaskRootStore>, this.logger);
    const index = root.index ?? {};
    const entries = readdirSync(this.legacySessionsDir);
    for (const name of entries) {
      if (!name.endsWith('.json')) continue;
      const sid = name.slice(0, -'.json'.length);
      const gid = safeGroupId(index[sid]?.groupId ?? DEFAULT_GROUP_ID);
      const src = join(this.legacySessionsDir, name);
      const destDir = join(this.tasksDir, gid);
      const dest = join(destDir, name);
      try {
        if (existsSync(dest)) {
          // 上次迁移中断残留：目标已在位，删源即完成
          unlinkSync(src);
        } else {
          mkdirSync(destDir, { recursive: true });
          renameSync(src, dest);
        }
      } catch (err) {
        this.logger.warn(t('agent.taskStoreMigrationFailed'), {
          file: name,
          error: err instanceof Error ? err.message : String(err),
        });
        return; // 有失败即中止本轮，保留旧目录下次续迁
      }
    }
    // 全部搬空：删除旧目录与旧 tasks.json
    // 注意：Bun on Windows 的 rmSync(recursive:false, force:true) 触发 EFAULT bug，空目录删除用 rmdirSync
    try {
      rmdirSync(this.legacySessionsDir);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        this.logger.warn(t('agent.taskStoreCleanupFailed'), {
          dir: this.legacySessionsDir,
          error: code ?? String(err),
        });
      }
      return; // 目录非空或被占用：保留，下次续跑
    }
    if (existsSync(this.legacyPath)) unlinkSync(this.legacyPath);
  }

  // ==========================================================================
  // 持久化
  // ==========================================================================

  /** 加载总管 + 扫描各组 task.json，以文件为真相源自愈索引 */
  private load(): void {
    const root = readJsonStore<Partial<TaskRootStore>>(this.rootPath, {} as Partial<TaskRootStore>, this.logger);
    this.groups = Array.isArray(root.groups) ? [...root.groups] : [];
    if (!this.groups.find(g => g.id === DEFAULT_GROUP_ID)) {
      this.groups.unshift({ id: DEFAULT_GROUP_ID, name: DEFAULT_GROUP_NAME, expanded: true });
    }
    this.index = root.index && typeof root.index === 'object' ? { ...root.index } : {};
    this.tasksByGroup.clear();

    // 扫描 tasks/<groupId>/task.json（以磁盘目录为准，单文件损坏自动 .corrupt 留档跳过）
    if (existsSync(this.tasksDir)) {
      for (const entry of readdirSync(this.tasksDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const gid = safeGroupId(entry.name);
        if (!gid) continue;
        const tasks = readJsonStore<TaskItem[]>(
          join(this.tasksDir, gid, GROUP_TASKS_FILE),
          [] as TaskItem[],
          this.logger,
        ).filter(tk => typeof tk?.id === 'string');
        // 目录即归属：修正任务 groupId 与目录不一致的脏数据
        for (const tk of tasks) tk.groupId = gid;
        this.tasksByGroup.set(gid, tasks);
        // 磁盘目录无对应分组定义（分组定义被手删）：补占位分组，避免任务不可见
        if (!this.groups.find(g => g.id === gid)) {
          this.groups.push({ id: gid, name: gid, expanded: true });
        }
      }
    }
    // 确保每个分组都有任务列表
    for (const g of this.groups) {
      if (!this.tasksByGroup.has(g.id)) this.tasksByGroup.set(g.id, []);
    }

    // 自愈索引：文件为准补缺、删悬空；有变化回写
    let dirty = false;
    for (const [gid, tasks] of this.tasksByGroup) {
      for (const tk of tasks) {
        if (!this.index[tk.id]) {
          this.index[tk.id] = { groupId: gid, sessionId: tk.sessionId ?? tk.id };
          dirty = true;
        } else if (this.index[tk.id].groupId !== gid) {
          this.index[tk.id] = { groupId: gid, sessionId: tk.sessionId ?? tk.id };
          dirty = true;
        }
      }
    }
    for (const id of Object.keys(this.index)) {
      if (!this.findTask(id)) {
        delete this.index[id];
        dirty = true;
      }
    }
    if (dirty) this.saveRoot();
  }

  /** 写总管 task.json（分组定义 + task↔session 索引） */
  private saveRoot(): void {
    try {
      const root: TaskRootStore = { version: 4, groups: this.groups, index: this.index };
      writeJsonStore(this.rootPath, root);
    } catch (err) {
      this.logger.error(t('agent.saveTasksFailed'), {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** 写组文件 tasks/<groupId>/task.json */
  private saveGroupTasks(groupId: string): void {
    try {
      writeJsonStore(
        join(this.tasksDir, safeGroupId(groupId), GROUP_TASKS_FILE),
        this.tasksByGroup.get(groupId) ?? [],
      );
    } catch (err) {
      this.logger.error(t('agent.saveTasksFailed'), {
        groupId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** 搬移磁盘 session 文件 tasks/<fromGid>/<sid>.json → tasks/<toGid>/<sid>.json（不存在则跳过） */
  private moveSessionFile(sessionId: string, fromGid: string, toGid: string): void {
    try {
      const sid = sessionId;
      const src = join(this.tasksDir, safeGroupId(fromGid), `${sid}.json`);
      if (!existsSync(src)) return;
      const destDir = join(this.tasksDir, safeGroupId(toGid));
      mkdirSync(destDir, { recursive: true });
      renameSync(src, join(destDir, `${sid}.json`));
    } catch (err) {
      this.logger.warn(t('agent.taskStoreCleanupFailed'), {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ==========================================================================
  // 内部工具
  // ==========================================================================

  private allTasks(): TaskItem[] {
    const out: TaskItem[] = [];
    for (const list of this.tasksByGroup.values()) out.push(...list);
    return out;
  }

  private findTask(id: string): TaskItem | null {
    const gid = this.index[id]?.groupId;
    if (gid) {
      const task = (this.tasksByGroup.get(gid) ?? []).find(tk => tk.id === id);
      if (task) return task;
    }
    // 索引缺失兜底：线性查找（load 自愈后罕见）
    for (const list of this.tasksByGroup.values()) {
      const task = list.find(tk => tk.id === id);
      if (task) return task;
    }
    return null;
  }

  /** groupId 合法性：必须在分组定义中存在（防路径穿越与孤儿任务） */
  private validGroupId(groupId: string | undefined): string | null {
    if (!groupId) return null;
    return this.groups.find(g => g.id === groupId) ? groupId : null;
  }
}
