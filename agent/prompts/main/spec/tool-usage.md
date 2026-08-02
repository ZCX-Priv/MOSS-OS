---
description: 工具使用详细规范——read/write/edit/glob/grep/shell 的具体用法、参数要点与选择决策
---

# 工具使用规范

## read
- 用途：读取文件内容（带行号显示）。
- 参数：`path`（绝对路径）、可选 `offset`/`limit`（大文件分段读）。
- 何时用：需要查看文件内容时。
- 禁止：不要用 `shell` 的 cat/head/tail/sed 读取文件，用 `read`。

## write
- 用途：创建新文件或完整覆盖现有文件。
- 参数：`path`（绝对路径）、`content`。
- 约束：覆盖现有文件前必须先 `read`（工具强制要求）。
- 禁止：不要用 `shell` 的 heredoc/echo 重定向创建文件，用 `write`。

## edit
- 用途：对现有文件做精确字符串替换。
- 参数：`path`、`oldString`、`newString`、可选 `replaceAll`。
- 关键：`oldString` 必须在文件中唯一；不唯一时提供更多上下文使其唯一，或用 `replaceAll` 替换全部。
- 约束：编辑前必须先 `read`；编辑后若需再次编辑同一文件，重新 `read`（行号已变）。
- 禁止：不要用 `shell` 的 sed/awk 编辑文件，用 `edit`。

## glob
- 用途：按文件名模式（glob pattern）查找文件，返回匹配的文件路径列表。
- 参数：`pattern`（glob 模式，如 `**/*.ts`）、可选 `path`（搜索根目录，默认工作目录）、可选 `maxResults`（默认 200，上限 1000）。
- 支持通配符：`*`（单层非分隔符）、`**`（跨任意层级目录）、`?`（单个字符）、`[abc]`（字符类）。
- 何时用：按文件名/扩展名/路径模式查找文件时。
- 禁止：不要用 `shell` 的 find/Get-ChildItem 查找文件，用 `glob`。
- 注意：自动跳过 `node_modules`/`.git`/`dist`/`build` 等目录。

## grep
- 用途：按正则表达式搜索文件内容，返回匹配的行（带文件路径和行号）。
- 参数：`pattern`（正则）、可选 `path`（文件或目录，默认工作目录）、可选 `glob`（文件名过滤，如 `*.ts`）、可选 `caseInsensitive`（默认 false）、可选 `maxResults`（默认 100，上限 500）。
- 何时用：按内容查找代码/文本时（函数定义、TODO、import、特定字符串等）。
- 禁止：不要用 `shell` 的 grep/Select-String 搜索文件内容，用 `grep`。
- 注意：自动跳过二进制文件和 `node_modules`/`.git`/`dist`/`build` 等目录；单文件超过 10MB 跳过。

## shell
- 用途：执行终端命令（git、npm、bun、python、构建、测试等）。
- 环境：Windows + PowerShell。不是 Bash。
- 关键约束：
  - 不要用 `&&` 连接命令（PowerShell 不支持作为语句分隔符）。需要顺序执行用 `;`；需要"前者成功才执行后者"应分别调用或显式判断。
  - 不要用 `find`/`grep` 搜索文件/内容，用 `glob`/`grep` 工具。
  - 不要用 `cat`/`head`/`tail` 读文件，用 `read`。
  - 避免交互式命令（如 `npm create` 不带 `--` 参数会卡住等待输入）。
  - 不要用 `cd` 切换目录后再运行命令，用 `cwd` 参数指定工作目录。

## 工具选择决策
| 需求 | 工具 |
|------|------|
| 读已知路径的文件 | `read` |
| 按文件名模式找文件 | `glob` |
| 按内容正则搜文件 | `grep` |
| 按关键词搜代码 | `grep` |
| 运行命令 | `shell` |
| 创建新文件 | `write` |
| 精确编辑现有文件 | `edit` |
| 列出可用规范 | `list_spec` |
| 读取某个规范 | `get_spec` |
| 调用流程模板 | `use_skill` |
| 调用 MCP 工具 | `use_mcp` |

## 并行与串行
- 独立的工具调用（互不依赖）尽量放在同一条消息里并行。
- 有依赖的调用（后者的参数依赖前者的结果）必须串行，等前者返回。
- 单条消息并行调用不超过 5 个（除非用户明确要求更多）。
