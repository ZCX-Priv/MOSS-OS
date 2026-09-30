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
import type { ConfigService, Environment, ServiceRegistry } from '../../../core/types';
import { ServiceNames } from '../../../core/types';
import { readdirSync, existsSync, statSync, openSync, readSync, closeSync, type Dirent } from 'node:fs';
import { isAbsolute, join, normalize, extname } from 'node:path';
import * as nfd from 'nativefiledialog-for-bun';
import { ErrorCode } from '../../../core/error-codes';
import { SYSTEM_SCOPE } from '../../filesys/roots';
import { decodeShellOutput } from '../../../utils/encoding';
import { parseRangeHeader, clampChunk } from './range';
import { RAW_MIME_MAP, MEDIA_EXTS, isTextualExt } from './preview-mime';
import type { FilesysService } from '../../filesys/types';

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
// GET /api/filesystem/search-files?dir=<绝对路径>&q=<关键字>
// # 文件提及菜单数据源：
// - q 为空 → 仅列 dir 第一层文件（readdir 单层，毫秒级；菜单打开即出）
// - q 非空 → 递归 BFS 模糊搜索文件名（大小写不敏感；SKIP_NAMES 跳过巨型/系统目录，
//   深度/节点数/时间三重上限防爆炸），上限 50 条
// - 模块级 TTL 缓存（30s / 100 条）：重复输入/重开菜单秒回
// ============================================================================

const SF_MAX_DEPTH = 6;
const SF_MAX_VISIT = 3000;
const SF_TIMEOUT_MS = 1500;
const SF_MAX_RESULTS = 50;
const SF_CACHE_TTL_MS = 30 * 1000;
const SF_CACHE_MAX = 100;

interface SearchedFile {
  path: string;
  name: string;
  dir: string;
  ext: string;
}

/** 结果缓存：key = `${dir}|${q}`（Map 保持插入序，超容量逐出最旧） */
const sfCache = new Map<string, { files: SearchedFile[]; at: number }>();

function sfCacheGet(key: string): SearchedFile[] | null {
  const hit = sfCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > SF_CACHE_TTL_MS) {
    sfCache.delete(key);
    return null;
  }
  return hit.files;
}

function sfCacheSet(key: string, files: SearchedFile[]): void {
  if (sfCache.size >= SF_CACHE_MAX) {
    // 逐出最旧（Map 首个 key）
    const oldest = sfCache.keys().next().value;
    if (oldest !== undefined) sfCache.delete(oldest);
  }
  sfCache.set(key, { files, at: Date.now() });
}

/** q 为空：浅层列 dir 第一层文件（按名称排序取前 50） */
function searchShallow(dir: string): SearchedFile[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: SearchedFile[] = entries
    .filter((e) => e.isFile() && !SKIP_NAMES.has(e.name.toLowerCase()))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .slice(0, SF_MAX_RESULTS)
    .map((e) => ({
      path: join(dir, e.name),
      name: e.name,
      dir,
      ext: extname(e.name).slice(1).toLowerCase(),
    }));
  return files;
}

/** q 非空：递归 BFS 模糊搜索 */
function searchRecursive(dir: string, q: string, isWin: boolean): SearchedFile[] {
  const files: SearchedFile[] = [];
  const queue: Array<{ dir: string; depth: number }> = [{ dir, depth: 0 }];
  const seen = new Set<string>([isWin ? dir.toLowerCase() : dir]);
  const start = Date.now();
  const timedOut = () => Date.now() - start > SF_TIMEOUT_MS;
  let visited = 0;

  while (queue.length > 0 && files.length < SF_MAX_RESULTS && visited < SF_MAX_VISIT && !timedOut()) {
    const { dir: cur, depth } = queue.shift()!;
    visited++;
    let entries: Dirent[];
    try {
      entries = readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (files.length >= SF_MAX_RESULTS || timedOut()) break;
      const full = join(cur, ent.name);
      if (ent.isFile()) {
        if (ent.name.toLowerCase().includes(q)) {
          files.push({
            path: full,
            name: ent.name,
            dir: cur,
            ext: extname(ent.name).slice(1).toLowerCase(),
          });
        }
      } else if (ent.isDirectory()) {
        const lower = ent.name.toLowerCase();
        if (SKIP_NAMES.has(lower)) continue;
        const key = isWin ? full.toLowerCase() : full;
        if (seen.has(key)) continue;
        seen.add(key);
        if (depth + 1 < SF_MAX_DEPTH) {
          queue.push({ dir: full, depth: depth + 1 });
        }
      }
    }
  }
  return files;
}

