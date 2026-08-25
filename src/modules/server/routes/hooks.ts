// src/modules/server/routes/hooks.ts
// 钩子引擎路由（转发到 hooks 模块的 routes 实现；保持 server 路由文件组织惯例）。

export {
  createListHooksHandler,
  createCreateHookHandler,
  createGetHookHandler,
  createUpdateHookHandler,
  createDeleteHookHandler,
  createTestHookHandler,
  createHookHistoryHandler,
} from '../../hooks/api/routes';
