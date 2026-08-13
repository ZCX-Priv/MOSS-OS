# MOSS-OS 对抗性审查修复计划

> **审查方法**：第一性原理 + 红蓝攻防。所有发现均通过 Grep/Read 亲自读取代码核实，剔除与设计意图不符的臆断。
> **审查日期**：2026-08-13
> **路径隔离策略**：严格隔离到工作目录（cwd），read/write/glob/grep 拒绝一切越出 cwd 的路径。
> **状态**：本文件为修复计划，尚未执行改动。

---

## 一、安全缺陷

### S1. read 工具"防越权"完全失效（P0，最严重）

- **文件**：`src/modules/tools/builtin/read/index.ts:81-85`
- **证据**：
  ```ts
  function resolveSafe(path: string, cwd: string): string | null {
    const base = cwd || process.cwd();
    const abs = isAbsolute(path) ? normalize(path) : normalize(resolve(base, path));
    return abs;  // 从不检查越界，永远不返回 null
  }
  ```
- **问题**：函数名与错误文案 `"escapes working directory"` 表明设计意图是工作目录隔离，但实现完全没做——`resolveSafe` 永不返回 `null`，错误分支是死代码。`read` 被标注 `readOnlyHint`（无确认），Agent 可被提示词注入诱导读取 `~/.moss/config/api.json`（含所有 apiKey）。
- **修复**：实现真正的 `resolveSafe`：
  ```ts
  function resolveSafe(path: string, cwd: string): string | null {
    const base = (cwd || process.cwd());
    const abs = isAbsolute(path) ? normalize(path) : normalize(resolve(base, path));
    // 严格隔离：最终路径必须在 cwd 之内
    const boundary = normalize(base) + sep;
    if (abs !== normalize(base) && !abs.startsWith(boundary)) return null;
    return abs;
  }
  ```
  需引入 `node:path` 的 `sep`。

### S2. write / glob / grep 无路径隔离（P0）

- **文件**：
  - `src/modules/tools/builtin/write/index.ts:20-21`
  - `src/modules/tools/builtin/glob/index.ts:21-23`
  - `src/modules/tools/builtin/grep/index.ts:40-42`
- **问题**：三者均直接 `resolve` 任意绝对路径即可读写/枚举，可被诱导越出 cwd。
- **修复**：抽一个共享的 `resolveWithinCwd(path, cwd)` 工具（放 `src/utils/fs.ts`），三处统一调用；越界返回错误 ToolResult。注意：glob/grep 递归遍历时对 `p.path` 用同一函数校验根目录。

### S3. requireConfirmation 是"摆设"（P1）

- **文件**：`src/modules/tools/registry.ts:152-164`
- **证据**：`requireConfirmation` 为 true 时只 `ctx.emit({type:'confirm-required'})`，随后立即 `tool.execute`，不等待确认。
- **问题**：`write`/`shell` 标注的确认保护实际不生效。
- **修复**：给 `ToolContext` 增加可选 `confirm?: (question: string) => Promise<boolean>`（由 engine 注入，复用现有 `askUser` 通道）。`registry.execute` 在 `requireConfirmation` 时：
  ```ts
  if (requireConfirmation && ctx.confirm) {
    const ok = await ctx.confirm(`允许执行工具 ${name}?`);
    if (!ok) return { content: [{type:'text', text:'Canceled by user'}], isError: true };
  }
  ```
  engine 的 `executeBuiltinTool` 注入 `confirm` 实现（若 `ctx.signal` 中断则 reject）。

### S4. API 密钥与鉴权令牌通过 HTTP 明文泄露（P1）

- **文件**：`src/modules/server/routes/config.ts:8-12, 31-35`
- **问题**：
  - `GET /api/api-config` 返回完整 `apiConfig`（含 `models[].apiKey`）。
  - `GET /api/config` 返回含 `security.authToken` 的完整配置。
  - 前端 `webui/src/api/http.ts:140-143` 直接消费。
- **修复**：
  - `GET /api/api-config` 返回前剥离每个 model 的 `apiKey`（`apiKey: ''`），模型列表仍可用。
  - `GET /api/config` 返回前剥离 `security.authToken`。
  - 新增/保留仅内网写接口校验完整字段（PUT 校验在 ConfigService 内，不受影响）。
  - 前端若需要 apiKey 编辑回显，改为写时不回显（编辑时留空表示不修改），避免泄露。

### S5. WebSocket 无鉴权 + decodeURIComponent 未捕获（P2）

- **文件**：
  - `src/modules/server/index.ts`（WS 升级段）
  - `src/modules/server/http-router.ts:109-112`
- **问题**：
  - WS 升级不校验 token（文档"同源信任"），与 S4 叠加。
  - `decodeURIComponent(match[idx+1])` 在 try/catch 外，非法 `%` 编码抛 URIError → 500。
