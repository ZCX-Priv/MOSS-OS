// 综合核验脚本：UX 统一 + 动画系统 + PWA + agenteam 更名（防编辑工具虚假成功，逐文件磁盘断言）
const fs = require('fs');
const path = require('path');
const base = 'c:/Users/赵晨旭/Desktop/MOSS-OS';
const read = (p) => fs.readFileSync(path.join(base, p), 'utf8');

let pass = 0;
let fail = 0;
function check(name, file, conditions) {
  let src;
  try {
    src = read(file);
  } catch {
    fail++;
    console.log(`FAIL ${file} :: ${name} :: 文件不存在`);
    return;
  }
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
    console.log(`PASS ${file} :: ${name} (旧代码已移除)`);
  } else {
    fail++;
    console.log(`FAIL ${file} :: ${name} :: 残留: ${JSON.stringify(leaked)}`);
  }
}

console.log('===== 1. 反逻辑菜单 =====');
check('加号菜单 align=start', 'webui/src/components/pages/TaskPage.tsx', ['<DropdownMenuContent align="start" sideOffset={4} collisionPadding={8}>']);
check('总是允许菜单朝下+左对齐', 'webui/src/components/shared/ConfirmPromptCard.tsx', ['<DropdownMenuContent align="start" side="bottom"']);

console.log('===== 2. agenteam 更名 =====');
check('目录已更名', 'src/modules/agenteam/index.ts', ['// src/modules/agenteam/index.ts', 'agenteam.registry']);
check('数据文件迁移', 'src/modules/agenteam/index.ts', ["join(env.dataDir, 'agenteam.json')", 'renameSync(legacyPath, this.storePath)']);
check('i18n key 改 agenteam', 'src/modules/agenteam/index.ts', ["t('agenteam.saveFailed')", "t('agenteam.agentCreated'", "t('agenteam.moduleInitialized')"]);
check('服务名常量', 'src/core/types.ts', ["AGENTTEAM_REGISTRY: 'agenteam.registry'"]);
checkAbsent('旧服务名已移除', 'src/core/types.ts', ['AGENTS_REGISTRY']);
check('kernel 注册', 'src/core/kernel.ts', ["import agenteam from '../modules/agenteam'", "{ name: 'agenteam', create: agenteam }"]);
check('路由文件更名+服务解析+API', 'src/modules/server/routes/agenteam.ts', ["from '../../agenteam'", "tryResolve<AgentRegistry>('agenteam.registry')", '/api/agenteam']);
check('server 路由注册', 'src/modules/server/index.ts', ["} from './routes/agenteam';", "pattern: '/api/agenteam'"]);
check('后端 i18n zh', 'src/core/i18n/locales/zh.ts', ['agenteam: {', 'AgentTeam 模块已初始化']);
check('后端 i18n en', 'src/core/i18n/locales/en.ts', ['agenteam: {', 'AgentTeam module initialized']);
check('前端 API 路径', 'webui/src/api/http.ts', ["('GET', '/api/agenteam')", "`/api/agenteam/${id}`", "('PUT', '/api/agenteam/default'"]);
checkAbsent('前端无旧 API', 'webui/src/api/http.ts', ['/api/agents']);
check('docs 同步', 'docs/frontend-backend-api.md', ['/api/agenteam']);
checkAbsent('docs 无旧路径', 'docs/frontend-backend-api.md', ['/api/agents']);

console.log('===== 3. 动画基础设施 =====');
check('AnimationSettings 类型', 'webui/src/types/animation.ts', ['enabled: boolean', 'route: boolean', 'message: boolean', 'list: boolean', 'stat: boolean', 'hub: boolean', 'isValidAnimationSettings']);
check('store 状态与 action', 'webui/src/store/index.ts', ['animationSettings: AnimationSettings', 'prefersReducedMotion: boolean', 'setAnimationSetting:', 'setPrefersReducedMotion:', "idbSet('moss-animation-settings'", 'isValidAnimationSettings(patch.animationSettings)']);
check('main.tsx 持久化', 'webui/src/main.tsx', ["'moss-animation-settings'", "isValidAnimationSettings(data['moss-animation-settings'])"]);
check('useAnimationClass hook', 'webui/src/hooks/useAnimationClass.ts', ["matchMedia('(prefers-reduced-motion: reduce)')", "addEventListener('change'", 'anim-off', 'anim-route-off', 'export function useReducedMotion']);
check('global.css 禁用规则', 'webui/src/styles/global.css', ['html.anim-off *', 'html.anim-route-off .anim-route', 'html.anim-msg-off .anim-msg', 'html.anim-list-off .anim-list', 'html.anim-stat-off .anim-stat', 'html.anim-hub-off .anim-hub', '@media (prefers-reduced-motion: reduce)']);

