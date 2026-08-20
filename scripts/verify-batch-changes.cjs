// 临时核验脚本：直读文件确认所有编辑已落实（Edit 工具存在虚假成功缓存问题）
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

// ===== 1. TaskPage.tsx：中控岛自动行为 + 统一口径 =====
check('webui/src/components/pages/TaskPage.tsx', 'TaskPage: handleHubModuleChange 包装回调', s =>
  s.includes('const handleHubModuleChange = useCallback'));
check('webui/src/components/pages/TaskPage.tsx', 'TaskPage: todo 3s 自动折叠定时器', s =>
  s.includes('todoCollapseTimerRef.current = window.setTimeout') && s.includes('3000'));
check('webui/src/components/pages/TaskPage.tsx', 'TaskPage: 竞态防护（lastUserActionAt <= autoExpandAt）', s =>
  s.includes('lastUserActionAtRef.current <= autoExpandAtRef.current'));
check('webui/src/components/pages/TaskPage.tsx', 'TaskPage: 会话切换重置基准', s =>
  s.includes('lastHubTaskIdRef.current !== taskId'));
check('webui/src/components/pages/TaskPage.tsx', 'TaskPage: ask 新增自动切换', s =>
  s.includes("setHubActiveModule(taskId, 'ask');"));
check('webui/src/components/pages/TaskPage.tsx', 'TaskPage: confirm 新增自动切换', s =>
  s.includes("setHubActiveModule(taskId, 'permission');"));
check('webui/src/components/pages/TaskPage.tsx', 'TaskPage: 回答后折叠（ask 清零分支）', s =>
  s.includes('prevAsk > 0 && askCount === 0 && hubActiveModule === \'ask\''));
check('webui/src/components/pages/TaskPage.tsx', 'TaskPage: ControlHub 使用包装回调', s =>
  s.includes('onActiveModuleChange={handleHubModuleChange}'));
check('webui/src/components/pages/TaskPage.tsx', 'TaskPage: cleanup 清理定时器', s =>
  s.includes('clearTodoCollapseTimer(); // 清理待执行的 todo 自动折叠定时器'));
check('webui/src/components/pages/TaskPage.tsx', 'TaskPage: ContextStackedBar usedTokens prop', s =>
  s.includes('usedTokens?: number | null') && s.includes('const total = usedTokens && usedTokens > 0 ? usedTokens : breakdown.total'));
check('webui/src/components/pages/TaskPage.tsx', 'TaskPage: 调用处传真实 promptTokens', s =>
  s.includes('usedTokens={contextStats.lastUsage?.promptTokens ?? null}'));
check('webui/src/components/pages/TaskPage.tsx', 'TaskPage: 分段缩放公式', s =>
  s.includes('((s.value * scale) / window) * 100'));

// ===== 2. 后端持久化 =====
check('src/modules/context/types.ts', 'types: SessionContextTelemetry 接口', s =>
  s.includes('export interface SessionContextTelemetry'));
check('src/modules/context/types.ts', 'types: ContextSessionLike.contextTelemetry 字段', s =>
  s.includes('contextTelemetry?: SessionContextTelemetry;'));
check('src/modules/agent/session.ts', 'session: Session.contextTelemetry 字段', s =>
  s.includes('contextTelemetry?: SessionContextTelemetry;'));
check('src/modules/agent/session.ts', 'session: SessionContextTelemetry import', s =>
  s.includes("import type { CompactionRecord, EnvContextInfo, SessionContextTelemetry } from '../context/types';"));
check('src/modules/context/api/service.ts', 'service: buildRequestView import', s =>
  s.includes("import { buildStaticSystemPrompt, buildRequestView, getSystemSections } from '../compiler';"));
check('src/modules/context/api/service.ts', 'service: recomputeView 方法', s =>
  s.includes('private recomputeView(session: ContextSessionLike, t: SessionTelemetry): void'));
check('src/modules/context/api/service.ts', 'service: getStats 惰性重算', s =>
  s.includes('if (!t.lastBreakdown)') && s.includes('this.recomputeView(session, t);'));
check('src/modules/context/api/service.ts', 'service: usage 单一真源读 session', s =>
  s.includes('session.contextTelemetry?.lastUsage ?? null') && s.includes('session.contextTelemetry?.cacheHits ?? []'));
check('src/modules/context/api/service.ts', 'service: usedPercent 统一口径', s =>
  s.includes('const usedTokens = session.contextTelemetry?.lastUsage?.promptTokens ?? breakdown.total;'));
check('src/modules/context/api/service.ts', 'service: onTurnUsage 持久化', s =>
  s.includes('session.contextTelemetry = { lastUsage, cacheHits };') && s.includes('this.sessionStore?.persist(session);'));
check('src/modules/context/api/service.ts', 'service: 内存遥测无 lastUsage/cacheHits 残留', s =>
  !/\bt\.lastUsage\b/.test(s) && !/\bt\.cacheHits\b/.test(s));
