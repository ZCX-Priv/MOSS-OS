# MOSS 前后端对接文档

> 本文档基于新前端 `webui/`（React 19 + shadcn/ui）与现有后端 `src/modules/server/` 的现状，梳理**需要迁移的接口**、**需要新增的接口**、**前端需新增的模块**与**后端需新增的模组**，作为后续实施的契约依据。
>
> **注**：本文档第一章为迁移启动时的历史快照，仅供追溯；文中标注"🆕 新增"的多数接口与模组（tasks/agenteam/automation/skills/specs/todos/version/search 等）现已实现，以 `src/modules/server/routes/` 实际代码为准。`/api/plugins`、`/api/extensions` 等扩展管理接口从未实施（系统无插件机制）。
>
> 配套文档：[architecture.md](./architecture.md)（系统总览）

---

## 一、现状分析

### 1.1 新前端 `webui/` 现状

| 维度 | 现状 |
|---|---|
| 技术栈 | React 19 + shadcn/ui + Tailwind 4 + i18next + idb + Vite 8 |
| 页面 | HomePage / TaskRunningPage / PluginMarketPage / AutomationPage / SettingsPage |
| 状态管理 | **无**（仅有 ThemeContext / I18nContext，无业务 store） |
| API 客户端 | **无**（`webui/src/api/` 目录不存在） |
| 业务 hooks | **无**（仅有 use-mobile / useLocale） |
| 数据来源 | **全部硬编码 mock**（任务列表、模型列表、Agent 列表、插件列表、自动化模板等） |
| 类型定义 | 仅 `types/index.ts` 定义了 PageType / OverlayType / TaskItem 等纯 UI 类型 |

**结论**：新前端目前只有 UI 骨架，需要从零搭建 API 层、状态层、业务 hooks，并与后端对接。

### 1.2 旧前端 `webui/` 现状（迁移来源）

| 维度 | 现状 |
|---|---|
| 技术栈 | React 18 + zustand + react-markdown |
| API 客户端 | `webui/src/api/http.ts` + `ws.ts`（完整实现） |
| 状态管理 | `webui/src/store/index.ts`（zustand，完整） |
| 业务 hooks | `useTask.ts`（WS 流式任务）+ `useConfig.ts`（配置加载） |
| 类型定义 | `webui/src/types/index.ts`（完整的前后端共享类型） |

**可迁移内容**：http/ws 客户端封装、类型定义、useTask/useConfig 的业务逻辑（需适配新前端的 React 19 + 无 zustand 环境）。

### 1.3 后端 `src/modules/server/` 现状

已实现的 HTTP 路由（14 个）：
- `GET /api/health`
- `GET|PUT /api/config`、`GET|PUT /api/api-config`
- `GET /api/session`、`GET /api/session/:id`、`DELETE /api/session/:id`
- `GET /api/mcp/servers`、`GET /api/mcp/tools`、`POST /api/mcp/call`、`POST /api/mcp/connect`、`POST /api/mcp/disconnect`

已实现的 WS 消息（4 种入站）：
- `task.stream` / `task.abort` / `session.subscribe` / `tool.ask.reply`

已注册但**未暴露 HTTP**的后端服务：
- `SkillRegistry`（`skill.registry`）—— Skills 已加载但无查询接口
- `SpecRegistry`（`spec.registry`）—— Specs 已加载但无查询接口
- `kernel.modules` —— 模块状态查询（仅 /api/health 间接暴露）

**当时完全缺失的后端模组**（迁移启动时的状态，现已实现）：
- `agenteam` 模组（Agent CRUD）
- `automation` 模组（cron/once 定时任务调度）

---

## 二、通用约定

### 2.1 通信通道

| 通道 | 用途 | 协议 |
|---|---|---|
| HTTP REST | 配置、会话、Agent、Automation、Plugins、Skills、Specs、Models 等 CRUD | `/api/*`，JSON |
| WebSocket | 流式任务、ask 回复、todo 实时更新、automation 运行通知 | `/ws`，JSON 帧 |

### 2.2 鉴权

- 配置项：`config.security.authToken`（空字符串表示无需鉴权）
- 客户端：HTTP 头 `Authorization: Bearer <token>`，WS 同源信任不强制
- 服务端：`HttpRouter.checkAuth()` 校验，空 token 放行
- 前端：`localStorage['moss-token']` 存储，`api/http.ts` 自动注入

