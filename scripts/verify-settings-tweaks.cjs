// 本轮核验：设置页微调（图标替换 / 删文档与任务流入口 / 渲染样式统一）
const fs = require('node:fs');

const ROOT = 'c:/Users/赵晨旭/Desktop/MOSS-OS';
let pass = 0;
let fail = 0;

function check(file, label, fn) {
  const src = fs.readFileSync(`${ROOT}/${file}`, 'utf8');
  const ok = fn(src);
  if (ok) {
    pass++;
    console.log(`  PASS ${label}`);
  } else {
    fail++;
    console.log(`  FAIL ${label}  <== ${file}`);
  }
}

const SP = 'webui/src/components/pages/SettingsPage.tsx';

// ===== SettingsPage.tsx =====
check(SP, 'Settings: import 含 Activity/Notebook', s =>
  /(^|\s)Activity,/.test(s) && /(^|\s)Notebook,/.test(s));
check(SP, 'Settings: import 已移除 MessageSquare/FileText', s =>
  !/\bMessageSquare\b/.test(s) && !/\bFileText\b/.test(s));
check(SP, 'Settings: Database import 保留（context navItem 仍用）', s =>
  /(^|\s)Database,/.test(s) && s.includes("Icon: Database }"));
check(SP, 'Settings: navItems 无 task 项', s => {
  const m = s.match(/export const settingsNavItems[\s\S]*?\];/);
  return m ? !m[0].includes("id: 'task'") : false;
});
check(SP, 'Settings: 搜索索引无 task/docs 条目', s =>
  !s.includes('settings.placeholder.taskTitle') && !s.includes('settings.placeholder.docsTitle'));
check(SP, 'Settings: 引擎 Tab 用 Activity', s =>
  s.includes('<Activity className="size-3.5" />'));
check(SP, 'Settings: 记忆 Tab 用 Notebook', s =>
  s.includes('<Notebook className="size-3.5" />'));
check(SP, 'Settings: 无 docs TabsTrigger', s => !s.includes('value="docs"'));
check(SP, 'Settings: tab 白名单无 docs（回落 engine）', s =>
  s.includes("['specs', 'index', 'rules', 'memory'].includes(suffix)"));
check(SP, 'Settings: 渲染设置无 Card 包裹', s => {
  const m = s.match(/export function RenderSettingsSection[\s\S]*?\n\}/);
  return m ? !m[0].includes('<Card') : false;
});
check(SP, 'Settings: 渲染设置用 border 组容器（与其他设置项一致）', s => {
  const m = s.match(/export function RenderSettingsSection[\s\S]*?\n\}/);
  return m
    ? m[0].includes('flex flex-col gap-6 p-6') &&
        m[0].includes('flex flex-col rounded-lg border border-border px-4')
    : false;
});
check(SP, 'Settings: 占位表无 task/docs，兜底 hooks', s => {
  const m = s.match(/const PLACEHOLDER_SECTION_KEYS[\s\S]*?\n\};/);
  if (!m) return false;
  return !m[0].includes('task:') && !m[0].includes('docs:') &&
    s.includes('?? PLACEHOLDER_SECTION_KEYS.hooks');
});

// ===== App.tsx =====
check('webui/src/App.tsx', 'App: 无 task 路由', s =>
  !s.includes('path="task"'));
check('webui/src/App.tsx', 'App: 无 context docs 子路由 / docs 重定向', s =>
  !s.includes('section="docs"') && !s.includes('/settings/context/docs'));

// ===== types/index.ts =====
check('webui/src/types/index.ts', 'types: SettingsSection 无 task/docs', s => {
  const m = s.match(/export type SettingsSection[\s\S]*?;/);
  return m ? !m[0].includes("'task'") && !m[0].includes("'docs'") : false;
});

// ===== i18n =====
check('webui/src/i18n/locales/zh.ts', 'zh: task/docs 8 key 已删，about.docs 保留', s =>
  !s.includes("task: '任务流'") && !s.includes('taskTitle') && !s.includes('taskDesc') &&
  !s.includes('docsTitle') && !s.includes('docsDesc') &&
  !s.includes("docs: '文档',\n      commands") &&
  s.includes("docs: '文档',") && s.includes("context: '上下文',"));
check('webui/src/i18n/locales/en.ts', 'en: task/docs 8 key 已删，about.docs 保留', s =>
  !s.includes("task: 'Task'") && !s.includes('taskTitle') && !s.includes('taskDesc') &&
  !s.includes('docsTitle') && !s.includes('docsDesc') &&
  !s.includes("docs: 'Docs',\n      commands") &&
  s.includes("docs: 'Documentation'") && s.includes("context: 'Context',"));

console.log(`\n结果: ${pass} PASS / ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
