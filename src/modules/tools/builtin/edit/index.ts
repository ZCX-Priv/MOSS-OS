// builtin/edit/index.ts
// edit 工具 execute 逻辑：精确字符串匹配替换，oldString 必须唯一，支持 replaceAll。
// 元数据见同目录 tool.json。

import { t } from '../../../../core/i18n';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, normalize, resolve } from 'node:path';
import { hasUtf8Bom, stripBom } from '../../../../utils/encoding';
import type { ToolContext, ToolResult } from '../../types';

export default {
  async execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
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
      writeFileSync(absPath, hadBom ? '\uFEFF' + newContent : newContent, 'utf8');
      ctx.logger.info(t('tools.fileEdited', { path: absPath }), { replacements });
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
