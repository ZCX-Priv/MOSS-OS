// src/plugins/tools/edit.ts
// edit 工具：精确字符串匹配替换，oldString 必须唯一，支持 replaceAll。

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, normalize } from 'node:path';
import { hasUtf8Bom, stripBom } from '../../utils/encoding';
import type { Tool, ToolResult } from './types';

export const editTool: Tool = {
  name: 'edit',
  description:
    'Edit a file by replacing a specific string with a new string. ' +
    'The oldString must be unique in the file unless replaceAll is true. ' +
    'Use replaceAll to replace all occurrences.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Absolute or relative path to the file to edit.',
      },
      oldString: {
        type: 'string',
        description: 'The exact string to find in the file.',
      },
      newString: {
        type: 'string',
        description: 'The string to replace oldString with.',
      },
      replaceAll: {
        type: 'boolean',
        description: 'If true, replace all occurrences of oldString (default false).',
      },
    },
    required: ['path', 'oldString', 'newString'],
    additionalProperties: false,
  },
  annotations: {
    destructiveHint: true,
  },
  icon: 'file-pen',
  async execute(params, ctx): Promise<ToolResult> {
    const p = params as {
      path: string;
      oldString: string;
      newString: string;
      replaceAll?: boolean;
    };

    if (!p.path) {
      return { content: [{ type: 'text', text: 'Error: path is required' }], isError: true };
    }
    if (typeof p.oldString !== 'string' || typeof p.newString !== 'string') {
      return { content: [{ type: 'text', text: 'Error: oldString and newString must be strings' }], isError: true };
    }
    if (p.oldString === p.newString) {
      return { content: [{ type: 'text', text: 'Error: oldString and newString are identical' }], isError: true };
    }
    if (p.oldString === '') {
      return { content: [{ type: 'text', text: 'Error: oldString cannot be empty' }], isError: true };
    }

    const base = ctx.cwd || process.cwd();
    const absPath = isAbsolute(p.path) ? normalize(p.path) : normalize(resolve(base, p.path));

    if (!existsSync(absPath)) {
      return {
        content: [{ type: 'text', text: `Error: file not found: ${absPath}` }],
        isError: true,
      };
    }

    let content: string;
    let hadBom = false;
    try {
      const rawBuf = readFileSync(absPath);
      hadBom = hasUtf8Bom(rawBuf);
      content = stripBom(rawBuf.toString('utf8'));
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error reading file: ${err instanceof Error ? err.message : err}` }],
        isError: true,
      };
    }

    // 统计匹配次数
    const occurrences = countOccurrences(content, p.oldString);
    if (occurrences === 0) {
      return {
        content: [{ type: 'text', text: `Error: oldString not found in ${absPath}` }],
        isError: true,
      };
    }

    if (occurrences > 1 && !p.replaceAll) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: oldString appears ${occurrences} times in ${absPath}. ` +
              `Make oldString more specific or set replaceAll=true.`,
          },
        ],
        isError: true,
      };
    }

    let newContent: string;
    let replacements: number;
    if (p.replaceAll) {
      newContent = content.split(p.oldString).join(p.newString);
      replacements = occurrences;
    } else {
      newContent = content.replace(p.oldString, p.newString);
      replacements = 1;
    }

    try {
      // 保留原文件 BOM（若有），保持编码一致性
      writeFileSync(absPath, hadBom ? '\uFEFF' + newContent : newContent, 'utf8');
      ctx.logger.info(`File edited: ${absPath}`, { replacements });
      return {
        content: [
          {
            type: 'text',
            text: `Successfully edited ${absPath} (${replacements} replacement${replacements > 1 ? 's' : ''})`,
          },
        ],
        metadata: { path: absPath, replacements, occurrences },
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error writing file: ${err instanceof Error ? err.message : err}` }],
        isError: true,
      };
    }
  },
};

function countOccurrences(haystack: string, needle: string): number {
  if (needle === '') return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

function resolve(...paths: string[]): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('node:path');
  return path.resolve(...paths);
}
