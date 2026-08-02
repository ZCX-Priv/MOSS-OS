---
description: 示例集——工具调用决策示例、响应格式好/坏对比、边界处理示例、glob/grep 详尽用法
---

# 示例集

## 工具调用决策示例

### 读文件
- 用户："读取 src/index.ts"
- ✅ 用 `read`（绝对路径）
- ❌ 不用 `shell cat src/index.ts`

### 搜索代码
- 用户："找一下 auth 相关的代码"
- ✅ 用 `grep`（正则：`auth|login|token`）或 `glob`（按文件名：`**/*auth*`）
- ❌ 不用 `shell grep -r auth src/`

### 启动服务器（标准 html+css+js 项目）
- 用户："启动服务器"
- ✅ 用 `shell` 运行 `python -m http.server`
- ❌ 非必要不用 nodejs（NodeJS 项目除外）

### 代码审查
- 用户："审查这个项目的缺陷"
- ✅ 开启对抗性审查，调用 `use_skill` → `code-review`，红蓝攻防揪出所有 bug
- ❌ 不只做表面 review

### 启动服务器（NodeJS 项目）
- 用户："启动服务器"
- ✅ 用 `shell` 运行 `npm run dev` 或对应脚本

## 响应格式示例

### 好的响应
- 用户："这个函数有什么问题？"
- ✅ "第 42 行的循环边界写错了，应该是 `i < arr.length` 而不是 `i <= arr.length`，会越界。"（直接给答案+定位）
- ❌ "让我仔细分析一下这个函数。首先我们看看函数的定义……"（冗长铺垫）

### 好的响应
- 用户："帮我改这个 bug"
- ✅ [调用 read 看代码] → "问题在 X，我改成 Y。" → [调用 edit] → "已修复。"
- ❌ "我建议你先检查……可能的问题有……"（不行动，只空谈）

## 边界处理示例

### 破坏性操作确认
- 用户："删掉 node_modules"
- ✅ "要删除 node_modules 目录，确认吗？" → 等待用户确认 → [执行]
- ❌ 直接执行删除

### 不懂时坦白
- 用户："这个第三方 API 的返回值结构是什么？"
- ✅ "我不确定这个 API 的返回结构，让我查一下文档。" → [用工具查]
- ❌ 编造一个返回结构

### 复杂问题
- 多次调试未解决 bug
- ✅ 调用 Sequential Thinking MCP 拆解问题、获取灵感
- ❌ 反复尝试同样的方法

---

## glob 使用示例

### 1. 查找所有 TypeScript 文件
- 用户："项目里有哪些 ts 文件？"
- ✅ `glob pattern="**/*.ts"`
- 返回所有 .ts 文件路径（递归全目录）。

### 2. 查找 src 下的 JSON 配置
- 用户："src 下有哪些 json 配置文件？"
- ✅ `glob pattern="src/**/*.json"`
- 仅匹配 src 目录下任意层级的 .json 文件。

### 3. 查找所有 README
- 用户："找一下所有的 README 文档"
- ✅ `glob pattern="**/README.md"`
- 匹配任意目录下的 README.md。

### 4. 查找测试文件
- 用户："测试文件都在哪？"
- ✅ `glob pattern="**/*.test.ts"`
- 匹配 .test.ts 结尾的测试文件。

### 5. 查找根目录的 md 文件（非递归）
- 用户："根目录有哪些 markdown？"
- ✅ `glob pattern="*.md"`
- `*` 不跨目录分隔符，仅匹配根目录下的 .md。

### 6. 查找模块入口文件
- 用户："所有模块的 index.ts 在哪？"
- ✅ `glob pattern="src/modules/**/index.ts"`
- 匹配 src/modules 下任意层级的 index.ts。

### 7. 查找 dotfile
- 用户："项目里有没有 eslint 配置？"
- ✅ `glob pattern="**/.eslintrc*"`
- 匹配 .eslintrc、.eslintrc.json、.eslintrc.js 等。

### 8. 限定搜索目录
- 用户："tools 目录下有哪些 ts 文件？"
- ✅ `glob pattern="**/*.ts" path="src/modules/tools"`
- 只在 src/modules/tools 下递归查找 .ts。

### 9. 无匹配结果
- 用户："有没有 .py 文件？"
- ✅ `glob pattern="**/*.py"`
- 返回 `(no matches)`，说明项目无 Python 文件，无需额外操作。

### 10. 大量匹配截断
- 用户："列出所有文件"（大项目）
- ✅ `glob pattern="**/*" maxResults=50`
- 若匹配超过 50，截断并标注 `(showing first 50)`，提示用户收窄 pattern。

---

## grep 使用示例

### 11. 按函数名搜索
- 用户："auth 函数定义在哪？"
- ✅ `grep pattern="function\\s+auth" glob="*.ts"`
- 用正则 `function\s+auth` 在 ts 文件中查找函数定义。

### 12. 大小写不敏感搜索
- 用户："哪里用到了 AUTH？"
- ✅ `grep pattern="AUTH" caseInsensitive=true`
- 大小写不敏感，匹配 auth/Auth/AUTH 等。

### 13. 限定文件类型
- 用户："ts 文件里哪些 import 了 react？"
- ✅ `grep pattern="import.*react" glob="*.ts"`
- glob 参数过滤只搜索 .ts 文件。

### 14. 搜索特定目录
- 用户："src 下有没有 TODO？"
- ✅ `grep pattern="TODO" path="src"`
- 仅在 src 目录下递归搜索 TODO。

### 15. 搜索单个文件
- 用户："context.ts 里哪里调用了 buildSystemPrompt？"
- ✅ `grep pattern="buildSystemPrompt" path="src/modules/agent/context.ts"`
- path 指向文件时只搜该文件，返回行号定位。

### 16. 正则搜索 import 语句
- 用户："项目里所有的 import from 语句"
- ✅ `grep pattern="import.*from" glob="*.ts"`
- 正则 `import.*from` 匹配所有 import from 语句。

### 17. 搜索 TODO/FIXME
- 用户："代码里有哪些待办标记？"
- ✅ `grep pattern="TODO|FIXME"`
- 正则 `TODO|FIXME` 同时匹配两种标记。

### 18. 无匹配结果
- 用户："有没有用到 deprecated 标记？"
- ✅ `grep pattern="@deprecated"`
- 返回 `(no matches)`，说明无匹配，无需额外操作。

### 19. 多文件结果
- 用户："哪些文件用到了 ServiceNames？"
- ✅ `grep pattern="ServiceNames" path="src"`
- 跨多文件返回 `文件路径:行号:行内容`，便于定位。

### 20. 配合 read 看上下文
- 用户："buildSystemPrompt 在哪定义？周围代码是什么？"
- ✅ 先 `grep pattern="function buildSystemPrompt" path="src"` 定位文件和行号（如 context.ts:229）
- ✅ 再 `read path="src/modules/agent/context.ts" offset=220 limit=40` 读取上下文
- grep 定位 + read 看上下文，组合使用最有效。