- **修复**：
  - WS 升级阶段若配置了 `authToken`，校验 `Sec-WebSocket-Protocol` 或首个入站 `auth` 消息（最小改动：在 `handleMessage` 对未鉴权连接拒绝 `task.*`/`automation.run` 等敏感动作，或升级时校验查询参数 token）。
  - `decodeURIComponent` 包 try/catch，失败返回 400。

### S6. grep 正则 ReDoS + body 无大小限制（P2）

- **文件**：`src/modules/tools/builtin/grep/index.ts:32`、`src/modules/server/http-router.ts:207`
- **问题**：
  - `new RegExp(p.pattern, 'g')` 接受 LLM 输入，灾难性正则可在大文件上卡死。
  - `parseBody` 无 body 大小上限。
- **修复**：
  - grep 增加正则复杂度预检（长度上限如 200、拒绝嵌套量词 `(a+)+` 等）或引入超时保护；对超长行跳过。
  - `http-router.handle` 在解析 body 前检查 `raw.length`（如 > 2MB 返回 413）。

---

## 二、功能缺陷

### F1. Agent 个性化失效（P0，跨前后端）

- **文件**：
  - `src/modules/agent/engine.ts:49-75`（不读 agents 配置）
  - `src/modules/contracts.ts`（`AgentRunInput` 无 `agentId`）
  - `src/modules/server/ws-handler.ts:124-157`（task.stream 不解析 agentId）
  - `webui/src/hooks/useTask.ts:95-104`（不发 agentId）
  - `src/modules/automation/index.ts`（`AutomationItem.agentId` 无效）
- **修复**（分层贯通）：
  1. `contracts.ts`：`AgentRunInput` 增加 `agentId?: string`。
  2. `useTask.ts`：`task.stream` payload 增加 `agentId: state.currentAgent || undefined`。
  3. `ws-handler.ts`：解析 `agentId` 传入 `agent.run`。
  4. `engine.ts run()`：解析 `agents.registry` 服务，读取 agent 配置并覆盖 `model`/`maxTurns`/`maxTokens`、追加 `systemPrompt`、过滤 `tools` 白名单。
  5. `automation/index.ts`：`executeRun` 用 `item.agentId` 传入 `agent.run`。
- **注意**：需确认 `agents.registry` 服务在 engine 模块加载时已就绪（拓扑序）。

### F2. task.stream 并发覆盖 AbortController（P1）

- **文件**：`src/modules/server/ws-handler.ts:141-142`
- **问题**：`state.abortController` 单槽，同一连接新流覆盖旧流 controller，旧流无法中止。
- **修复**：`ConnectionState` 改为 `activeRuns: Map<sessionId, AbortController>`；`handleTaskAbort` 按 `sessionId` 精确中止对应流；`unregisterConnection` 遍历全部 abort。

### F3. ReAct 达 maxTurns 时 finalText 是中间文本（P1）

- **文件**：`src/modules/agent/engine.ts:285-288`
- **问题**：`finishReason='length'` 但返回的 `finalText` 是上一轮 assistant 文本（非最终答案）。
- **修复**：达 maxTurns 且非 `stop`/`error` 时，追加一条说明文本并 push `done` 事件携带 `finalText` 为已生成内容的提示（或保持现状但确保前端能识别 `length` 状态并显示"已达轮数上限"）。

### F4. MCP 工具名前缀解析缺陷（P1）

- **文件**：`src/modules/agent/engine.ts:447`
- **问题**：`/^mcp__([^_]+)__(.+)$/` 对 server 名含下划线（如 `my_server`）解析错误。
- **修复**：改为 `name.indexOf('__')` 取前缀，`slice` 分隔 server 与 tool；或使用非贪婪 `^mcp__(.+?)__(.+)$` 并保证 tool 名非空。

---

## 三、性能 / 弱网（0.5-1M）

### W1. SSE 解析对 CRLF 供应商整体缓存（P1，破坏流式 TTFB）

- **文件**：`src/modules/llm/stream.ts:26-35`
- **问题**：只按 `\n\n` 切分，`\r\n\r\n` 不会被切分，整段缓存到流结束才一次性 yield——流式退化为整块到达。
- **修复**：`parseSSEStream` 同时兼容 `\n\n` 与 `\r\n\r\n`：在 buffer 中查找 `\n\n` 或 `\r\n\r\n` 中先出现者，且对 `\r\n` 行尾统一在 `extractDataField` 剥离。可改为用 `buffer.split(/\r?\n\r?\n/)` 并按剩余片段保留。

### W2. 前端 WS 重连 10 次后永久停止 + 无心跳 + 消息无限累积（P1）

- **文件**：`webui/src/api/ws.ts:104-114, 85-92`
- **问题**：
  - `scheduleReconnect` 达到 `maxReconnectAttempts` 后不再重连，WS 永久死亡。
  - 无 ping/pong，网络黑洞连接变僵尸，`onclose` 不触发。
  - `pendingMessages` 断连时无限增长。
