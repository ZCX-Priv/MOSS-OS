// src/modules/server/routes/filesystem.ts
// POST /api/filesystem/pick-directory     —— 调用系统原生文件夹选择对话框，返回真实绝对路径（主路径）
// POST /api/filesystem/resolve-directory  —— 根据文件夹名搜索同名目录，返回候选绝对路径（回退路径）
// GET  /api/filesystem/suggest-paths      —— 返回常用目录列表（主目录/桌面/文档/下载/cwd）
//
// 浏览器安全模型禁止 JS 获取文件夹绝对路径（File System Access API 的 handle.name 只返回文件夹名）。
// 由于 MOSS-OS 后端在本机运行（127.0.0.1），本接口直接调用系统原生文件夹选择对话框，
// 拿到用户真实选择的绝对路径返回前端，彻底解决跨盘符误命中问题。
// resolve-directory 作为回退：当后端不可用（远程场景）或原生对话框失败时，前端用浏览器 API
// 取文件夹名再调 resolve-directory 搜索。

import type { HttpRequest, HttpResponse, RouteHandler } from '../types';
import type { Environment } from '../../../core/types';
import { readdirSync, existsSync, statSync, type Dirent } from 'node:fs';
import { join } from 'node:path';

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
      return { status: 400, body: { error: 'folderName required' } };
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
    tryAdd(env.homeDir, 'Home');
    tryAdd(join(env.homeDir, 'Desktop'), 'Desktop');
    tryAdd(join(env.homeDir, 'Documents'), 'Documents');
    tryAdd(join(env.homeDir, 'Downloads'), 'Downloads');
    tryAdd(process.cwd(), 'Current');
    return { status: 200, body: { paths } };
  };
}

// ============================================================================
// POST /api/filesystem/pick-directory
// 调用系统原生文件夹选择对话框，返回用户真实选择的绝对路径。
// 这是解决"浏览器拿不到绝对路径"的正解：后端在本机运行，直接调原生对话框。
// 跨盘符精准无误（系统对话框能浏览所有盘符/位置），不依赖搜索猜测。
// ============================================================================

const PICK_TIMEOUT_MS = 120_000; // 用户操作可能较慢，给 120 秒

/** 构建各平台的文件夹选择命令 */
function buildPickCommand(env: Environment): { cmd: string[]; platform: 'win' | 'mac' | 'linux' } {
  if (env.isWindows) {
    // Windows: PowerShell + Shell.Application COM 的 BrowseForFolder
    // 用 -EncodedCommand（UTF-16LE Base64）确保脚本与中文编码无误
    // windowsHide:true 会隐藏 PowerShell 黑框，但 COM 对话框独立正常显示
    const script =
      "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;" +
      "$s=New-Object -ComObject Shell.Application;" +
      "$f=$s.BrowseForFolder(0,'Select Working Directory',0,'');" +
      "if($f){$f.Self.Path}";
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    return { cmd: ['powershell', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], platform: 'win' };
  }
  if (env.isMac) {
    // macOS: osascript choose folder，用户取消返回退出码 1
    return {
      cmd: ['osascript', '-e', 'POSIX path of (choose folder with prompt "Select Working Directory")'],
      platform: 'mac',
    };
  }
  // Linux: zenity，用户取消返回退出码 1；若未安装 zenity，spawn 会抛错（前端回退浏览器 API）
  return {
    cmd: ['zenity', '--file-selection', '--directory', '--title=Select Working Directory'],
    platform: 'linux',
  };
}

/** 调用系统原生对话框，返回选中的绝对路径；用户取消/超时/失败返回 null */
async function pickDirectoryNative(env: Environment): Promise<string | null> {
  const { cmd } = buildPickCommand(env);
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proc = (Bun as any).spawn({
      cmd,
      stdout: 'pipe',
      stderr: 'pipe',
      stdin: 'ignore',
      windowsHide: true,
    }) as {
      stdout: ReadableStream<Uint8Array> | null;
      exited: Promise<number>;
      kill: (signal?: string) => void;
    };
    const exitCode = await Promise.race([
      proc.exited,
      new Promise<number>((resolve) => {
        timer = setTimeout(() => resolve(-1), PICK_TIMEOUT_MS);
      }),
    ]);
    if (exitCode === -1) {
      // 超时，终止进程
      try { proc.kill(); } catch { /* ignore */ }
      return null;
    }
    // 读取 stdout（UTF-8；Windows 端已在脚本内设 OutputEncoding=UTF8）
    const stdoutBuf = Buffer.from(await new Response(proc.stdout).arrayBuffer());
    const stdout = stdoutBuf.toString('utf8').trim();
    // stdout 为空 = 用户取消（Windows BrowseForFolder 返回 null；osascript/zenity 退出码非0且无输出）
    if (!stdout) return null;
    // 校验路径确实存在（防御性）
    if (!isDirectorySafe(stdout)) return null;
    return stdout;
  } catch {
    // spawn 失败（如 zenity 未安装）或读取异常 → 返回 null，前端回退
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createPickDirectoryHandler(env: Environment): RouteHandler {
  return async (): Promise<HttpResponse> => {
    const path = await pickDirectoryNative(env);
    return { status: 200, body: { path } };
  };
}