### 2.3 统一响应格式

**成功**：HTTP 200，body 为业务数据 JSON。

**错误**：HTTP 4xx/5xx，body 统一为：
```json
{ "error": "错误描述" }
```

### 2.4 CORS

后端已开启（`Access-Control-Allow-Origin: *`），开发模式由 Vite 代理 `/api` + `/ws` → 7766。

### 2.5 日期格式

所有时间字段统一使用 ISO 8601 字符串（如 `2026-08-06T11:21:00.000Z`）。

---

## 三、HTTP REST 接口

### 3.1 已有接口（需迁移对接）

以下接口后端已实现，新前端需在 `webui/src/api/http.ts` 中封装并对接。

#### 3.1.1 健康检查
```
GET /api/health
```
**响应**：
```ts
{
  status: 'ok';
  timestamp: string;
  services: string[];
  uptime: number;
  modules: number;
  moduleStates: Record<string, string>;
}
```

#### 3.1.2 应用配置
```
GET /api/config        → AppConfig
PUT /api/config        ← Partial<AppConfig> → AppConfig
```

#### 3.1.3 API 配置（Provider/模型）
```
GET /api/api-config    → ApiConfig
PUT /api/api-config    ← Partial<ApiConfig> → ApiConfig
```

#### 3.1.4 会话管理
```
GET    /api/session          → { sessions: Session[] }
GET    /api/session/:id      → { sessionId: string; messages: TaskMessage[] }
DELETE /api/session/:id      → { deleted: boolean }
```

#### 3.1.6 MCP 管理
```
GET  /api/mcp/servers                 → { servers: McpServer[] }
GET  /api/mcp/tools?server=name       → { tools: McpTool[] }
POST /api/mcp/call                    ← { server, tool, arguments }
POST /api/mcp/connect                 ← { server }
POST /api/mcp/disconnect              ← { server }
```

---

### 3.2 新增接口（后端需实现）

以下接口后端**尚未实现**，需在 `src/modules/server/routes/` 下新增，并在 `index.ts` 注册。

#### 3.2.1 任务管理（TaskRunningPage + Sidebar）

> 新前端用「任务」概念替代旧前端的「会话」，任务支持分组。建议后端在 `agent` 模组内扩展 SessionStore，新增 `~/.moss/tasks.json` 持久化任务元信息（分组、标题、创建时间、最后活跃时间），消息历史仍复用 session。

```
GET    /api/tasks                     → { groups: TaskGroup[]; tasks: TaskItem[] }
POST   /api/tasks                     ← { title: string; groupId?: string } → TaskItem
GET    /api/tasks/:id                 → { task: TaskItem; messages: TaskMessage[]; todos: TodoItem[]; contextFiles: ContextFile[] }
PATCH  /api/tasks/:id                 ← { title?: string; groupId?: string } → TaskItem
DELETE /api/tasks/:id                 → { deleted: boolean }

GET    /api/task-groups               → { groups: TaskGroup[] }
POST   /api/task-groups               ← { name: string } → TaskGroup
PATCH  /api/task-groups/:id           ← { name?: string } → TaskGroup
DELETE /api/task-groups/:id           ← { moveTasksTo?: string } → { deleted: boolean }

GET    /api/search?q=keyword          → { tasks: TaskItem[]; messages?: SearchResult[] }
```

**类型定义**：
```ts
interface TaskItem {
  id: string;
  title: string;
  groupId: string;
  createdAt: string;
  updatedAt: string;
  active?: boolean;
}
interface TaskGroup {
  id: string;
  name: string;
  expanded?: boolean;
  taskCount?: number;
}
interface TodoItem {
  id: string;
  text: string;
  status: 'pending' | 'in_progress' | 'completed';
  sessionId?: string;
}
interface ContextFile {
  path: string;
  tokens?: number;
  reason?: 'read' | 'edit' | 'write' | 'grep' | 'glob';
}
```

#### 3.2.2 模型管理（ModelSelector + SettingsPage-Model）

> 从 `ApiConfig.providers` 聚合出扁平模型列表，支持前端选择与 thinking 配置。

```
GET    /api/models                    → { models: ModelItem[]; current: string }
PUT    /api/models/current            ← { modelId: string } → { current: string }
POST   /api/models                    ← { name: string; provider: string; contextWindow?: string; multiplier?: string } → ModelItem
PATCH  /api/models/:id                ← Partial<ModelItem> → ModelItem
DELETE /api/models/:id                → { deleted: boolean }
```

