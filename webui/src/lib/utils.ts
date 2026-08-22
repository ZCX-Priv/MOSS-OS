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

/** 附件类型分类 */
export type AttachmentKind = 'image' | 'video' | 'audio' | 'other'

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'])
const VIDEO_EXTS = new Set(['mp4', 'mov', 'webm', 'avi', 'mkv', 'flv', 'wmv', 'm4v'])
const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'wma', 'opus'])

/**
 * 判断附件类型：扩展名集合优先（Windows 上 File.type 可能为空），MIME 前缀兜底。
 */
export function getAttachmentKind(fileName: string, mime: string): AttachmentKind {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (VIDEO_EXTS.has(ext)) return 'video'
  if (AUDIO_EXTS.has(ext)) return 'audio'
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  return 'other'
}

/** 格式化文件大小：B/KB/MB/GB，一位小数（如 12.2 KB） */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const units = ['KB', 'MB', 'GB', 'TB'] as const
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(1)} ${units[unit]}`
}
