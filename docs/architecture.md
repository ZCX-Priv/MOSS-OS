# MOSS-OS 系统架构

## 一、总体架构

MOSS-OS 是一个基于 **微内核 + 模组化插件架构** 的 AI Agent 应用，运行在 Bun 运行时上。

```
┌─────────────────────────────────────────────────────────┐
│                     浏览器 (新 UI)                        │
│  React 19 + shadcn/ui + Tailwind 4 + i18next + idb      │
│  构建: Vite → dist/webui/                                │
└──────────────┬──────────────────────┬───────────────────┘
               │ HTTP REST (/api/*)    │ WebSocket (/ws)
               ▼                      ▼
┌─────────────────────────────────────────────────────────┐
│                   Server 模组 (Bun.serve)                │
│  HTTP 路由 + WS 处理 + 静态资源服务                       │
│  端口: 7766 (config.json)                                │
└──────────────┬──────────────────────────────────────────┘
               │ ServiceRegistry 依赖注入
               ▼
┌─────────────────────────────────────────────────────────┐
│                     微内核 (Kernel)                       │
│  ConfigService │ EventBus │ ServiceRegistry │ Logger     │
│  ExtensionManager (模组/插件发现、加载、生命周期)         │
└──────────────┬──────────────────────────────────────────┘
               │ 按拓扑序加载
               ▼
┌────────────────┬────────────────┬────────────────┬────────────────┐
│  Agent 模组    │  LLM 模组      │  MCP 模组      │  Tools 模组    │
│  (ReAct 引擎)  │  (多 Provider  │  (外部工具)    │  (内置工具+    │
│                │   路由)        │                │   Skill/Spec)  │
└────────────────┴────────────────┴────────────────┴────────────────┘
┌────────────────┬────────────────┬────────────────┬────────────────┐
│  Server 模组   │  Agents 模组   │ Automation 模组│  Update 模组   │
│  (HTTP+WS)     │  (Agent CRUD)  │  (定时任务)    │  (版本检查)    │
└────────────────┴────────────────┴────────────────┴────────────────┘
```

## 二、目录结构

```
MOSS-OS/
├── webui/                       # 前端（React 19 + shadcn/ui）
│   ├── src/
│   │   ├── api/                 # HTTP + WS 客户端封装
│   │   ├── components/          # UI 组件（pages/layout/overlays/dialogs/shared/ui）
│   │   ├── contexts/            # Theme + I18n Context
│   │   ├── hooks/               # 业务 hooks（useChat/useConfig/...）
│   │   ├── store/               # 全局状态（React Context + useReducer）
│   │   ├── types/               # 前后端共享类型
│   │   ├── i18n/                # 国际化（zh/en）
│   │   └── utils/               # idb 等工具
│   ├── package.json             # 前端独立依赖
│   └── vite.config.ts           # Vite 配置（含 /api + /ws 代理）
├── src/
│   ├── main.ts                  # 入口：CLI 解析 + 启动 Kernel
│   ├── core/                    # 微内核
│   │   ├── types.ts             # 服务契约接口
│   │   ├── kernel.ts            # Kernel 启动流程
│   │   ├── config-service.ts    # 配置服务（Zod 校验 + 热重载）
│   │   ├── extension-manager.ts # 模组/插件发现与加载
│   │   ├── service-registry.ts  # 服务注册表
│   │   ├── event-bus.ts         # 事件总线（Filter + Action）
│   │   ├── env.ts               # 环境检测
│   │   └── logger.ts            # 日志服务
│   ├── modules/                 # 模组（高权限，可注册受保护服务）
│   │   ├── agent/               # Agent 引擎（ReAct 循环）
│   │   ├── agents/              # Agent 注册表（CRUD，新模块）
│   │   ├── automation/          # 自动化任务（cron 调度，新模块）
│   │   ├── daemon/              # 守护进程管理
│   │   ├── llm/                 # LLM 路由 + Provider 实现
│   │   ├── mcp/                 # MCP 客户端管理
│   │   ├── server/              # HTTP + WS 服务
│   │   ├── tools/               # 内置工具 + Skill/Spec 注册表
│   │   └── update/              # 版本检查
│   ├── plugins/                 # 插件（低权限，受限服务消费）
│   └── utils/                   # 通用工具
├── agent/prompts/main/          # Agent 系统提示词（.md）
│   └── spec/                    # 规范文档（递归子目录）
├── skills/                      # Skill 定义（.md，YAML front-matter）
├── config/                      # 配置模板
│   ├── config.json              # AppConfig 模板
│   └── api.json                 # ApiConfig 模板
├── docs/                        # 前后端对接文档
├── scripts/
│   ├── build.mjs                # 构建（Bun 后端 + Vite 前端）
│   └── dev.mjs                  # 开发（并行启动后端 + 前端）
├── bin/moss.js                  # CLI 入口
├── package.json                 # 根 package.json（后端依赖）
└── tsconfig.json                # TypeScript 配置（exclude: webui）
```

