import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * 从工作目录解析文件夹显示名/分组名：取路径最后一段（D:\test → test）。
 * '__system__' 哨兵或空值（本机模式）返回 null，由调用方使用 i18n 的"本机"名称。
 */
export function resolveWorkingDirectoryName(wd: string): string | null {
  if (!wd || wd === "__system__") return null
  return wd.split(/[\\/]/).filter(Boolean).pop() ?? null
}
