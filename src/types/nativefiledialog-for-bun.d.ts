// src/types/nativefiledialog-for-bun.d.ts
// nativefiledialog-for-bun@0.3.2 的 package.json 声明 types 为 dist/index.d.ts，
// 但实际类型文件位于 dist/src/index.d.ts（发布时 types 路径配错）。
// 此处补全 ambient 模块声明，避免 tsc 找不到类型。
// 类型签名依据包内 dist/src/index.d.ts 与 dist/src/types.d.ts，parentWindow 用 number|bigint 替代 any。

declare module 'nativefiledialog-for-bun' {
  export interface FileFilter {
    name: string;
    extensions: string[];
  }

  export interface DialogOptions {
    title?: string;
    defaultPath?: string;
    filters?: FileFilter[];
    parentWindow?: number | bigint;
  }

  export interface OpenFileDialogOptions extends DialogOptions {
    allowMultiple?: boolean;
  }

  export interface SaveFileDialogOptions extends DialogOptions {
    confirmOverwrite?: boolean;
    defaultName?: string;
  }

  export class NativeDialogError extends Error {}
  export class UserCancelledError extends NativeDialogError {}
  export class PlatformNotSupportedError extends NativeDialogError {}
  export class MissingDependencyError extends NativeDialogError {}

  /** 获取当前使用的后端名称：'ffi' | 'windows' | 'macos' | 'linux' */
  export function getBackendName(): string;
  /** 显式设置原生库（DLL/dylib/so）的查找目录，须在首次对话框调用前执行 */
  export function setLibraryPath(path: string): void;
  export function openFile(options?: OpenFileDialogOptions): Promise<string | null>;
  export function openFiles(options?: OpenFileDialogOptions): Promise<string[] | null>;
  export function pickFolder(options?: DialogOptions): Promise<string | null>;
  export function pickFolders(options?: DialogOptions): Promise<string[] | null>;
  export function saveFile(options?: SaveFileDialogOptions): Promise<string | null>;
}
