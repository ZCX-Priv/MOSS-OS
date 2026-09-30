// webui/src/components/shared/MentionTokens.tsx
// 消息气泡里 token 的只读内联渲染（/ 命令、@ 智能体、# 文件引用）。
// 解析口径与编辑器完全一致：mention-data.parseMentionText + store 已知名单。
// file token 显示「最小区分标签」（与输入框同规则），悬浮显示绝对路径，点击打开预览。

import { useMemo } from 'react';
import { useStore } from '../../store';
import { fileNameOf } from '../../render/file/detector';
import { MentionTokenIcon } from './MentionTokenIcon';
import {
  buildMentionLookups,
  chipVariant,
  computeFileLabels,
  parseMentionText,
  type ComposerToken,
  type MentionLookups,
} from './mention-data';

interface MentionTokenTextProps {
  /** 线格式文本（用户消息正文，已剥离附件块） */
  text: string;
  /** 点击 file token（传绝对路径） */
  onOpenFile: (path: string) => void;
}

/** store 名单（气泡渲染 / 标题与队列预览剥离共用一处口径） */
export function useMentionLookups(): MentionLookups {
  const commands = useStore((s) => s.commands);
  const skills = useStore((s) => s.skills);
  const agents = useStore((s) => s.agents);
  return useMemo(() => buildMentionLookups(commands, skills, agents), [commands, skills, agents]);
}

/** 内联渲染一段含 token 的文本 */
export function MentionTokenText({ text, onOpenFile }: MentionTokenTextProps) {
  const lookups = useMentionLookups();

  const segments = useMemo(() => parseMentionText(text, lookups), [text, lookups]);

  const labels = useMemo(() => {
    const paths: string[] = [];
    segments.forEach((seg) => {
      if (seg.type === 'token' && seg.token.kind === 'file') paths.push(seg.token.path);
    });
    return computeFileLabels(paths);
  }, [segments]);

  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === 'text') return <span key={i}>{seg.text}</span>;
        const token: ComposerToken = seg.token;
        const icon = (
          <span className="mchip-icon">
            <MentionTokenIcon token={token} lookups={lookups} />
          </span>
        );
        if (token.kind === 'file') {
          const label = labels.get(token.path) ?? fileNameOf(token.path);
          return (
            <button
              key={i}
              type="button"
              onClick={() => onOpenFile(token.path)}
              title={token.path}
              className="mchip-inline mchip-inline--file"
            >
              {icon}
              <span className="max-w-[16rem] truncate">{label}</span>
            </button>
          );
        }
        if (token.kind === 'agent') {
          return (
            <span key={i} className={`mchip-inline mchip-inline--${chipVariant(token)}`}>
              {icon}
              {token.name}
            </span>
          );
        }
        // command / skill：视觉变体区分（skill 蓝、command 紫），与编辑器 chip 同规则
        return (
          <span key={i} className={`mchip-inline mchip-inline--${chipVariant(token)}`}>
            {icon}
            {token.name}
          </span>
        );
      })}
    </>
  );
}