**类型定义**：
```ts
interface ModelItem {
  id: string;              // provider:model 格式，如 "glm:glm-4-plus"
  name: string;            // 展示名，如 "GLM-5.2"
  provider: string;        // provider id
  providerFormat: 'openai-chat' | 'openai-responses' | 'anthropic' | 'gemini';
  multiplier?: string;     // 倍率，如 "0.6x"
  contextWindow?: string;  // 如 "200K" / "1M"
  thinking: {
    enabled: boolean;
    effort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
    budgetTokens?: number;
  };
  custom?: boolean;        // 是否用户自定义
}
```

#### 3.2.3 Agent 管理（AgentSwitchMenu + SettingsPage-Agent）

> 需新建 `src/modules/agenteam/` 模组，注册 `agenteam.registry` 服务，持久化到 `~/.moss/agenteam.json`。

```
GET    /api/agenteam                     → { agents: AgentItem[]; default: string }
GET    /api/agenteam/:id                 → AgentDetail
POST   /api/agenteam                     ← { name: string; systemPrompt?: string; model?: string; tools?: string[] } → AgentItem
PATCH  /api/agenteam/:id                 ← Partial<AgentDetail> → AgentItem
DELETE /api/agenteam/:id                 → { deleted: boolean }
PUT    /api/agenteam/default             ← { id: string } → { default: string }
```

**类型定义**：
```ts
interface AgentItem {
  id: string;
  name: string;
  description?: string;
  icon?: string;           // 图标标识（前端映射 LucideIcon）
  builtIn: boolean;
  default?: boolean;
}
interface AgentDetail extends AgentItem {
  systemPrompt?: string;
  model?: string;
  provider?: string;
  tools?: string[];        // 启用的工具白名单
  maxTurns?: number;
  maxTokens?: number;
}
```

#### 3.2.4 插件管理（PluginMarketPage）

> 此规划**未实施**：系统不存在插件机制，无 `/api/plugins` 路由。PluginMarketPage 实际对接 Skills 管理（`/api/skills` 系列）与 MCP 服务器管理（`/api/mcp/*` + config 更新）。

~~GET    /api/plugins                    → { plugins: PluginItem[] }~~
~~GET    /api/plugins/:id                → PluginDetail~~
~~PATCH  /api/plugins/:id                ← { enabled?: boolean } → PluginItem~~

#### 3.2.5 Skills 查询（PluginMarketPage-Skills 标签）

> 后端 `SkillRegistry` 已注册，仅需在 `server/routes/` 新增路由。

```
GET    /api/skills                     → { skills: SkillItem[] }
GET    /api/skills/:name               → { skill: SkillDetail }
```

**类型定义**：
```ts
interface SkillItem {
  name: string;
  description: string;
  source: 'builtin' | 'user';
}
interface SkillDetail extends SkillItem {
  prompt: string;
  sourceFile?: string;
}
```

#### 3.2.6 Specs 查询（SettingsPage-Docs/Rules 等）

> 后端 `SpecRegistry` 已注册，仅需在 `server/routes/` 新增路由。

```
GET    /api/specs                      → { specs: SpecItem[] }
GET    /api/specs/:id                  → { spec: SpecDetail }
```

**类型定义**：
```ts
interface SpecItem {
  id: string;              // 相对路径，如 "coding" / "spec/coding"
  description: string;
  source: 'builtin' | 'user';
}
interface SpecDetail extends SpecItem {
  content: string;
  sourceFile?: string;
}
```

#### 3.2.7 自动化任务（AutomationPage）

> 需新建 `src/modules/automation/` 模组，注册 `automation.service` 服务，持久化到 `~/.moss/automations.json` + `~/.moss/automations-history.json`。

```
GET    /api/automations                → { automations: AutomationItem[] }
GET    /api/automations/:id            → AutomationDetail
POST   /api/automations                ← { title: string; cron: string; prompt: string; agentId?: string } → AutomationItem
PATCH  /api/automations/:id            ← Partial<AutomationDetail> → AutomationItem
DELETE /api/automations/:id            → { deleted: boolean }
POST   /api/automations/:id/trigger    → { runId: string }
POST   /api/automations/:id/pause      → { paused: boolean }
POST   /api/automations/:id/resume     → { paused: boolean }
GET    /api/automations/:id/history    → { history: AutomationRun[] }

GET    /api/automation-templates       → { templates: AutomationTemplate[] }
```