check('src/modules/context/api/service.ts', 'service: CacheHitSample import 已清理', s =>
  !s.includes('CacheHitSample,'));
check('src/modules/context/index.ts', 'index: SessionContextTelemetry 导出', s =>
  s.includes('SessionContextTelemetry,'));

// ===== 3. i18n =====
check('webui/src/i18n/locales/zh.ts', 'zh: nav.context 改为 上下文', s =>
  s.includes("context: '上下文',") && !s.includes("context: '上下文引擎',"));
check('webui/src/i18n/locales/zh.ts', 'zh: pageDesc 已删除 + tabEngine 新增', s =>
  !s.includes("pageDesc: '上下文引擎基础设施") && s.includes("tabEngine: '引擎',"));
check('webui/src/i18n/locales/en.ts', 'en: nav.context 改为 Context', s =>
  s.includes("context: 'Context',") && !s.includes("context: 'Context Engine',"));
check('webui/src/i18n/locales/en.ts', 'en: pageDesc 已删除 + tabEngine 新增', s =>
  !s.includes('pageDesc: \'Context engine infrastructure') && s.includes("tabEngine: 'Engine',"));

// ===== 4. SettingsPage.tsx =====
check('webui/src/components/pages/SettingsPage.tsx', 'Settings: navItems 移除 render', s => {
  const m = s.match(/export const settingsNavItems[\s\S]*?\];/);
  return m ? !m[0].includes("id: 'render'") : false;
});
check('webui/src/components/pages/SettingsPage.tsx', 'Settings: navItems 移除 specs/index/docs/rules/memory', s => {
  const m = s.match(/export const settingsNavItems[\s\S]*?\];/);
  if (!m) return false;
  return !["id: 'specs'", "id: 'index'", "id: 'docs'", "id: 'rules'", "id: 'memory'"].some(x => m[0].includes(x));
});
check('webui/src/components/pages/SettingsPage.tsx', 'Settings: ContextSettings Tab 容器', s =>
  s.includes('/** 上下文设置：Tab 容器（引擎/规范/索引/规则/记忆；路由驱动） */') &&
  s.includes("value=\"engine\"") && s.includes("value=\"memory\""));
check('webui/src/components/pages/SettingsPage.tsx', 'Settings: ContextEngineSettings 导出', s =>
  s.includes('export function ContextEngineSettings()'));
check('webui/src/components/pages/TaskPage.tsx', 'TaskPage: 无 pageDesc 引用', s =>
  !s.includes('settings.context.pageDesc'));
check('webui/src/components/pages/SettingsPage.tsx', 'Settings: 无 pageDesc 引用', s =>
  !s.includes('settings.context.pageDesc'));
check('webui/src/components/pages/SettingsPage.tsx', 'Settings: AppearanceSettings 容器', s =>
  s.includes('/** 外观设置：Tab 容器（外观/渲染；路由驱动） */') && s.includes("value=\"render\""));
check('webui/src/components/pages/SettingsPage.tsx', 'Settings: embedded prop 支持', s =>
  s.includes('embedded?: boolean;') && s.includes('{!embedded && <h1'));
check('webui/src/components/pages/SettingsPage.tsx', 'Settings: SpecsSettings h1 已移除', s =>
  !s.includes("{t('settings.nav.specs')}</h1>"));
check('webui/src/components/pages/SettingsPage.tsx', 'Settings: RenderSettingsSection h1 已移除', s =>
  !s.includes("{t('settings.nav.render')}</h1>"));
check('webui/src/components/pages/SettingsPage.tsx', 'Settings: Tabs import', s =>
  s.includes("import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';"));

// ===== 5. App.tsx =====
check('webui/src/App.tsx', 'App: 新组件 import', s =>
  s.includes('ContextEngineSettings,') && s.includes('AppearanceSettings,'));
check('webui/src/App.tsx', 'App: context 嵌套路由', s =>
  s.includes('<Route path="context" element={<ContextSettings />}>') &&
  s.includes('<Route index element={<ContextEngineSettings />} />') &&
  s.includes('<Route path="specs" element={<SpecsSettings />} />'));
check('webui/src/App.tsx', 'App: appearance 嵌套路由', s =>
  s.includes('<Route path="appearance" element={<AppearanceSettings />}>') &&
  s.includes('<Route path="render" element={<RenderSettingsSection />} />'));
check('webui/src/App.tsx', 'App: 旧路径重定向', s =>
  s.includes('<Navigate to="/settings/appearance/render" replace />') &&
  s.includes('<Navigate to="/settings/context/specs" replace />') &&
  s.includes('<Navigate to="/settings/context/memory" replace />'));

// ===== 6. Sidebar 无需改（渲染 settingsNavItems）——确认无硬编码旧项 =====
check('webui/src/components/layout/Sidebar.tsx', 'Sidebar: 无硬编码 render/specs 菜单项', s => {
  const m = s.match(/isSettingsRoute \?/);
  return m ? true : !s.includes("'/settings/render'");
});

console.log(`\n结果: ${pass} PASS / ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
