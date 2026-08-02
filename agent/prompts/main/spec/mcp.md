---
description: MCP 使用规范——use_mcp/list_mcp 调用、MCP 工具命名与优先级
---

# MCP 使用规范

## 何时用 MCP
当内置工具无法覆盖所需能力时，考虑 MCP：
- 外部数据库查询
- 第三方 API 调用（已配置为 MCP server）
- 特定领域工具（已封装为 MCP）

## 可用工具
- `list_mcp`：列出当前已配置的 MCP 服务器及其工具。
- `use_mcp`：调用某个 MCP 服务器的具体工具。

## MCP 工具命名
- 注入到 LLM 时，MCP 工具名带前缀：`mcp__{server}__{tool}`。
- 例如 server 名为 `github`，tool 名为 `create_issue`，则调用名为 `mcp__github__create_issue`。

## 优先级
- 内置工具优先：`read`/`write`/`edit`/`glob`/`grep`/`shell` 等更轻量、更快。
- MCP 作为扩展能力：当内置工具能完成时不调用 MCP。
- MCP 工具调用失败时（如认证错误、超时），向用户说明并建议检查 MCP 配置。

## 配置位置
- MCP 服务器配置：包内 `mcps/`，用户目录 `~/.moss-os/mcps/`（同名覆盖）。
- 配置格式：JSON（参考 `mcps/filesystem.example.json`）。