**类型定义**：
```ts
interface AutomationItem {
  id: string;
  title: string;
  description?: string;
  cron: string;             // 5 字段 cron 表达式
  prompt: string;           // 触发时发送给 agent 的消息
  agentId?: string;
  enabled: boolean;
  paused: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
  createdAt: string;
}
interface AutomationDetail extends AutomationItem {
  history?: AutomationRun[];
}
interface AutomationRun {
  id: string;
  automationId: string;
  startedAt: string;
  finishedAt?: string;
  status: 'running' | 'success' | 'failed' | 'timeout';
  finishReason?: string;
  finalText?: string;
  error?: string;
}
interface AutomationTemplate {
  id: string;
  title: string;
  description: string;
  iconGradient?: string;
  cron?: string;            // 建议的 cron
  promptTemplate?: string;  // 含 {{占位符}} 的 prompt 模板
}
```

#### 3.2.8 扩展状态（SettingsPage-About）

> 此规划**未实施**：无 `/api/extensions` 路由与启用/禁用持久化。模块状态实际经 `GET /api/health` 的 `moduleStates` 字段暴露（数据源为 `kernel.modules` 服务的 `getList()`，仅含 name/state，无启用/禁用控制）。

~~GET    /api/extensions                 → { modules: ExtensionState[]; plugins: ExtensionState[]; activeCount: number }~~
~~PATCH  /api/extensions/:name           ← { enabled?: boolean } → { name: string; enabled: boolean }~~

#### 3.2.9 Todo 管理（TaskRunningPage 右侧面板）

> 后端 `tools/todo/` 已有工具实现，会话级持久化到 `~/.moss/todo/<sessionId>.json`。新增 HTTP 接口供前端直接读写。

```
GET    /api/todos/:sessionId           → { todos: TodoItem[] }
PUT    /api/todos/:sessionId           ← { todos: TodoItem[] } → { todos: TodoItem[] }
```

#### 3.2.10 会话上下文（TaskRunningPage 右侧面板-Context）

```
GET    /api/sessions/:id/context       → { files: ContextFile[]; totalTokens: number; maxTokens: number }
```

#### 3.2.11 版本信息（SettingsPage-About）

```
GET    /api/version                    → { version: string; commit?: string; buildDate?: string; channel: string }
```

---

## 四、WebSocket 协议

### 4.1 已有消息（需迁移）

#### 4.1.1 客户端 → 服务端

| type | 用途 | payload |
|---|---|---|
| `task.stream` | 流式任务 | `{ message, model?, provider?, cwd? }` |
| `task.abort` | 中断任务 | `{}` |
| `session.subscribe` | 订阅会话 | `{}` |
| `tool.ask.reply` | 回复 ask 提问 | `{ toolCallId, answer }` |

#### 4.1.2 服务端 → 客户端（AgentEvent）

| type | 用途 | payload |
|---|---|---|
| `assistant-text` | 文本流 delta | `{ text }` |
| `assistant-thinking` | 思考流 delta | `{ text }` |
| `tool-call-start` | 工具调用开始 | `{ toolName, toolCallId, args }` |
| `tool-call-end` | 工具调用结束 | `{ toolName, toolCallId, result }` |
| `ask` | 工具提问 | `{ toolCallId, question }` |
| `error` | 错误 | `{ message }` |
| `done` | Agent 循环结束 | `{ finishReason }` |
| `task.done` | 任务完成 | `{ finishReason, finalText }` |
| `session.subscribed` | 订阅成功 | `{}` |
| `tool.ask.accepted` | ask 回复已接受 | `{ toolCallId }` |

### 4.2 新增消息

#### 4.2.1 客户端 → 服务端

| type | 用途 | payload |
|---|---|---|
| `task.create` | 创建新任务（替代直接发 task.stream） | `{ title?, groupId? }` → 返回 `{ task }` |
| `task.switch` | 切换当前任务 | `{ taskId }` |
| `automation.run` | 手动触发自动化 | `{ automationId }` |

#### 4.2.2 服务端 → 客户端