## 三、微内核架构

### 3.1 核心服务

内核提供 4 个核心服务，所有模组/插件通过 `ModuleContext` / `PluginContext` 注入：

| 服务 | 接口 | 职责 |
|---|---|---|
| `ConfigService` | `src/core/config-service.ts` | 加载/校验/更新 `config.json` + `api.json`，Zod 校验，文件 watcher 热重载 |
| `EventBus` | `src/core/event-bus.ts` | Filter 模式（链式修改数据）+ Action 模式（并行副作用）|
| `ServiceRegistry` | `src/core/service-registry.ts` | 服务注册/解析，受保护服务名仅模组可注册 |
| `Logger` | `src/core/logger.ts` | 分级日志（debug/info/warn/error/fatal），子日志器 |

### 3.2 扩展系统

扩展分两类，由 `ExtensionManager` 统一管理：

| 类型 | 目录 | 清单 | 上下文 | 权限 |
|---|---|---|---|---|
| **模组 (Module)** | `src/modules/*/` | `module.json` | `ModuleContext`（完整能力）| 可注册受保护服务，先加载 |
| **插件 (Plugin)** | `src/plugins/*/` | `plugin.json` | `PluginContext`（受限）| 仅可消费声明白名单服务，后加载 |

**加载流程**（`src/core/extension-manager.ts`）：
1. 阶段 1：扫描 `src/modules/*/module.json` + `index.ts`
2. 阶段 2：扫描 `src/plugins/*/plugin.json` + `index.ts`（含 `extraPluginDirs`）
3. 阶段 3：合并拓扑排序（模组优先入度 0，同等条件模组先出队）
4. 按拓扑序 `initialize()`，反向序 `destroy()`

**清单字段**（`ExtensionManifest`）：
```json
{
  "name": "agent",                    // 唯一标识（kebab-case）
  "version": "1.0.0",
  "description": "Agent 引擎",
  "type": "module",                   // module | plugin（由清单文件名隐式决定）
  "dependencies": { "llm": "1.0.0" }, // 依赖的其他扩展
  "permissions": {                    // 主要对插件生效
    "registerServices": ["my.svc"],
    "consumeServices": ["llm.router", "tool.registry"]
  }
}
```

### 3.3 标准服务名

由各模组注册到 `ServiceRegistry`，定义在 `src/core/types.ts` `ServiceNames`：

| 服务名 | 注册者 | 接口契约 |
|---|---|---|
| `llm.router` | LLM 模组 | `LLMRouter`（complete/stream/listProviders/resolveProviderForModel）|
| `tool.registry` | Tools 模组 | `ToolRegistry`（register/get/list/listSchemas/execute）|
| `mcp.manager` | MCP 模组 | `MCPManager`（listServers/listTools/callTool/connect/disconnect）|
| `agent.engine` | Agent 模组 | `AgentEngine`（run/resolveAsk）|
| `server.instance` | Server 模组 | `ServerInstance`（addRoute/broadcastWS/sendToSession/onWSMessage）|
| `skill.registry` | Tools 模组 | `SkillRegistry`（register/list/get/reloadBySourceFile）|
| `spec.registry` | Tools 模组 | `SpecRegistry`（register/list/get/reloadBySourceFile）|
| `agents.registry` | Agents 模组（新）| `AgentRegistry`（list/get/create/update/delete/setDefault）|
| `automation.service` | Automation 模组（新）| `AutomationService`（list/create/update/delete/trigger/pause/resume/history）|
| `kernel.extensions` | Kernel | `{ getStates, getActiveCount, enable, disable, isDisabled }` |

