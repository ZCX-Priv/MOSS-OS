// builtin/read/index.ts
// read 工具核心调度层：参数校验 → 路径安全 → 大文件策略 → Dedup → 类型分派 → 结果聚合。
// 元数据（name/description/icon/annotations/inputSchema/config）见同目录 tool.json。
// handlers/ 子目录按文件类型分派，shared/ 子目录提供检测/去重/minified/流式读取等公共能力。
//
// 路径（read/index.ts → src/）：
//   ../../../../utils/fs    — resolveWithinCwd
//   ../../types             — ToolContext, ToolResult, ToolResultContent
//   ./shared/detector       — detectFileType
//   ./shared/dedup          — checkDedup
//   ./handlers/*            — readText/readImage/readPdf/readOffice/readNotebook

import { existsSync, statSync, readFileSync, type Stats } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolveWithinCwd } from '../../../../utils/fs';
import { ServiceNames } from '../../../../core/types';
import { detectFileType, type FileType } from './shared/detector';
import { checkDedup } from './shared/dedup';
import { readText, type TextParams } from './handlers/text';
import { readImage } from './handlers/image';
import { readPdf } from './handlers/pdf';
import { readOffice } from './handlers/office';
import { readNotebook } from './handlers/notebook';
import type { FileHistoryService } from '../../../contracts';
import type { ToolContext, ToolResult, ToolResultContent } from '../../types';

/** read 工具参数结构 */
interface ReadParams {
  /** 单个文件路径（与 paths 互斥） */
  path?: string;
  /** 多文件批量读取路径数组（与 path 互斥） */
  paths?: string[];
  /** 精确模式开始行号；indentation 模式锚点行号（1-based） */
  offset?: number;
  /** 精确模式读取行数 */
  limit?: number;
  /** 读取模式 */
  mode?: 'full' | 'precise' | 'indentation';
  /** PDF 页码范围，如 "1-5" */
  pages?: string;
}

/** 文件大小硬上限：50MB */
const MAX_FILE_SIZE = 50 * 1024 * 1024;

export default {
  async execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
    const p = params as ReadParams;

    // 1. 参数校验：path 与 paths 互斥，至少一个
    const targets = resolveTargets(p);
    if (!targets) {
      return errorResult('path or paths is required');
    }

    // 获取 FileHistoryService（可能未加载，返回 null）
    const fileHistory = ctx.services.tryResolve<FileHistoryService>(ServiceNames.FILE_HISTORY);

    // 2. 逐文件处理（批量时聚合结果）
    const contents: ToolResultContent[] = [];
    const metadatas: Record<string, unknown>[] = [];

    for (const rawPath of targets) {
      const result = await processSingleFile(rawPath, p, ctx.cwd);

      // 读取成功后，注册到 read ledger（支持 write/edit 的 read-before-overwrite 校验）
      let sha: string | null = null;
      if (!result.isError) {
        const absPath = resolveWithinCwd(rawPath, ctx.cwd);
        if (absPath) {
          try {
            // 计算文件内容 sha256 并 markRead（文件已在 OS cache，开销小）
            const buf = readFileSync(absPath);
            sha = createHash('sha256').update(buf).digest('hex');
            if (fileHistory) {
              fileHistory.markRead(ctx.sessionId, absPath, sha);
            }
          } catch {
            // 读取失败忽略（不影响 read 工具主流程）
          }
        }
      }

      contents.push(...result.content);
      // 暴露 sha256 到返回 metadata，供 edit 工具 expectHash 乐观锁使用
      const md = result.metadata ?? {};
      if (sha !== null) {
        (md as Record<string, unknown>).sha256 = sha;
      }
      metadatas.push(md);
    }

    // 3. 单文件直接返回，多文件拼接
    return targets.length === 1
      ? { content: contents, metadata: metadatas[0] }
      : { content: contents, metadata: { files: metadatas } };
  },
};

/** 解析参数，返回要读取的路径数组；无效返回 null */
function resolveTargets(p: ReadParams): string[] | null {
  if (p.paths && p.paths.length > 0) return p.paths;
  if (p.path) return [p.path];
  return null;
}

/** 处理单个文件：安全检测 → 大文件策略 → Dedup → 类型分派 */
async function processSingleFile(
  rawPath: string,
  params: ReadParams,
  cwd: string,
): Promise<ToolResult> {
  // 路径越权检测
  const absPath = resolveWithinCwd(rawPath, cwd);
  if (!absPath) {
    return errorResult(`path "${rawPath}" escapes working directory`);
  }

  // 存在性检测
  if (!existsSync(absPath)) {
    return errorResult(`file not found: ${absPath}`);
  }

  const stat = statSync(absPath);

  // 目录拒绝
  if (stat.isDirectory()) {
    return errorResult(`path is a directory, not a file: ${absPath}`);
  }

  // 大文件策略：>50MB 返回错误 + 提示
  if (stat.size > MAX_FILE_SIZE) {
    return largeFileResult(absPath, stat.size);
  }

  // Dedup 去重：相同 mtime 的文件不重复全量返回
  const dedup = checkDedup(absPath, stat.mtimeMs);
  if (dedup.unchanged) {
    return {
      content: [{ type: 'text', text: `File unchanged since last read: ${absPath}` }],
      metadata: { path: absPath, unchanged: true, sizeBytes: stat.size },
    };
  }

  // 类型分派
  const fileType = detectFileType(absPath);
  const result = await dispatchByType(absPath, fileType, params, stat);

  // 合并元信息
  return {
    ...result,
    metadata: {
      path: absPath,
      type: fileType,
      sizeBytes: stat.size,
      mtimeMs: stat.mtimeMs,
      ...result.metadata,
    },
  };
}

/** 根据文件类型分派到对应 handler */
async function dispatchByType(
  absPath: string,
  fileType: FileType,
  params: ReadParams,
  stat: Stats,
): Promise<ToolResult> {
  switch (fileType) {
    case 'image':
      return readImage(absPath);
    case 'pdf':
      return readPdf(absPath, params.pages);
    case 'office':
      return readOffice(absPath);
    case 'notebook':
      return readNotebook(absPath);
    case 'text':
    default:
      return readText(absPath, {
        mode: params.mode,
        offset: params.offset,
        limit: params.limit,
      } satisfies TextParams, stat);
  }
}

/** 构造大文件错误结果，附"写个程序"提示 */
function largeFileResult(path: string, size: number): ToolResult {
  const sizeMB = (size / 1024 / 1024).toFixed(2);
  return {
    content: [{
      type: 'text',
      text: `Error: file too large (${size} bytes, ${sizeMB}MB, max 50MB): ${path}\n\n提示：文件超过 50MB 上限。你可以：\n1. 使用 mode=precise + offset + limit 精确读取某行范围（例如 offset=1&limit=1000 读取前 1000 行）\n2. 使用 grep 工具搜索特定内容，而非全量读取\n3. 写一个程序解析该文件（例如：写个 Node.js 脚本用 readline 逐行处理，或用 fs.createReadStream 流式读取）`,
    }],
    isError: true,
    metadata: { path, sizeBytes: size, tooLarge: true },
  };
}

/** 构造错误结果 */
function errorResult(message: string): ToolResult {
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
  };
}