| type | 用途 | payload |
|---|---|---|
| `todo-updated` | Todo 列表变更（工具调用 todo 工具时推送） | `{ sessionId, todos: TodoItem[] }` |
| `context-updated` | 上下文文件变更（read/edit/write 工具触发） | `{ sessionId, files: ContextFile[], totalTokens, maxTokens }` |
| `file-created` | 文件创建通知 | `{ sessionId, path }` |
| `file-edited` | 文件编辑通知 | `{ sessionId, path, linesChanged }` |
| `task.created` | 新任务创建 | `{ task: TaskItem }` |
| `task.updated` | 任务元信息更新 | `{ task: Partial<TaskItem> }` |
| `automation.started` | 自动化任务开始运行 | `{ automationId, runId }` |
| `automation.finished` | 自动化任务运行结束 | `{ automationId, runId, status, finalText? }` |
| `config.changed` | 配置文件热重载通知 | `{ which: 'app' \| 'api' }` |

---

## 五、数据类型定义

### 5.1 前端需新增 `webui/src/types/api.ts`

```ts
// ============================================================================
// 基础类型（从旧前端 webui/src/types/index.ts 迁移）
// ============================================================================

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ToolResult {
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; source: { data: string; mimeType: string } }
  >;
  isError?: boolean;
}

export interface TaskMessage {
  id: string;
  role: MessageRole;
  content: string;
  thinking?: string;
  toolCalls?: ToolCall[];
  toolResults?: Array<{ toolCallId: string; result: ToolResult }>;
  timestamp: string;
  streaming?: boolean;
}

export interface Session {
  id: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

// ============================================================================
// 配置类型（与后端 src/core/types.ts 对齐）
// ============================================================================

export interface AppConfig {
  version: number;
  server: { host: string; port: number; autoPort: boolean; locale?: string };
  daemon: { enabled: boolean };
  logs: { level: string; retentionDays: number; maxFileMb: number };
  update: { autoCheck: boolean; channel: 'stable' | 'beta'; checkIntervalHours: number };
  agent: { defaultModel: string; maxTokens: number; maxTurns: number; workingDirectory: string };
  tools: Record<string, { enabled: boolean; requireConfirmation?: boolean; timeout?: number }>;
  mcpServers: Record<string, unknown>;
  security: { authToken: string; bindLocalhostOnly: boolean };
}

export type ThinkingEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface ProviderModelConfig {
  id: string;               // 内部唯一 id，如 "model_1734..."
  name: string;             // 显示名，如 "GPT-4o"
  model: string;            // 发送给 API 的模型名，如 "gpt-4o"
  thinking: { enabled: boolean; effort?: string; label?: string; budgetTokens?: number };
  inputTokens?: number;
  outputTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
}

export interface ProviderConfig {
  id: string;               // 内部唯一 id，如 "provider_1734..."
  name: string;             // 显示名，如 "OpenAI"
  format: 'openai-chat' | 'openai-responses' | 'anthropic' | 'gemini';
  endpoint: string;
  apiKey: string;
  models: ProviderModelConfig[];
}

export interface ApiConfig {
  version: number;          // 2 = providers 数组结构（旧版 1 扁平结构自动迁移）
  providers: ProviderConfig[];
}

// ============================================================================
// MCP 类型（迁移）
// ============================================================================

export interface McpServer {
  name: string;
  status: 'connected' | 'disconnected' | 'error';
  toolCount: number;
}

export interface McpTool {
  server: string;
  name: string;
  description?: string;
  inputSchema?: unknown;
}

// ============================================================================
// 任务 / Todo / 上下文（新增，见 3.2.1 / 3.2.9 / 3.2.10）
// ============================================================================

export interface TaskItem {
  id: string;
  title: string;
  groupId: string;
  createdAt: string;
  updatedAt: string;
  active?: boolean;
}

export interface TaskGroup {
  id: string;
  name: string;
  expanded?: boolean;
  taskCount?: number;
}

export interface TodoItem {
  id: string;
  text: string;
  status: 'pending' | 'in_progress' | 'completed';
  sessionId?: string;
}

export interface ContextFile {
  path: string;
  tokens?: number;
  reason?: 'read' | 'edit' | 'write' | 'grep' | 'glob';
}

// ============================================================================
// 模型 / Agent / Skill / Spec / 自动化（新增，见 3.2.x）
// ============================================================================

export interface ModelItem { /* 见 3.2.2 */ }
export interface AgentItem { /* 见 3.2.3 */ }
export interface AgentDetail extends AgentItem { /* 见 3.2.3 */ }
export interface SkillItem { /* 见 3.2.5 */ }
export interface SkillDetail extends SkillItem { /* 见 3.2.5 */ }
export interface SpecItem { /* 见 3.2.6 */ }
export interface SpecDetail extends SpecItem { /* 见 3.2.6 */ }
export interface AutomationItem { /* 见 3.2.7 */ }
export interface AutomationRun { /* 见 3.2.7 */ }
export interface AutomationTemplate { /* 见 3.2.7 */ }

// ============================================================================
// WebSocket 消息类型（迁移 + 新增）
// ============================================================================

export interface WSMessage {
  type: string;
  sessionId?: string;
  taskId?: string;
  payload?: unknown;
}

export type AgentEvent =
  | { type: 'assistant-text'; sessionId: string; text: string }
  | { type: 'assistant-thinking'; sessionId: string; text: string }
  | { type: 'tool-call-start'; sessionId: string; toolName: string; toolCallId: string; args: unknown }
  | { type: 'tool-call-end'; sessionId: string; toolName: string; toolCallId: string; result: ToolResult }
  | { type: 'ask'; sessionId: string; toolCallId: string; question: string }
  | { type: 'error'; sessionId: string; message: string }
  | { type: 'done'; sessionId: string; finishReason: string };

export interface PendingAsk {
  toolCallId: string;
  sessionId: string;
  question: string;
  createdAt: number;
}
```