export function createSearchFilesHandler(_env: Environment): RouteHandler {
  return async (req: HttpRequest): Promise<HttpResponse> => {
    const dir = (req.query.dir ?? '').trim();
    const q = (req.query.q ?? '').trim().toLowerCase();
    if (!dir || !isDirectorySafe(dir)) {
      return { status: 200, body: { files: [] } };
    }

    // 缓存命中直接返回（提及菜单场景容忍秒级陈旧）
    const key = `${dir}|${q}`;
    const cached = sfCacheGet(key);
    if (cached) {
      return { status: 200, body: { files: cached } };
    }

    const files = q ? searchRecursive(dir, q, _env.isWindows) : searchShallow(dir);
    sfCacheSet(key, files);
    return { status: 200, body: { files } };
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

// ============================================================================
// POST /api/filesystem/pick-file
// 系统原生多文件选择对话框（nfd.openFiles），返回真实绝对路径 + stat 元数据。
// 附件"纯路径引用"方案的数据源：文件留在原位，消息仅引用路径，agent 用 filesys 工具读取。
// 自动授权：把每个选中文件的父目录合并进 config.filesys.roots（去重），保证 agent 可读。
// ============================================================================

interface PickedFile {
  path: string;
  name: string;
  size: number;
}

export function createPickFileHandler(
  env: Environment,
  config: ConfigService,
): RouteHandler {
  return async (): Promise<HttpResponse> => {
    let picked: string[] | null;
    try {
      // openFiles：用户取消返回 null，成功返回绝对路径数组，错误抛 NativeDialogError
      picked = await nfd.openFiles();
    } catch {
      return { status: 200, body: { files: [], error: ErrorCode.FS_PICK_FILE_FAILED } };
    }
    if (!picked || picked.length === 0) {
      return { status: 200, body: { files: [] } };
    }

    // stat 元数据 + 父目录收集
    const files: PickedFile[] = [];
    const parents = new Set<string>();
    for (const p of picked) {
      try {
        const st = statSync(p);
        if (!st.isFile()) continue;
        files.push({ path: p, name: basenameOf(p), size: st.size });
        parents.add(dirnameOf(p));
      } catch {
        // 文件消失/不可访问：跳过
      }
    }

    // 自动授权：父目录合并进 filesys roots（去重；已存在的跳过）
    const grantedRoots: string[] = [];
    if (parents.size > 0) {
      try {
        const cfg = config.getAppConfig();
        const existing: string[] = Array.isArray(cfg.filesys?.roots) ? cfg.filesys.roots : [];
        const known = new Set(existing.map((r) => (env.isWindows ? r.toLowerCase() : r)));
        const merged = [...existing];
        for (const parent of parents) {
          if (!isDirectorySafe(parent)) continue;
          const key = env.isWindows ? parent.toLowerCase() : parent;
          if (known.has(key)) continue;
          known.add(key);
          merged.push(normalize(parent));
          grantedRoots.push(parent);
        }
        if (grantedRoots.length > 0) {
          await config.updateAppConfig({ filesys: { roots: merged } } as never);
        }
      } catch {
        // 授权失败不阻断选择结果（agent 读取时由权限体系兜底提示）
      }
    }

    return { status: 200, body: { files, grantedRoots } };
  };
}

/** 路径 → 文件名（跨平台分隔符） */
function basenameOf(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

/** 路径 → 父目录（跨平台分隔符；无分隔符返回原路径） */
function dirnameOf(p: string): string {
  const idx = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
  return idx > 0 ? p.slice(0, idx) : p;
}

// ============================================================================
// filesys roots 管理（虚拟文件系统的授权目录边界）
// GET  /api/filesys/roots — 读取配置的额外授权目录 + 当前实际生效列表
// PUT  /api/filesys/roots — 设置额外授权目录（写回 config.filesys.roots，热生效）
// ============================================================================

/** GET /api/filesys/roots */
export function createGetRootsHandler(
  services: ServiceRegistry,
): RouteHandler {
  return async (): Promise<HttpResponse> => {
    const filesys = services.tryResolve<{ listRoots(): string[] }>(ServiceNames.FILESYS);
    return {
      status: 200,
      body: {
        effective: filesys ? filesys.listRoots() : [],
      },
    };
  };
}

/** PUT /api/filesys/roots — body: { roots: string[] }（绝对路径数组；cwd 始终隐含，无需包含） */
export function createUpdateRootsHandler(
  services: ServiceRegistry,
  config: ConfigService,
): RouteHandler {
  return async (req: HttpRequest): Promise<HttpResponse> => {
    const body = req.body as { roots?: unknown } | undefined;
    const raw = body?.roots;
    if (!Array.isArray(raw) || raw.some((r) => typeof r !== 'string')) {
      return { status: 400, body: { error: 'roots (string[]) is required' } };
    }
    // 校验：必须是绝对路径（存在的目录由 filesys.normalizeRoots 在生效时软过滤，这里只挡格式）
    const roots: string[] = [];
    for (const item of raw) {
      const p = String(item).trim();
      if (!p) continue;
      if (!isAbsolute(p)) {
        return { status: 400, body: { error: `root must be an absolute path: ${p}` } };
      }
      roots.push(normalize(p));
    }
    try {
      await config.updateAppConfig({ filesys: { roots } } as never);
      const filesys = services.tryResolve<{ listRoots(): string[] }>(ServiceNames.FILESYS);
      return { status: 200, body: { roots, effective: filesys ? filesys.listRoots() : [] } };
    } catch (err) {
      return {
        status: 500,
        body: { error: err instanceof Error ? err.message : String(err) },
      };
    }
  };
}

// ============================================================================
// GET /api/filesystem/raw?path=<绝对路径>&cwd=<可选，默认 SYSTEM_SCOPE>
// 只读返回文件二进制内容（WebUI 渲染模块预览 docx/pdf/图片/3D 模型等）。
// 走 filesys.resolve 权限体系（与 read 工具同一套边界：roots 越权 / .moss 硬屏蔽 → 403）；
// 扩展名白名单（未知名 415）防止退化为任意文件下载器；支持 HTTP Range（206）流式读取。
// ============================================================================

// 预览扩展名白名单 / MIME / 文本类扩展名 / 媒体扩展名：单一真源见 ./preview-mime.ts
// （该模块为纯模块，便于一致性脚本直接校验「前端可预览扩展名 ⊆ 后端白名单」，防 415 回归）

/** 普通文件（raw）大小上限：100MB */
const RAW_MAX_BYTES = 100 * 1024 * 1024;

/** 单次 Range 响应最多返回的字节数（有界分块，防大文件整读入内存） */
const RAW_CHUNK_BYTES = 8 * 1024 * 1024;

/** 媒体路由「无 Range 请求」时允许整块返回的上限；超过则只返回首块（206） */
const MEDIA_FULL_READ_LIMIT = 64 * 1024 * 1024;

/** 媒体文件（media 路由）大小上限：2GB */
const MEDIA_MAX_BYTES = 2 * 1024 * 1024 * 1024;

/** 文本预览单次最多读取的字节数（防止超大文本文件整读进内存） */
const TEXT_READ_MAX_BYTES = 8 * 1024 * 1024;

/**
 * 读取文件头部至多 maxBytes 字节（用于文本预览的 bounded 读取）。
 */
function readHead(absPath: string, maxBytes: number): Buffer {
  const st = statSync(absPath);
  const len = Math.min(st.size, maxBytes);
  const buf = Buffer.alloc(len);
  if (len === 0) return buf;
  const fd = openSync(absPath, 'r');
  try {
    readSync(fd, buf, 0, len, 0);
  } finally {
    closeSync(fd);
  }
  return buf;
}

/** 校验媒体路由的 query token（与 security.authToken 比对；未配置 token 时放行） */
function checkMediaToken(config: ConfigService, req: HttpRequest): boolean {
  const cfg = config.getAppConfig();
  if (!cfg.security.authToken) return true;
  return req.query.token === cfg.security.authToken;
}

/** stat 文件（不存在 / 非常规文件返回 null，避免 statSync 抛错变成 500） */
function statFileSafe(absPath: string): { size: number } | null {
  try {
    const st = statSync(absPath);
    return st.isFile() ? { size: st.size } : null;
  } catch {
    return null;
  }
}

/**
 * 按区间读取文件（端点含），返回字节。
 * 有界：内存占用 = 区间长度（调用方先用 clampChunk 夹紧区间）。
 */
function readByteRange(absPath: string, start: number, end: number): Uint8Array {
  const length = end - start + 1;
  if (length <= 0) return new Uint8Array(0);
  const buf = Buffer.alloc(length);
  const fd = openSync(absPath, 'r');
  try {
    let offset = 0;
    while (offset < length) {
      const read = readSync(fd, buf, offset, length - offset, start + offset);
      if (read <= 0) break;
      offset += read;
    }
    return new Uint8Array(buf.subarray(0, offset));
  } finally {
    closeSync(fd);
  }
}

export function createReadFileHandler(services: ServiceRegistry): RouteHandler {
  return async (req: HttpRequest): Promise<HttpResponse> => {
    const rawPath = (req.query.path ?? '').trim();
    if (!rawPath) {
      return { status: 400, body: { error: 'path is required' } };
    }
    const cwd = (req.query.cwd ?? '').trim() || SYSTEM_SCOPE;

    const filesys = services.tryResolve<FilesysService>(ServiceNames.FILESYS);
    if (!filesys) {
      return { status: 503, body: { error: 'filesys service unavailable' } };
    }

    const absPath = filesys.resolve(rawPath, cwd);
    if (!absPath) {
      return { status: 403, body: { error: 'Access denied: path outside allowed roots or blocked' } };
    }

    const ext = extname(absPath).slice(1).toLowerCase();
    const mime = RAW_MIME_MAP[ext];
    if (!mime) {
      return { status: 415, body: { error: `Unsupported preview type: .${ext || '(none)'}` } };
    }

    const st = statFileSafe(absPath);
    if (!st) {
      return { status: 404, body: { error: 'File not found (or not a regular file)' } };
    }
    if (st.size > RAW_MAX_BYTES) {
      return { status: 413, body: { error: `File too large for preview (limit ${RAW_MAX_BYTES} bytes)` } };
    }

    // HTTP Range：只读所需区间（206，有界分块）。<video>/<audio> 直链由 /api/filesystem/media 提供，
    // 此处 Range 主要服务前端「带头 fetch 的 blob/PDF」与通用客户端。
    const range = parseRangeHeader(req.headers['range'], st.size);
    if (range) {
      const chunk = clampChunk(range, RAW_CHUNK_BYTES);
      return {
        status: 206,
        headers: {
          'Content-Type': mime,
          'Content-Range': `bytes ${chunk.start}-${chunk.end}/${st.size}`,
          'Content-Length': String(chunk.end - chunk.start + 1),
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-store',
        },
        body: readByteRange(absPath, chunk.start, chunk.end),
      };
    }

    // 无 Range：整块返回（≤ RAW_MAX_BYTES，走 filesys 读取缓存）
    const result = filesys.readFile(absPath);
    if (!result) {
      return { status: 404, body: { error: 'File not found (or not a regular file)' } };
    }
    return {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Content-Length': String(result.size),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
      },
      body: new Uint8Array(result.rawBuffer),
    };
  };
}

// ============================================================================
// GET /api/filesystem/media?path=<绝对路径>&token=<authToken>
// 视频/音频直链：浏览器 <video>/<audio> 无法携带 Authorization 头，故鉴权改走 query token。
// 支持 HTTP Range（206，有界分块）播放与拖动进度；大小上限 2GB。
// 仅允许视频/音频扩展名（防退化为任意文件下载器）。
// ============================================================================

export function createMediaHandler(services: ServiceRegistry, config: ConfigService): RouteHandler {
  return async (req: HttpRequest): Promise<HttpResponse> => {
    // query token 鉴权（未配置 token 时放行）
    if (!checkMediaToken(config, req)) {
      return { status: 401, body: { error: 'Unauthorized' } };
    }

    const rawPath = (req.query.path ?? '').trim();
    if (!rawPath) {
      return { status: 400, body: { error: 'path is required' } };
    }
    const cwd = (req.query.cwd ?? '').trim() || SYSTEM_SCOPE;

    const filesys = services.tryResolve<FilesysService>(ServiceNames.FILESYS);
    if (!filesys) {
      return { status: 503, body: { error: 'filesys service unavailable' } };
    }

    const absPath = filesys.resolve(rawPath, cwd);
    if (!absPath) {
      return { status: 403, body: { error: 'Access denied: path outside allowed roots or blocked' } };
    }

    const ext = extname(absPath).slice(1).toLowerCase();
    const mime = RAW_MIME_MAP[ext];
    if (!mime || !MEDIA_EXTS.has(ext)) {
      return { status: 415, body: { error: `Unsupported media type: .${ext || '(none)'}` } };
    }

    const st = statFileSafe(absPath);
    if (!st) {
      return { status: 404, body: { error: 'File not found (or not a regular file)' } };
    }
    if (st.size > MEDIA_MAX_BYTES) {
      return { status: 413, body: { error: `Media too large (limit ${MEDIA_MAX_BYTES} bytes)` } };
    }

    const range = parseRangeHeader(req.headers['range'], st.size);
    if (range) {
      const chunk = clampChunk(range, RAW_CHUNK_BYTES);
      return {
        status: 206,
        headers: {
          'Content-Type': mime,
          'Content-Range': `bytes ${chunk.start}-${chunk.end}/${st.size}`,
          'Content-Length': String(chunk.end - chunk.start + 1),
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-store',
        },
        body: readByteRange(absPath, chunk.start, chunk.end),
      };
    }

    // 无 Range（裸 GET 下载；浏览器 <video>/<audio> 必然先发 Range）：
    // ≤ MEDIA_FULL_READ_LIMIT 整块返回；超过则只返回首块（206），保证内存有界。
    if (st.size <= MEDIA_FULL_READ_LIMIT) {
      return {
        status: 200,
        headers: {
          'Content-Type': mime,
          'Content-Length': String(st.size),
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-store',
        },
        body: readByteRange(absPath, 0, Math.max(0, st.size - 1)),
      };
    }
    const firstChunk = clampChunk({ start: 0, end: st.size - 1 }, RAW_CHUNK_BYTES);
    return {
      status: 206,
      headers: {
        'Content-Type': mime,
        'Content-Range': `bytes ${firstChunk.start}-${firstChunk.end}/${st.size}`,
        'Content-Length': String(firstChunk.end - firstChunk.start + 1),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
      },
      body: readByteRange(absPath, firstChunk.start, firstChunk.end),
    };
  };
}

// ============================================================================
// GET /api/filesystem/text?path=<绝对路径>&maxChars=<可选，默认 200000>
// 通用文本提取（后端）：Office/OpenDocument/电子书等「无前端渲染方案」格式的文本回退。
// 复用 read 工具的 handlers（mammoth / word-extractor / xlsx / officeparser / ebook）。
// 返回 { text, truncated }；越权/失败返回错误码。
// ============================================================================

export function createTextExtractHandler(services: ServiceRegistry): RouteHandler {
  return async (req: HttpRequest): Promise<HttpResponse> => {
    const rawPath = (req.query.path ?? '').trim();
    if (!rawPath) {
      return { status: 400, body: { error: 'path is required' } };
    }
    const cwd = (req.query.cwd ?? '').trim() || SYSTEM_SCOPE;
    const maxChars = Number(req.query.maxChars ?? 200_000);

    const filesys = services.tryResolve<FilesysService>(ServiceNames.FILESYS);
    if (!filesys) {
      return { status: 503, body: { error: 'filesys service unavailable' } };
    }

    const absPath = filesys.resolve(rawPath, cwd);
    if (!absPath) {
      return { status: 403, body: { error: 'Access denied: path outside allowed roots or blocked' } };
    }

    // 仅接受已知预览类型（防止把任意文件当文本读）
    const ext = extname(absPath).slice(1).toLowerCase();
    if (!(ext in RAW_MIME_MAP)) {
      return { status: 415, body: { error: `Unsupported text extraction type: .${ext || '(none)'}` } };
    }

    // 纯文本类：bounded 头部读取 + 编码检测（UTF-8 / GBK）
    if (isTextualExt(ext)) {
      const st = statFileSafe(absPath);
      if (!st) {
        return { status: 404, body: { error: 'File not found (or not a regular file)' } };
      }
      const headBuf = readHead(absPath, TEXT_READ_MAX_BYTES);
      // 含 NUL 字节 → 实为二进制，拒绝（避免展示乱码）
      if (headBuf.includes(0)) {
        return { status: 415, body: { error: `Not a text file: .${ext}` } };
      }
      let text = decodeShellOutput(headBuf);
      let truncated = st.size > TEXT_READ_MAX_BYTES;
      if (text.length > maxChars) {
        text = text.slice(0, maxChars);
        truncated = true;
      }
      return { status: 200, body: { text, truncated } };
    }

    // Office/电子书：复用 read 工具 handlers（懒加载）
    try {
      const { readOffice } = await import('../../tools/read/handlers/office');
      const { readEbook } = await import('../../tools/read/handlers/ebook');
      let result;
      const officeExts = new Set([
        'docx', 'docm', 'dotx', 'doc', 'dot', 'xlsx', 'xlsm', 'xltx', 'xltm', 'xls', 'xlt',
        'pptx', 'pptm', 'potx', 'ppsx', 'ppt', 'pot', 'odt', 'ods', 'odp', 'ott', 'ots', 'otp', 'rtf',
      ]);
      const ebookExts = new Set(['epub', 'opf', 'mobi', 'azw3', 'azw', 'fb2']);
      if (officeExts.has(ext)) {
        result = await readOffice(absPath);
      } else if (ebookExts.has(ext)) {
        result = await readEbook(absPath);
      } else {
        return { status: 415, body: { error: `Unsupported text extraction type: .${ext}` } };
      }

      const parts = (result.content ?? [])
        .filter((c) => c.type === 'text')
        .map((c) => c.text ?? '');
      let text = parts.join('\n').replace(/^Error: /, '').trim();
      // handler 正常结果首行为「<绝对路径> (EXT)」文件头；仅在该形态下剥离，
      // 避免把「单行错误提示」的唯一一行也剥掉（如 mobi 不支持转换提示）。
      const firstLine = text.split('\n')[0] ?? '';
      if (firstLine.startsWith(absPath)) {
        text = text.slice(firstLine.length).trim();
      }
      const truncated = text.length > maxChars;
      if (truncated) text = text.slice(0, maxChars);
      return { status: 200, body: { text, truncated } };
    } catch (err) {
      return {
        status: 500,
        body: { error: err instanceof Error ? err.message : String(err) },
      };
    }
  };
}