- **修复**：
  - 提高/无限重连（指数退避 + 抖动，上限 30s，不设固定次数上限或设高上限如 60）。
  - 增加心跳：`onopen` 后 `setInterval` 发送 `{type:'ping'}`（或 ws ping 帧），超时未 pong 主动 `close()` 触发重连。
  - `pendingMessages` 加上限（如 1000）与积压时间清理。
  - 后端 `ws-handler` 响应 `ping`。

### W3. LLM 流式超时只覆盖到响应头（P2）

- **文件**：`src/modules/llm/client.ts:49-72`
- **问题**：`clearTimeout` 在拿到 headers 后即清除，流中途 stall 永不超时。
- **修复**：对流式响应启动"空闲超时"（如 60s 无数据则 abort），在 parseSSEStream 消费时重置；或由 engine 层对 `llm.stream` 增加整体超时。

### W4. searchAll O(n²) + glob/grep 同步全树递归（P2）

- **文件**：
  - `src/modules/agent/engine.ts:382-404`
  - `src/modules/tools/builtin/glob/index.ts:87-107`
  - `src/modules/tools/builtin/grep/index.ts:143-164`
- **问题**：
  - `searchAll` 每 session 内 `indexOf` 双重循环。
  - `collectFiles` 同步 `readdirSync` 全树递归，无深度/文件数上限，大目录阻塞事件循环。
- **修复**：
  - `searchAll` 用 `for...of` 直接遍历 `msg.content` 的 `toLowerCase().includes(q)`，去掉 `indexOf` 查找（改用索引循环）。
  - `collectFiles` 增加 `MAX_DEPTH`（如 20）与 `MAX_FILES`（如 50_000）与 `IGNORED_DIRS` 之外的可选超时检查，超限即截断并标记 `truncated`。

---

## 四、死代码 / 样式清理

| 项 | 位置 | 判定 | 处置 |
|---|---|---|---|
| read `resolveSafe` 永不返回 null 分支 | `read/index.ts:81-85` | 死代码 | 随 S1 一并修复（不再返回 null 的调用点保留）|
| `useTodos` / `useContextFiles` / `useMcp` 三 hook | `webui/src/hooks/` | 可安全删 | 删除（store 由 `useWebSocket` 的 WS 事件填充，不影响功能）|
| `activePanel` / `setActivePanel` | `store/index.ts:101,328,547` | 可安全删 | 删除字段与 action |
| `describeTools` | `src/modules/agent/context.ts:294` | 可安全删 | 删除 |
| 13 个死 api 方法 | `webui/src/api/http.ts` | 可安全删 | 按 legacy 报告清单删除（health/getSessionHistory/deleteSession/callMcpTool/getTask/listTaskGroups/getAgent/getPlugin/getSkill/getSpec/getAutomation/getVersion/suggestPaths 中确认无调用者者）|
| extensions 路由 | `src/modules/server/routes/extensions.ts` | 可安全删 | 删除文件 + `http.ts` 中 `listExtensions`/`updateExtension` + `usePlugins.ts` 降级分支 |
| `PluginState` 别名 | `src/core/types.ts:318-319` | 可安全删 | 删除 |
| `WSMessage.taskId` 字段 | `webui/src/types/api.ts` | 可安全删 | 删除 |

> **扩展设计确认**：`todosBySession`/`contextBySession` 虽由 WS 填充，但 hook 本身确无引用且非扩展点，判定为可删；若后续需首屏预加载再通过页面 useEffect 补 `api.listTodos`/`api.getSessionContext` 即可，不需保留死 hook。

---

## 五、执行批次与顺序

| 批次 | 内容 | 风险 | 依赖 |
|---|---|---|---|
| **第一批（安全+弱网）** | S1, S2, S6, W1, W2, S5(decodeURIComponent) | 低 | 无 |
| **第二批（安全-确认/泄露）** | S3（confirm 通道）, S4（apiKey 脱敏） | 中 | 第一批 |
| **第三批（功能）** | F1（agent 贯通）, F2, F3, F4, W3, W4 | 中-高 | 需测试 |
| **第四批（死代码）** | 第四节的 9 项清理 | 低 | 无 |
| **第五批（回归）** | 全量 typecheck + 构建 + 手动弱网验证 | - | 全部 |

**验证命令**：`npm run typecheck`（根）、`cd webui && npm run build`、`npm run build`。

---

## 六、审查结论

三个根本性问题：
1. **安全边界形同虚设**（S1/S2/S3/S4）：工具路径隔离未实现、确认机制未强制、密钥明文泄露——这是最需要立即修复的。
2. **弱网健壮性不足**（W1/W2）：SSE 解析与 WS 重连在 0.5-1M 弱网下会退化或永久断连。
3. **"Agent 个性化"是假象**（F1）：配置与执行链路断裂。

本计划按"安全 → 弱网 → 功能 → 清理 → 回归"顺序推进，每批独立可交付、可回滚。
