// 综合核验脚本：断言分组功能修复的所有关键改动已落实到磁盘（防编辑工具虚假成功）
const fs = require('fs');
const base = 'c:/Users/赵晨旭/Desktop/MOSS-OS';
const read = (p) => fs.readFileSync(`${base}/${p}`, 'utf8');

let pass = 0;
let fail = 0;
function check(name, file, conditions) {
  const src = read(file);
  const missing = conditions.filter((c) => !src.includes(c));
  if (missing.length === 0) {
    pass++;
    console.log(`PASS ${file} :: ${name}`);
  } else {
    fail++;
    console.log(`FAIL ${file} :: ${name} :: 缺失: ${JSON.stringify(missing)}`);
  }
}
function checkAbsent(name, file, absentConditions) {
  const src = read(file);
  const leaked = absentConditions.filter((c) => src.includes(c));
  if (leaked.length === 0) {
    pass++;
    console.log(`PASS ${file} :: ${name} (已移除旧代码)`);
  } else {
    fail++;
    console.log(`FAIL ${file} :: ${name} :: 残留: ${JSON.stringify(leaked)}`);
  }
}

// 1. 后端 task-store.ts
check('TaskGroup.source 字段', 'src/modules/agent/task-store.ts', ["source?: 'folder' | 'manual';"]);
check('createGroup 签名', 'src/modules/agent/task-store.ts', ['createGroup(name: string, source?: \'folder\' | \'manual\'): TaskGroup {']);
check('deleteGroup 双模式签名', 'src/modules/agent/task-store.ts', ['deleteGroup(id: string, opts?: { moveTasksTo?: string; deleteTasks?: boolean }): boolean {']);
check('deleteTasks 分支', 'src/modules/agent/task-store.ts', ['if (opts?.deleteTasks) {']);
check('pruneEmptyFolderGroups 方法', 'src/modules/agent/task-store.ts', ['private pruneEmptyFolderGroups(): void {']);
check('prune 调用点×3', 'src/modules/agent/task-store.ts', ['this.pruneEmptyFolderGroups();']);
const tsCount = (read('src/modules/agent/task-store.ts').match(/this\.pruneEmptyFolderGroups\(\);/g) || []).length;
if (tsCount === 3) { pass++; console.log('PASS task-store.ts :: prune 调用点数量 = 3'); }
else { fail++; console.log(`FAIL task-store.ts :: prune 调用点数量 = ${tsCount}（期望 3）`); }

// 2. 后端 engine.ts
check('createTaskGroup 签名', 'src/modules/agent/engine.ts', ["createTaskGroup(name: string, source?: 'folder' | 'manual'): TaskGroup {"]);
check('deleteTaskGroup 双模式 + deleteSession 先行', 'src/modules/agent/engine.ts', [
  'deleteTaskGroup(id: string, opts?: { moveTasksTo?: string; deleteTasks?: boolean }): boolean {',
  'this.deleteSession(tk.id);',
]);

// 3. 后端 routes/tasks.ts
check('POST 透传 source', 'src/modules/server/routes/tasks.ts', [
  "const body = (req.body ?? {}) as { name?: string; source?: 'folder' | 'manual' };",
  'engine.createTaskGroup(body.name, body.source)',
]);
check('DELETE 透传 deleteTasks', 'src/modules/server/routes/tasks.ts', [
  'const body = (req.body ?? {}) as { moveTasksTo?: string; deleteTasks?: boolean };',
  'deleteTasks: body.deleteTasks,',
]);

// 4. 前端类型与 API
check('前端 TaskGroup.source', 'webui/src/types/api.ts', ["source?: 'folder' | 'manual';"]);
check('api.createTaskGroup 签名', 'webui/src/api/http.ts', ["createTaskGroup: (name: string, source?: 'folder' | 'manual') =>"]);
check('api.deleteTaskGroup 签名', 'webui/src/api/http.ts', ['deleteTaskGroup: (id: string, moveTasksTo?: string, deleteTasks?: boolean) =>']);