console.log('===== 4. 动画落点 =====');
check('路由容器动画', 'webui/src/App.tsx', ["pathname.split('/')[1] ?? 'home'", 'anim-route animate-in fade-in slide-in-from-bottom-1 duration-200']);
check('App 挂 useAnimationClass', 'webui/src/App.tsx', ['useAnimationClass()']);
check('消息入场动画', 'webui/src/components/pages/TaskPage.tsx', ['anim-msg animate-in fade-in slide-in-from-bottom-2 duration-200']);
check('分组列表动画', 'webui/src/components/layout/Sidebar.tsx', ['anim-list animate-in fade-in duration-150']);
const sidebarCount = (read('webui/src/components/layout/Sidebar.tsx').match(/anim-list animate-in fade-in duration-150/g) || []).length;
if (sidebarCount === 3) { pass++; console.log('PASS Sidebar.tsx :: 列表动画落点数量 = 3（分组+TaskRow×2）'); }
else { fail++; console.log(`FAIL Sidebar.tsx :: 列表动画落点数量 = ${sidebarCount}（期望 3）`); }
check('StatsBar 数值脉冲', 'webui/src/components/shared/StatsBar.tsx', ['statAnimOn', 'pulse={pulse}', 'transition-colors duration-150', 'anim-stat']);
check('中控台面板动画', 'webui/src/components/shared/ControlHub.tsx', ['anim-hub animate-in fade-in slide-in-from-top-2 duration-200', 'key={activeModule.id}']);
const settingsPageCount = (read('webui/src/components/pages/SettingsPage.tsx').match(/anim-route animate-in fade-in slide-in-from-bottom-1 duration-200/g) || []).length;
if (settingsPageCount === 3) { pass++; console.log('PASS SettingsPage.tsx :: 分区动画容器数量 = 3（Settings/Appearance/Context）'); }
else { fail++; console.log(`FAIL SettingsPage.tsx :: 分区动画容器数量 = ${settingsPageCount}（期望 3）`); }

console.log('===== 5. 动画设置页 + 渲染设置样式 =====');
check('动画 Tab', 'webui/src/components/pages/SettingsPage.tsx', ['<TabsTrigger value="anim"', 'settings.nav.anim', '/settings/appearance/anim']);
check('AnimSettingsSection', 'webui/src/components/pages/SettingsPage.tsx', ['export function AnimSettingsSection', 'useReducedMotion', 'reducedMotionNotice', "setAnimationSetting('enabled', v)", "setAnimationSetting('hub', v)"]);
check('渲染设置样式对齐', 'webui/src/components/pages/SettingsPage.tsx', ['contentTitle', 'divide-y divide-border']);
checkAbsent('渲染设置卡片包裹已移除', 'webui/src/components/pages/SettingsPage.tsx', ['className="flex flex-col rounded-lg border border-border px-4"', 'RenderSettingRow']);
check('anim 路由', 'webui/src/App.tsx', ['<Route path="anim" element={<AnimSettingsSection />} />', 'to="/settings/appearance/anim"']);
check('SettingsSection 类型', 'webui/src/types/index.ts', ["| 'anim'"]);
check('搜索索引', 'webui/src/components/pages/SettingsPage.tsx', ["{ labelKey: 'settings.nav.anim', section: 'anim' }", "section: 'anim'"]);
check('i18n zh', 'webui/src/i18n/locales/zh.ts', ["anim: '动画'", 'reducedMotionNotice', 'groupTitle']);
check('i18n en', 'webui/src/i18n/locales/en.ts', ["anim: 'Animation'", 'reducedMotionNotice', 'groupTitle']);

console.log('===== 6. PWA =====');
check('vite-plugin-pwa 依赖', 'webui/package.json', ['vite-plugin-pwa']);
check('VitePWA 配置', 'webui/vite.config.ts', ['VitePWA', "registerType: 'autoUpdate'", "display: 'standalone'", 'navigateFallbackDenylist', 'MOSS.png']);
check('theme-color', 'webui/index.html', ['<meta name="theme-color" content="#18181b" />']);
check('webmanifest MIME', 'src/modules/server/static-assets.ts', ["'.webmanifest': 'application/manifest+json'"]);
check('SW no-cache', 'src/modules/server/static-assets.ts', ["fileName === 'sw.js'", "fileName === 'manifest.webmanifest'", "noCache ? 'no-cache'"]);

console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail === 0 ? 0 : 1);
