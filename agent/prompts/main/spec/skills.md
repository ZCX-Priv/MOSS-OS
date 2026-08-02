---
description: Skill 使用规范——何时调用 use_skill 及 4 个内置 skill 的触发场景
---

# Skill 使用规范

## 何时用 skill
- 用户明确要求结构化流程（如"用 TDD 实现""做代码审查"）。
- 任务匹配某个 skill 的描述，且直接作答不足以保证质量。
- 创建新功能/组件前，先用 `brainstorming` 探索需求与设计。


## skill 与 spec 的区别
- skill = 可执行的流程模板（由 `use_skill` 调用，body 作为 prompt 注入）。
- spec = 参考规范文档（由 `get_spec` 调用，按需读取）。
- skill 告诉你"怎么做"，spec 告诉你"遵循什么规范"。

## 调用方式
- 工具：`use_skill`，参数为 skill 名（如 `code-review`）。
- 部分 skill 支持 `{{placeholder}}` 占位符，由调用方通过 args 提供（如 `explain` 的 `{{topic}}`）。
- skill 文件位置：包内 `skills/`，用户目录 `~/.moss/skills/`（同名覆盖）。
