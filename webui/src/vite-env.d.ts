/// <reference types="vite/client" />

// export {} 使本文件成为模块，从而下面的 declare module 'react' 是模块增强
// 而非覆盖整个 React 类型定义。
export {};

declare module 'react' {
  interface InputHTMLAttributes<T> extends HTMLAttributes<T> {
    webkitdirectory?: string;
    directory?: string;
  }
}

declare global {
  interface Window {
    showDirectoryPicker?: (options?: {
      id?: string;
      mode?: 'read' | 'readwrite';
    }) => Promise<FileSystemDirectoryHandle>;
  }
}
