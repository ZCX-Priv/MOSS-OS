<div align="center">

<img src="webui/public/MOSS.png" width="150" alt="MOSS Logo" />

# MOSS

**微内核 · 模块化 · 可扩展的 AI Agent 操作系统**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Runtime: Bun](https://img.shields.io/badge/Runtime-Bun%20%3E%3D%201.1.0-orange.svg)](https://bun.sh)
[![UI: React 19](https://img.shields.io/badge/UI-React%2019-61dafb.svg)](https://react.dev)
[![Language: TypeScript](https://img.shields.io/badge/Language-TypeScript-3178c6.svg)](https://www.typescriptlang.org)
[![Protocol: MCP](https://img.shields.io/badge/Protocol-MCP-5e5ce6.svg)](https://modelcontextprotocol.io)

</div>

---

## 简介

MOSS 是一个基于**微内核 + 模组化插件架构**的本地 AI Agent 应用，运行于 [Bun](https://bun.sh) 运行时之上。它以浏览器 Web UI 作为交互界面，以本地常驻服务作为核心载体，将 LLM 推理、工具执行、上下文管理与任务调度整合为一套完整、可扩展的 Agent 运行环境。

内核仅提供配置、事件、服务注册与扩展加载四项基础能力，其余一切功能——从 Agent 引擎、LLM 路由到 HTTP 服务与定时任务——均以模组形式挂载，模组之间通过服务契约（`ServiceRegistry`）与事件总线（`EventBus`）解耦协作。这种架构使 MOSS 既保持核心的精简稳定，又允许通过插件与 Skill 在不触碰内核的情况下持续扩展能力边界。

## 核心特性

- **微内核架构** —— ConfigService / EventBus / ServiceRegistry / Logger 四大核心服务，模组按依赖拓扑序加载，正向初始化、反向销毁
- **ReAct Agent 引擎** —— 流式文本与思维链输出、多轮工具调用循环、上下文自动压缩与裁剪、工具结果智能折叠
- **多 LLM Provider 路由** —— 内置 openai-chat / openai-responses / anthropic / gemini 等接口格式，支持 DeepSeek、Anthropic、OpenAI、Gemini、Qwen、GLM、Kimi 等主流模型，按模型自动解析路由，支持 thinking 推理输出
- **MCP 协议支持** —— 接入任意 Model Context Protocol 外部工具服务器，与内置工具统一调度
- **内置工具集** —— read / write / edit / delete / shell / glob / grep / todo / ask 等，写操作与命令执行可配置逐次确认
- **Skills 系统** —— 以 Markdown + YAML front-matter 定义的可复用技能，内置头脑风暴、代码评审、讲解、规划、TDD 等技能，支持用户自定义与热重载
- **自动化任务** —— 基于 cron 表达式的定时调度，附带完整运行历史与暂停/恢复控制
- **多 Agent 管理** —— 自定义 Agent 的创建、编辑、删除与默认切换，各 Agent 拥有独立的提示词与模型配置
- **插件系统** —— 用户目录 `~/.moss/plugins/` 下的插件具备受限上下文，按声明白名单消费服务，先模组后插件安全加载
- **现代 Web UI** —— React 19 + shadcn/ui + Tailwind 4，中英双语（i18next），PWA 离线可用，主题/字号/密度可调
- **安全默认** —— 默认仅绑定 127.0.0.1，支持 Bearer Token 鉴权，敏感工具独立确认开关

## 系统架构

```
┌─────────────────────────────────────────────────────────┐
│                     浏览器 (Web UI)                      │
│      React 19 + shadcn/ui + Tailwind 4 + i18next        │
└──────────────┬──────────────────────┬───────────────────┘
               │ HTTP REST (/api/*)    │ WebSocket (/ws)
               ▼                      ▼
┌─────────────────────────────────────────────────────────┐
│                Server 模组 (Bun.serve :7766)             │
│         HTTP 路由 + WS 处理 + 静态资源服务                │
└──────────────┬──────────────────────────────────────────┘
               │ ServiceRegistry 依赖注入
               ▼
┌─────────────────────────────────────────────────────────┐
│                    微内核 (Kernel)                       │
│  ConfigService │ EventBus │ ServiceRegistry │ Logger     │
│         ExtensionManager（模组/插件发现与加载）           │
└──────────────┬──────────────────────────────────────────┘
               │ 按拓扑序加载
               ▼
  ┌──────────────┬──────────────┬──────────────┬──────────────┐
  │  Agent 模组   │  LLM 模组    │  MCP 模组    │ Tools 模组   │
  │ (ReAct 引擎)  │ (多Provider) │  (外部工具)  │ (工具+Skill) │
  └──────────────┴──────────────┴──────────────┴──────────────┘
  ┌──────────────┬──────────────┬──────────────┬──────────────┐
  │ Server 模组   │ Agents 模组  │Automation模组│ Update 模组  │
  │  (HTTP+WS)   │  (Agent CRUD)│  (定时任务)   │  (版本检查)  │
  └──────────────┴──────────────┴──────────────┴──────────────┘
```

**模组一览：**

| 模组 | 职责 | 注册的标准服务 |
|---|---|---|
| `agent` | ReAct 循环、会话管理、事件流 | `agent.engine` |
| `llm` | 多 Provider 路由与流式调用 | `llm.router` |
| `mcp` | MCP 客户端管理 | `mcp.manager` |
| `tools` | 内置工具 + Skill/Spec 注册表 | `tool.registry`、`skill.registry`、`spec.registry` |
| `server` | HTTP + WebSocket 服务 | `server.instance` |
| `agents` | 自定义 Agent CRUD | `agents.registry` |
| `automation` | 定时任务调度 | `automation.service` |
| `daemon` | 守护进程管理 | — |
| `update` | 版本检查 | — |

## 快速开始

### 环境要求

| 依赖 | 版本 | 用途 |
|---|---|---|
| [Bun](https://bun.sh) | >= 1.1.0 | 后端运行时与测试 |
| [Node.js](https://nodejs.org) + npm | >= 18 | 前端依赖管理与开发工具链 |

### 安装

```bash
# 克隆仓库
git clone <repository-url>
cd MOSS-OS

# 安装后端依赖
npm install

# 安装前端依赖
cd webui
npm install
cd ..
```

### 首次配置

MOSS 首次启动会自动在 `~/.moss/config/` 下生成配置模板。编辑 `~/.moss/config/api.json`，填入至少一个 Provider 的 API Key：

```json
{
  "version": 1,
  "defaultProvider": "deepseek",
  "providers": {
    "deepseek": {
      "format": "openai-chat",
      "endpoint": "https://api.deepseek.com",
      "apiKey": "<你的 API Key>",
      "models": ["deepseek-chat", "deepseek-reasoner"],
      "thinking": { "enabled": false }
    }
  }
}
```

配置保存后无需重启，内核监听文件变更并自动热重载。

### 启动

```bash
# 前台运行（推荐首次使用，日志直接输出）
npm run start

# 或以守护进程方式后台运行
npm run start:daemon
```

启动后访问 **http://127.0.0.1:7766** 即可使用 Web UI。

## CLI 命令

```bash
moss start [--foreground]   # 启动服务（--foreground 前台运行，默认守护进程）
moss stop                   # 停止守护进程
moss status                 # 查看运行状态
moss restart                # 重启服务
moss update                 # 更新版本
moss version                # 查看当前版本
```

等价的 npm scripts 亦可用：`npm run start / stop / status / restart / update / version`。

## 配置

所有配置与用户数据位于 `~/.moss/`：

| 文件 | 职责 |
|---|---|
| `~/.moss/config/config.json` | 应用配置：服务端口、守护进程、Agent 参数、工具开关、安全策略 |
| `~/.moss/config/api.json` | 模型配置：Provider 列表、API Key、模型与 thinking 参数 |

**支持的 Provider 接口格式：**

| format | 示例 endpoint | thinking 支持 |
|---|---|---|
| `openai-chat` | `https://api.openai.com/v1` | 否 |
| `openai-responses` | `https://api.openai.com/v1` | 是（effort） |
| `anthropic` | `https://api.anthropic.com/v1` | 是（effort + budgetTokens） |
| `gemini` | `https://generativelanguage.googleapis.com/v1beta` | 是（budgetTokens） |

常用配置项（`config.json`）：

```json
{
  "server": { "host": "127.0.0.1", "port": 7766 },
  "agent": { "defaultModel": "deepseek-chat", "maxTokens": 8192 },
  "security": { "authToken": "", "bindLocalhostOnly": true }
}
```

- `security.authToken`：非空时所有 HTTP 请求需携带 `Authorization: Bearer <token>`
- `tools.*.requireConfirmation`：为 `write` / `delete` / `shell` 等敏感工具启用逐次确认
- 配置文件变更后 300ms 防抖自动重载，无需重启服务

## 技术栈

| 层 | 技术 |
|---|---|
| 后端运行时 | Bun + TypeScript |
| 内核 | 自研微内核（Zod 配置校验、fs.watch 热重载、拓扑排序加载） |
| LLM 接入 | openai-chat / openai-responses / anthropic / gemini 格式，流式 SSE |
| 工具协议 | Model Context Protocol (MCP) SDK |
| 前端框架 | React 19 + React Router 7 |
| UI 组件 | shadcn/ui + Radix UI + Tailwind CSS 4 + Lucide Icons |
| 状态与数据 | Zustand + idb（IndexedDB） |
| 可视化 | Three.js / React Three Fiber、Mermaid、Shiki、KaTeX |
| 构建工具 | Vite 8（前端）、bun build（后端单文件打包） |
| 国际化 | i18next（中文 / English） |

## 项目结构

```
MOSS/
├── webui/                       # 前端（React 19 + shadcn/ui）
│   └── src/
│       ├── api/                 # HTTP + WS 客户端封装
│       ├── components/          # UI 组件
│       ├── hooks/               # 业务 hooks
│       ├── store/               # 全局状态
│       ├── i18n/                # 国际化（zh/en）
│       └── types/               # 前后端共享类型
├── src/
│   ├── main.ts                  # 入口：CLI 解析 + 启动 Kernel
│   ├── cli/                     # CLI 命令实现
│   ├── core/                    # 微内核（kernel/config/event-bus/...）
│   ├── modules/                 # 模组（agent/llm/mcp/tools/server/...）
│   └── utils/                   # 通用工具
├── agent/prompts/main/          # Agent 系统提示词（.md）
├── plugins/                     # 内置插件模板（首次启动播种到 ~/.moss/plugins/）
├── skills/                      # Skill 定义（.md + YAML front-matter）
├── config/                      # 配置模板
├── docs/                        # 架构与 API 文档
├── scripts/                     # 构建/开发脚本
└── bin/moss.js                  # CLI 入口
```

## 开发指南

### 开发模式

```bash
npm run dev
```

并行启动：

- 后端：`bun run --watch src/main.ts start --foreground --log-level debug`，监听 **7766** 端口，文件改动自动重启
- 前端：Vite dev server，监听 **5173** 端口，`/api` 与 `/ws` 自动代理到后端

访问 http://localhost:5173 进行开发调试，`Ctrl+C` 优雅退出全部子进程。

### 构建与测试

```bash
npm run build        # 构建后端（dist/server.js）+ 前端（dist/webui/）
npm run build:ui     # 仅构建前端
npm run build:backend  # 仅构建后端
npm run test         # 运行测试（bun test）
npm run test:watch   # 监听模式测试
npm run typecheck    # TypeScript 类型检查
```

## 扩展体系

MOSS 提供三种扩展方式，能力与权限由强到弱：

| 类型 | 位置 | 清单 | 上下文 | 权限 |
|---|---|---|---|---|
| **模组 (Module)** | `src/modules/*/` | `module.json` | `ModuleContext` | 可注册受保护服务，先加载 |
| **插件 (Plugin)** | `~/.moss/plugins/*/` | `plugin.json` | `PluginContext` | 仅可消费声明白名单服务，后加载 |
| **Skill** | `~/.moss/skills/` 或 `skills/` | YAML front-matter | 工具调用 | Agent 按需加载执行 |

插件通过 `permissions.consumeServices` 声明所需服务，未声明的服务访问会被拒绝，保证内核与模组安全边界。

## 文档

- [系统架构详述](docs/architecture.md) —— 微内核、扩展系统、Agent 工作流、数据持久化
- [前后端 API 对接](docs/frontend-backend-api.md) —— REST 接口与 WebSocket 协议细节

## License

本项目基于 [MIT License](LICENSE) 开源。