---

## 六、前端需新增的模块

### 6.1 目录结构（建议）

```
webui/src/
├── api/
│   ├── http.ts              # HTTP 客户端（迁移自 webui，扩展新接口）
│   ├── ws.ts                # WS 客户端（迁移自 webui，扩展新消息）
│   └── endpoints.ts         # 按资源拆分的 API 函数（tasks/agents/automations/...）
├── store/
│   └── index.ts             # 全局状态（见 6.2 状态管理方案选型）
├── hooks/
│   ├── useTask.ts           # 任务 hook（迁移 + 扩展 task 概念）
│   ├── useConfig.ts         # 配置 hook（迁移）
│   ├── useTasks.ts          # 任务列表 + 分组
│   ├── useModels.ts         # 模型列表 + 当前选择
│   ├── useAgents.ts         # Agent 列表 + 切换
│   ├── useAutomations.ts    # 自动化 CRUD + 历史
│   ├── useSkills.ts         # Skills 查询
│   ├── useSpecs.ts          # Specs 查询
│   ├── useTodos.ts          # 任务 todo 实时更新（WS）
│   └── useContextFiles.ts   # 任务上下文文件实时更新（WS）
├── types/
│   ├── index.ts             # 现有 UI 类型（保留）
│   └── api.ts               # 新增：API 类型定义（见第五章）
└── ...
```

### 6.2 状态管理方案选型

旧前端使用 zustand，新前端 `package.json` 暂未引入。两个选项：

| 方案 | 优点 | 缺点 |
|---|---|---|
| **A. 引入 zustand**（推荐） | 迁移成本最低，API 与旧前端一致，性能好 | 新增 1 个依赖 |
| B. React Context + useReducer | 无新依赖，符合 architecture.md 描述 | 复杂状态（如 messagesBySession 嵌套更新）代码冗长，性能需优化 |

**建议方案 A**：在 `webui/package.json` 添加 `zustand`，直接迁移已移除旧前端的 store/index.ts 并扩展 task/model/agent/automation 等切片。

### 6.3 关键 hook 设计要点

#### useTask（迁移 + 扩展）
- 旧版：基于 sessionId，sendMessage 直接发 `task.stream`
- 新版：基于 taskId，sendMessage 时若 taskId 无对应 sessionId 则先创建任务，再发 `task.stream`（sessionId 复用 task 元信息中的 sessionId，或后端在 task.stream 时按 taskId 派生）
- 新增：订阅 `todo-updated` / `context-updated` / `file-created` / `file-edited` 事件，更新 store

#### useTasks（新增）
- 挂载时 `GET /api/tasks` 拉取分组 + 任务
- 创建任务 `POST /api/tasks`，切换任务发 `task.switch` WS 消息
- 监听 `task.created` / `task.updated` WS 事件实时更新侧边栏

---

## 七、后端需新增的模组

### 7.1 `src/modules/agenteam/` 模组（新建）

**职责**：自定义 Agent 的 CRUD，持久化到 `~/.moss/agenteam.json`。

