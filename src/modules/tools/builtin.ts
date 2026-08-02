// src/modules/tools/builtin.ts
// 内置工具实例工厂列表。
// 此文件 import 所有工具实例，与 manifest.ts 分离，确保 config 加载不依赖工具实例。
// 名称必须与 manifest.ts 的 TOOL_CONFIGS 一致。

import type { Environment } from '../../core/types';
import type { Tool } from './types';
import { readTool } from './read';
import { writeTool } from './write';
import { editTool } from './edit';
import { deleteTool } from './delete';
import { shellTool } from './shell';
import { useSkillTool } from './use_skill';
import { useMcpTool } from './use_mcp';
import { listMcpTool } from './list_mcp';
import { listSpecTool } from './list_spec';
import { getSpecTool } from './get_spec';
import { globTool } from './glob';
import { grepTool } from './grep';
import { createTodoTool } from './todo';
import { askTool } from './ask';

export interface BuiltinToolEntry {
  name: string;
  factory: (env: Environment) => Tool;
}

/**
 * 内置工具工厂列表。
 * 新增工具时：在 manifest.ts 加配置规格 + 在此处加 factory。
 * name 必须与 manifest.ts 的 TOOL_CONFIGS key 一致。
 */
export const BUILTIN_TOOLS: BuiltinToolEntry[] = [
  { name: 'read',      factory: () => readTool },
  { name: 'write',     factory: () => writeTool },
  { name: 'edit',      factory: () => editTool },
  { name: 'delete',    factory: () => deleteTool },
  { name: 'shell',     factory: () => shellTool },
  { name: 'use_skill', factory: () => useSkillTool },
  { name: 'use_mcp',   factory: () => useMcpTool },
  { name: 'list_mcp',  factory: () => listMcpTool },
  { name: 'list_spec', factory: () => listSpecTool },
  { name: 'get_spec',  factory: () => getSpecTool },
  { name: 'glob',      factory: () => globTool },
  { name: 'grep',      factory: () => grepTool },
  { name: 'todo',      factory: (env) => createTodoTool(env) },
  { name: 'ask',       factory: () => askTool },
];