受保护服务名集合 `ProtectedServiceNames` = `ServiceNames` 全部值，仅模组可注册。

## 四、前后端交互

### 4.1 通信通道

| 通道 | 用途 | 协议 |
|---|---|---|
| **HTTP REST** | 配置读写、会话管理、MCP 管理、Agent/Automation CRUD、Skills/Specs 查询 | `/api/*`，JSON |
| **WebSocket** | 流式对话（assistant-text/thinking/tool-call 实时推送）、ask 回复、todo 更新、automation 运行通知 | `/ws`，JSON 帧 |

### 4.2 鉴权

- 配置项：`config.security.authToken`（空字符串表示无需鉴权）
- 客户端：HTTP 头 `Authorization: Bearer <token>`，WS 不强制（同源信任）
- 服务端：`HttpRouter.checkAuth()` 校验，空 token 放行所有请求
- 前端：`localStorage['moss-os-token']` 存储，`api/http.ts` 自动注入

### 4.3 静态资源服务

`src/modules/server/static-assets.ts`：
- 根目录：`<packageRoot>/dist/webui/`
- SPA fallback：非 `/api/` 非 `/ws` 的未匹配路径返回 `index.html`
- MIME 映射：`.html/.js/.mjs/.css/.json/.png/.jpg/.svg/.ico/.woff/.woff2/.ttf` 等
- 缓存：`.html` 不缓存，其他 `public, max-age=86400`

### 4.4 开发模式

| 模式 | 前端 | 后端 | 通信 |
|---|---|---|---|
| **开发** | `cd webui && npx vite`（3000 端口）| `bun run --watch src/main.ts start --foreground`（7766 端口）| Vite 代理 `/api` + `/ws` → 7766 |
| **生产** | `dist/webui/` 静态文件 | `dist/server.js` 单文件 | 同源直连 7766 |

## 五、配置系统

### 5.1 AppConfig（`~/.moss/config/config.json`）

```json
{
  "version": 1,
  "server": { "host": "127.0.0.1", "port": 7766, "autoPort": true },
  "daemon": { "enabled": true, "logLevel": "info" },
  "update": { "autoCheck": true, "channel": "stable", "checkIntervalHours": 24 },
  "agent": { "defaultModel": "deepseek-chat", "maxTokens": 8192, "maxTurns": 25, "workingDirectory": "" },
  "tools": {
    "read": { "enabled": true },
    "write": { "enabled": true, "requireConfirmation": true },
    "edit": { "enabled": true, "requireConfirmation": false },
    "shell": { "enabled": true, "timeout": 30000, "requireConfirmation": true },
    "use_skill": { "enabled": true },
    "use_mcp": { "enabled": true }
    // ...其他工具
  },
  "mcpServers": {},
  "security": { "authToken": "", "bindLocalhostOnly": true }
}
```

### 5.2 ApiConfig（`~/.moss/config/api.json`）

```json
{
  "version": 1,
  "defaultProvider": "deepseek",
  "providers": {
    "deepseek": {
      "format": "openai-chat",
      "endpoint": "https://api.deepseek.com",
      "apiKey": "",
      "models": ["deepseek-chat", "deepseek-reasoner"],
      "thinking": { "enabled": false, "effort": "high" }
    },
    "anthropic": {
      "format": "anthropic",
      "endpoint": "https://api.anthropic.com/v1",
      "apiKey": "",
      "models": ["claude-sonnet-4-5", "claude-opus-4-1"],
      "thinking": { "enabled": true, "effort": "high", "budgetTokens": 4096 }
    }
    // openai-responses, gemini, qwen, glm, kimi...
  }
}
```