**注册方式**：模组无清单文件，由内核静态 import 编排（见 architecture.md 3.2 模组系统）。

**注册服务**：`agenteam.registry`（`AgentRegistry` 接口：list/get/create/update/delete/setDefault）

**路由**（在 server 模组注册）：
- `GET/POST /api/agenteam`、`GET/PATCH/DELETE /api/agenteam/:id`、`PUT /api/agenteam/default`

### 7.2 `src/modules/automation/` 模组（新建）

**职责**：cron/once 定时任务调度，到点触发 agent.run，持久化到 `~/.moss/automations.json` + `~/.moss/automations-history.json`。

**注册方式**：同上，内核静态 import 编排。

**注册服务**：`automation.service`（`AutomationService` 接口：list/get/create/update/delete/trigger/pause/resume/history）

**路由**：
- `GET/POST /api/automations`、`GET/PATCH/DELETE /api/automations/:id`
- `POST /api/automations/:id/trigger|pause|resume`、`GET /api/automations/:id/history`
- `GET /api/automation-templates`

**WS 推送**：运行开始/结束时通过 `server.instance.broadcastWS` 推送 `automation.started` / `automation.finished`。

### 7.3 现有模组扩展

#### server 模组
- `routes/` 新增：`tasks.ts`、`models.ts`、`skills.ts`、`specs.ts`、`todos.ts`、`version.ts`（注：`plugins.ts`、`extensions.ts` 未实施）
- `ws-handler.ts` 新增：`task.create` / `task.switch` / `automation.run` 入站消息处理
- 推送新增：`todo-updated` / `context-updated` / `file-created` / `file-edited` / `config.changed`（注：`extension.changed` 未实施）

#### agent 模组
- 任务元信息持久化实际由 `task-store.ts`（TaskStore）实现：`~/.moss/tasks/<groupId>/` 分组目录，支持分组
- 工具执行时通过 `server.instance.sendToSession` 推送 `todo-updated` / `context-updated` / `file-created` / `file-edited`

#### tools 模组
- `todo.ts` 工具执行后，额外推送 `todo-updated` WS 事件
- `read.ts` / `edit.ts` / `write.ts` 执行后，推送 `context-updated` / `file-created` / `file-edited`

---

## 八、数据持久化新增

| 路径 | 用途 | 格式 | 负责模组 |
|---|---|---|---|
| `~/.moss/tasks/<groupId>/` | 任务分组目录（task.json 为任务元信息） | JSON | agent 模组（TaskStore） |
| `~/.moss/tasks/<groupId>/<sessionId>.json` | 会话历史（每会话一文件） | JSON | agent 模组（SessionStore） |
| `~/.moss/agenteam.json` | 自定义 Agent 列表 | JSON | agenteam 模组 |
| `~/.moss/automations.json` | 自动化任务 | JSON | automation 模组 |
| `~/.moss/automations-history.json` | 自动化运行历史 | JSON | automation 模组 |
| `~/.moss/todo/<sessionId>.json` | 会话级 Todo 列表（每会话一文件） | JSON | tools 模组（todo 工具） |

> 注：规划中的 `~/.moss/tasks.json`（单文件任务元信息）实际实现为 `~/.moss/tasks/<groupId>/` 分组目录结构；`~/.moss/extensions.json`（扩展启用/禁用）未实施。

---

## 九、实施计划（建议顺序）

### 阶段 1：前端基础设施（无后端改动）
1. `webui/package.json` 添加 `zustand` 依赖
2. 新建 `webui/src/api/http.ts` + `ws.ts`（迁移自已移除旧前端的 api/，适配 React 19）
3. 新建 `webui/src/store/index.ts`（迁移 + 扩展 task/model/agent/automation 切片）
4. 新建 `webui/src/types/api.ts`（第五章类型定义）

### 阶段 2：迁移已有接口对接
5. 实现 `useConfig` hook，对接 `GET /api/config` + `/api/api-config`，替换 SettingsPage 硬编码
6. 实现 `useTask` hook，对接 WS `task.stream`，让 HomePage 输入框可发消息
7. 实现 `useTasks` hook（基于现有 `/api/session` 适配），替换 Sidebar 硬编码任务列表
8. 对接 `/api/health`、`/api/mcp/*`（SettingsPage-MCP 面板）

