// webui/src/components/shared/MentionTokenIcon.tsx
// 内联 token 的图标唯一真源（编辑器 chip 经 portal 挂载、消息气泡 chip 直接渲染，共用本组件）。
// 复用既有资产，不自建图标：
//   - 文件：附件卡片同一套检测与图标 —— getAttachmentKind 判图片 → useFileThumbnail 缩略图，
//           否则 FileTypeIcon（react-material-icon-theme，深色模式自动切 _light 变体）
//   - 命令/技能：resolveSkillIcon（与 / 菜单同一白名单与回退规则）
//   - 智能体：Bot（与 @ 菜单一致）
// 不读 store：名单由 props 注入，避免与 MentionTokens/编辑器互相 import 形成循环。

import { Bot } from 'lucide-react';
import { getAttachmentKind } from '@/lib/utils';
import { resolveSkillIcon } from '@/lib/skill-icons';
import { fileNameOf } from '../../render/file/detector';
import { FileTypeIcon, useFileThumbnail } from './FileTypeIcon';
import { findCommandIcon, type ComposerToken, type MentionLookups } from './mention-data';

export interface MentionTokenIconProps {
  token: ComposerToken;
  lookups: MentionLookups;
  /** 图标边长（px），默认 13 */
  size?: number;
}

export function MentionTokenIcon({ token, lookups, size = 13 }: MentionTokenIconProps) {
  if (token.kind === 'agent') {
    return <Bot size={size} className="shrink-0" />;
  }

  if (token.kind === 'command') {
    const Icon = resolveSkillIcon(findCommandIcon(lookups, token.source, token.name));
    return <Icon size={size} className="shrink-0" />;
  }

  // 文件：与附件卡片同策略（图片出缩略图，加载中/失败回退类型图标）
  const name = fileNameOf(token.path);
  const isImage = getAttachmentKind(name, '') === 'image';
  const thumb = useFileThumbnail(token.path, isImage);
  if (isImage && thumb) {
    return <img src={thumb} alt={name} className="size-full object-cover" />;
  }
  return <FileTypeIcon fileName={name} size={size} />;
}