// 5. 前端 hooks
check('ensureTaskGroup 传 folder', 'webui/src/hooks/useTask.ts', ["api.createTaskGroup(name, 'folder')"]);
check('useTasks 移组销毁感知', 'webui/src/hooks/useTasks.ts', ['sourceIsFolder']);
check('useTasks deleteTask 后 load', 'webui/src/hooks/useTasks.ts', ['删除后源组若为空文件夹分组则后端已自动销毁']);
check('useTasks deleteTaskGroup 透传', 'webui/src/hooks/useTasks.ts', ['deleteTaskGroup(id, moveTasksTo, deleteTasks)']);

// 6. 前端 Sidebar.tsx
check('imports（Checkbox/AlertDialog/api）', 'webui/src/components/layout/Sidebar.tsx', [
  "import { Checkbox } from '@/components/ui/checkbox';",
  "from '@/components/ui/alert-dialog';",
  "import { api } from '../../api/http';",
]);
check('解构 reload', 'webui/src/components/layout/Sidebar.tsx', ['deleteTaskGroup, reload } = useTasks()']);
check('deleteGroupAlsoTasks 状态', 'webui/src/components/layout/Sidebar.tsx', ['const [deleteGroupAlsoTasks, setDeleteGroupAlsoTasks] = useState(false);']);
check('handleDeleteGroup 透传', 'webui/src/components/layout/Sidebar.tsx', ["await deleteTaskGroup(deleteGroupId, 'default', deleteGroupAlsoTasks);"]);
check('批量删除直调 API + 统一刷新', 'webui/src/components/layout/Sidebar.tsx', ['await api.deleteTask(id);', 'await reload();']);
check('默认组空时隐藏', 'webui/src/components/layout/Sidebar.tsx', [".filter((group) => group.id !== 'default' || tasks.some((task) => task.groupId === 'default'))"]);
check('默认组文案特判', 'webui/src/components/layout/Sidebar.tsx', ["const groupLabel = group.id === 'default' ? t('sidebar.defaultGroup') : group.name;"]);
check('默认组隐藏重命名+删除菜单', 'webui/src/components/layout/Sidebar.tsx', ["{group.id !== 'default' && (", 'setDeleteGroupAlsoTasks(false); setDeleteGroupId(group.id);']);
check('删除弹窗 Checkbox', 'webui/src/components/layout/Sidebar.tsx', ['checked={deleteGroupAlsoTasks}', 'setDeleteGroupAlsoTasks(v === true)', "t('sidebar.deleteGroupAlsoDeleteTasks')"]);
check('删除弹窗动态描述', 'webui/src/components/layout/Sidebar.tsx', ["deleteGroupAlsoTasks ? t('sidebar.deleteGroupPurgeDesc') : t('sidebar.deleteGroupMoveDesc')"]);
checkAbsent('计数徽标已删除', 'webui/src/components/layout/Sidebar.tsx', ['分组计数', 'groupTasks.length}\n        </span>']);
checkAbsent('旧 ConfirmDialog 删除分组弹窗已替换', 'webui/src/components/layout/Sidebar.tsx', ['title={t(\'sidebar.deleteGroup\')}\n      description={t(\'sidebar.deleteGroupDesc\')}']);

// 7. i18n
check('zh 新 key', 'webui/src/i18n/locales/zh.ts', [
  "defaultGroup: '默认',",
  "deleteGroupMoveDesc: '组内任务将移至默认分组。',",
  "deleteGroupPurgeDesc: '组内所有任务将被一并删除。',",
  "deleteGroupAlsoDeleteTasks: '同时删除分组内所有的任务',",
  "deleteGroupDesc: '确定要删除该分组吗？此操作不可撤销。',",
]);
check('en 新 key', 'webui/src/i18n/locales/en.ts', [
  "defaultGroup: 'Default',",
  "deleteGroupMoveDesc: 'Tasks in this group will be moved to the default group.',",
  "deleteGroupPurgeDesc: 'All tasks in this group will be deleted as well.',",
  "deleteGroupAlsoDeleteTasks: 'Also delete all tasks in this group',",
  "deleteGroupDesc: 'Are you sure you want to delete this group? This action cannot be undone.',",
]);

console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail === 0 ? 0 : 1);