### 5.3 支持的 Provider 格式

| format | endpoint 示例 | thinking 支持 |
|---|---|---|
| `openai-chat` | `https://api.openai.com/v1` | 否 |
| `openai-responses` | `https://api.openai.com/v1` | 是（effort）|
| `anthropic` | `https://api.anthropic.com/v1` | 是（effort + budgetTokens）|
| `gemini` | `https://generativelanguage.googleapis.com/v1beta` | 是（budgetTokens）|

### 5.4 配置热重载

`ConfigService` 启动 `fs.watch` 监听 `config.json` + `api.json`：
- 文件变更 → 300ms 防抖 → 重新读取 + Zod 校验 → 广播 `config:changed` 事件
- 通知所有 `onChange` 订阅者（前端可通过 WS 推送或重新拉取）

## 六、Agent 引擎工作流

```
用户消息
   │
   ▼
AgentEngine.run({ sessionId, userMessage, cwd, onEvent })
   │
   ├── 1. 构建 system prompt（agent/prompts/main/ 拼接 + 变量替换）
   ├── 2. 获取/创建 session（SessionStore）
   ├── 3. 添加 user message
   ├── 4. 收集工具（ToolRegistry + MCP tools，前缀 mcp__server__tool）
   │
   └── ReAct 循环（最多 maxTurns 轮）:
       ├── 5. 上下文裁剪（trimContext，保留 system + 最近 N 轮）
       ├── 6. 转 UnifiedMessage，调 llm.stream(req, provider)
       │   └── 流式 delta:
       │       ├── text → onEvent('assistant-text')
       │       ├── thinking → onEvent('assistant-thinking')
       │       ├── tool_call → 累积 id/name/args
       │       ├── finish → 记录 finishReason
       │       └── error → onEvent('error')
       ├── 7. 记录 assistant message（含 toolCalls）
       ├── 8. 无 tool_calls → 结束循环
       ├── 9. 有 tool_calls → 逐个执行:
       │   ├── onEvent('tool-call-start')
       │   ├── 内置工具: ToolRegistry.execute(ctx)
       │   │   └── ctx.askUser() → onEvent('ask') → 等待前端回复
       │   ├── MCP 工具: mcpManager.callTool(server, tool, args)
       │   ├── onEvent('tool-call-end')
       │   └── 记录 tool message 到 session
       └── 10. 继续下一轮
   │
   ▼
onEvent('done', finishReason)
返回 { sessionId, finishReason, finalText, history }
```

## 七、数据持久化

所有用户数据存储在 `~/.moss/`：

| 路径 | 用途 | 格式 |
|---|---|---|
| `~/.moss/config/config.json` | AppConfig | JSON |
| `~/.moss/config/api.json` | ApiConfig | JSON |
| `~/.moss/moss.pid` | 守护进程 PID | 文本 |
| `~/.moss/logs/` | 日志文件 | 文本 |
| `~/.moss/todos.json` | Todo 列表（全局，含 sessionId）| JSON |
| `~/.moss/agents.json` | 自定义 Agent 列表（新）| JSON |
| `~/.moss/automations.json` | 自动化任务（新）| JSON |
| `~/.moss/automations-history.json` | 自动化运行历史（新）| JSON |
| `~/.moss/extensions.json` | 扩展启用/禁用配置（新）| JSON |
| `~/.moss/skills/` | 用户自定义 Skill | .md（YAML front-matter + body）|
| `~/.moss/agent/prompts/main/` | 用户自定义系统提示词 | .md |
| `~/.moss/agent/prompts/main/spec/` | 用户自定义规范 | .md（递归子目录）|

## 八、相关文档

- [REST API 完整参考](./api-reference.md)
- [WebSocket 协议](./websocket-protocol.md)
- [前后端共享数据类型](./data-types.md)
- [开发与构建指南](./development.md)