### 阶段 3：后端新增接口
9. 新增 `routes/skills.ts` + `specs.ts` + `extensions.ts` + `version.ts`（低风险，复用已有 Registry）
10. 新增 `routes/models.ts`（聚合 ApiConfig）
11. 新增 `routes/todos.ts` + `sessions/:id/context`（TaskRunningPage 右侧面板）
12. agent 模组扩展任务元信息持久化，新增 `routes/tasks.ts` + `routes/search.ts`

### 阶段 4：新模组
13. 新建 `src/modules/agenteam/` 模组 + `routes/agents.ts`，对接 AgentSwitchMenu + SettingsPage-Agent
14. 新建 `src/modules/automation/` 模组 + `routes/automations.ts`，对接 AutomationPage

### 阶段 5：WS 增强
15. agent/tools 模组在工具执行时推送 `todo-updated` / `context-updated` / `file-*` 事件
16. 前端 useTask 订阅新事件，TaskRunningPage 右侧面板实时更新
17. automation 模组推送 `automation.started` / `automation.finished`

### 阶段 6：收尾
18. ~~新增 `routes/plugins.ts`，对接 PluginMarketPage（启用/禁用 Switch）~~（未实施：系统无插件机制，PluginMarketPage 改为对接 Skills 与 MCP 管理）
19. 配置热重载 WS 推送 `config.changed`，前端 useConfig 订阅自动刷新
20. 移除 `webui/` 旧前端（确认新前端功能完备后）

---

## 十、接口总览速查表

| 资源 | 方法 | 路径 | 状态 |
|---|---|---|---|
| 健康 | GET | /api/health | ✅ 已有 |
| 应用配置 | GET/PUT | /api/config | ✅ 已有 |
| API 配置 | GET/PUT | /api/api-config | ✅ 已有 |
| 会话 | GET/GET/DELETE | /api/session, /api/session/:id | ✅ 已有 |
| MCP | GET/POST | /api/mcp/* | ✅ 已有 |
| 任务 | GET/POST/GET/PATCH/DELETE | /api/tasks, /api/tasks/:id | 🆕 新增 |
| 任务分组 | GET/POST/PATCH/DELETE | /api/task-groups, /api/task-groups/:id | 🆕 新增 |
| 搜索 | GET | /api/search | 🆕 新增 |
| 模型 | GET/PUT/POST/PATCH/DELETE | /api/models, /api/models/current, /api/models/:id | 🆕 新增 |
| Agent | GET/POST/GET/PATCH/DELETE/PUT | /api/agenteam, /api/agenteam/:id, /api/agenteam/default | 🆕 新增 |
| Skills | GET/GET | /api/skills, /api/skills/:name | 🆕 新增 |
| Specs | GET/GET | /api/specs, /api/specs/:id | 🆕 新增 |
| 自动化 | GET/POST/GET/PATCH/DELETE/POST/GET | /api/automations, /api/automations/:id, .../:id/{trigger,pause,resume,history} | 🆕 新增 |
| 自动化模板 | GET | /api/automation-templates | 🆕 新增 |
| Todo | GET/PUT | /api/todos/:sessionId | 🆕 新增 |
| 上下文 | GET | /api/sessions/:id/context | 🆕 新增 |
| 版本 | GET | /api/version | 🆕 新增 |

| WS 入站 | 用途 | 状态 |
|---|---|---|
| task.stream | 流式任务 | ✅ 已有 |
| task.abort | 中断 | ✅ 已有 |
| session.subscribe | 订阅会话 | ✅ 已有 |
| tool.ask.reply | 回复 ask | ✅ 已有 |
| task.create | 创建任务 | 🆕 新增 |
| task.switch | 切换任务 | 🆕 新增 |
| automation.run | 触发自动化 | 🆕 新增 |

| WS 出站 | 用途 | 状态 |
|---|---|---|
| assistant-text/thinking | 文本/思考流 | ✅ 已有 |
| tool-call-start/end | 工具调用 | ✅ 已有 |
| ask / error / done | 提问/错误/完成 | ✅ 已有 |
| task.done / session.subscribed / tool.ask.accepted | 控制消息 | ✅ 已有 |
| todo-updated | Todo 变更 | 🆕 新增 |
| context-updated | 上下文变更 | 🆕 新增 |
| file-created / file-edited | 文件操作 | 🆕 新增 |
| task.created / task.updated | 任务变更 | 🆕 新增 |
| automation.started / finished | 自动化运行 | 🆕 新增 |
| config.changed | 配置热重载 | 🆕 新增 |
