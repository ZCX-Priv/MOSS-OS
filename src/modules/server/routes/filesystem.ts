// src/modules/server/routes/filesystem.ts
// POST /api/filesystem/pick-directory     —— 调用系统原生文件夹选择对话框，返回真实绝对路径（主路径）
// POST /api/filesystem/resolve-directory  —— 根据文件夹名搜索同名目录，返回候选绝对路径（回退路径）
// GET  /api/filesystem/suggest-paths      —— 返回常用目录列表（主目录/桌面/文档/下载/cwd）
//
// 浏览器安全模型禁止 JS 获取文件夹绝对路径（File System Access API 的 handle.name 只返回文件夹名）。
// 由于 MOSS 后端在本机运行（127.0.0.1），本接口通过 nativefiledialog-for-bun 库调用系统原生
// 文件夹选择对话框（FFI 优先：Windows 调 Win32 IFileDialog / macOS AppKit / Linux GTK；FFI 不可用
// 时回退脚本：PowerShell FolderBrowserDialog / osascript / zenity），拿到用户真实选择的绝对路径返回
// 前端，彻底解决跨盘符误命中问题。
// resolve-directory 作为回退：当后端不可用（远程场景）或原生对话框失败时，前端用浏览器 API
// 取文件夹名再调 resolve-directory 搜索。

import type { HttpRequest, HttpResponse, RouteHandler } from '../types';
import type { Environment } from '../../../core/types';
import { readdirSync, existsSync, statSync, type Dirent } from 'node:fs';
import { join } from 'node:path';
import * as nfd from 'nativefiledialog-for-bun';
import { ErrorCode } from '../../../core/error-codes';

interface ResolveBody {
  folderName?: string;
  hint?: string;
}

interface Candidate {
  path: string;
  parent: string;
}

const MAX_VISIT = 5000;
const MAX_RESULTS = 20;
const TIMEOUT_MS = 1500;
const MAX_DEPTH = 3;

/** 跳过这些巨型/系统目录，避免 BFS 爆炸 */
const SKIP_NAMES = new Set([
  'node_modules',
  '.git',
  '__pycache__',
  '.cache',
  '.npm',
  '.venv',
  'venv',
  'dist',
  'build',
  '.next',
  '.moss',
  'appdata',
  '$recycle.bin',
  'system volume information',
  'windows',
  'program files',
  'program files (x86)',
  'programdata',
  'library', // macOS 系统目录
]);

function isDirectorySafe(p: string): boolean {
  try {
    return existsSync(p) && statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function createResolveDirectoryHandler(env: Environment): RouteHandler {
  return async (req: HttpRequest): Promise<HttpResponse> => {
    const body = (req.body ?? {}) as ResolveBody;
    const folderName = body.folderName?.trim();
    if (!folderName) {
      return { status: 400, body: { error: ErrorCode.FS_FOLDER_NAME_REQUIRED } };
    }
    const hint = body.hint?.trim();
    const isWin = env.isWindows;
    const matchName = isWin ? folderName.toLowerCase() : folderName;
    const nameMatches = (n: string): boolean =>
      isWin ? n.toLowerCase() === matchName : n === matchName;

    const candidates: Candidate[] = [];
    const seen = new Set<string>();
    let visited = 0;
    const start = Date.now();
    const timedOut = () => Date.now() - start > TIMEOUT_MS;

    // hint 优先：若 hint 是合法目录，直接探测 hint/folderName
    if (hint && isDirectorySafe(hint)) {
      const direct = join(hint, folderName);
      if (isDirectorySafe(direct)) {
        return { status: 200, body: { candidates: [], exactMatch: direct } };
      }
    }

    // 搜索根：用户主目录子树 + 标准子目录 + 进程 cwd
    const roots: string[] = [];
    const pushRoot = (p: string) => {
      if (isDirectorySafe(p)) roots.push(p);
    };
    pushRoot(env.homeDir);
    pushRoot(join(env.homeDir, 'Desktop'));
    pushRoot(join(env.homeDir, 'Documents'));
    pushRoot(join(env.homeDir, 'Downloads'));
    pushRoot(process.cwd());

    // BFS（同步遍历 + 时间检查实现软超时）
    const queue: Array<{ dir: string; depth: number }> = roots.map((r) => ({
      dir: r,
      depth: 0,
    }));

    while (
      queue.length > 0 &&
      candidates.length < MAX_RESULTS &&
      visited < MAX_VISIT &&
      !timedOut()
    ) {
      const { dir, depth } = queue.shift()!;
      visited++;
      let entries: Dirent[];
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const ent of entries) {
        if (candidates.length >= MAX_RESULTS || timedOut()) break;
        if (!ent.isDirectory()) continue;
        const lower = ent.name.toLowerCase();
        if (SKIP_NAMES.has(lower)) continue;
        const childPath = join(dir, ent.name);
        const key = isWin ? childPath.toLowerCase() : childPath;
        if (seen.has(key)) continue;
        seen.add(key);
        if (nameMatches(ent.name)) {
          candidates.push({ path: childPath, parent: dir });
        }
        if (depth + 1 < MAX_DEPTH) {
          queue.push({ dir: childPath, depth: depth + 1 });
        }
      }
    }

    const exactMatch = candidates.length === 1 ? candidates[0].path : null;
    return { status: 200, body: { candidates, exactMatch } };
  };
}

export function createSuggestPathsHandler(env: Environment): RouteHandler {
  return async (): Promise<HttpResponse> => {
    const paths: Array<{ path: string; label: string }> = [];
    const tryAdd = (p: string, label: string) => {
      if (isDirectorySafe(p)) paths.push({ path: p, label });
    };
    tryAdd(env.homeDir, '主目录');
    tryAdd(join(env.homeDir, 'Desktop'), '桌面');
    tryAdd(join(env.homeDir, 'Documents'), '文档');
    tryAdd(join(env.homeDir, 'Downloads'), '下载');
    tryAdd(process.cwd(), '当前目录');
    return { status: 200, body: { paths } };
  };
}

// ============================================================================
// POST /api/filesystem/pick-directory
// 通过 nativefiledialog-for-bun 调用系统原生文件夹选择对话框，返回用户真实选择的绝对路径。
// 库优先用 FFI（Bun.dlopen 加载 nfd.dll/libnfd.dylib/libnfd.so）调用现代原生对话框
// （Windows IFileDialog / macOS AppKit / Linux GTK），FFI 不可用时回退到脚本
// （PowerShell FolderBrowserDialog / osascript / zenity）。
// 跨盘符精准无误（系统对话框能浏览所有盘符/位置），不依赖搜索猜测。
// ============================================================================

/** 调用系统原生对话框，返回选中的绝对路径；用户取消/失败返回 null */
async function pickDirectoryNative(_env: Environment): Promise<string | null> {
  try {
    // nfd.pickFolder：用户取消返回 null，成功返回绝对路径，错误抛 NativeDialogError
    const folder = await nfd.pickFolder();
    if (!folder) return null; // 用户取消
    // 防御性校验：路径必须真实存在且为目录
    if (!isDirectorySafe(folder)) return null;
    return folder;
  } catch {
    // FFI 加载失败 / 对话框异常 → 返回 null，前端回退浏览器 API
    return null;
  }
}

export function createPickDirectoryHandler(env: Environment): RouteHandler {
  return async (): Promise<HttpResponse> => {
    const path = await pickDirectoryNative(env);
    return { status: 200, body: { path } };
  };
}