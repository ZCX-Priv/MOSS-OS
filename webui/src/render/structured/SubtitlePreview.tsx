// render/structured/SubtitlePreview.tsx
// 结构化文本预览：字幕 / 歌词（srt / vtt / ass / ssa / lrc）。
// 按扩展名分派解析，统一为时间轴 cue 列表 → 表格展示。
// 解析异常仅降级为空态，绝不抛错影响父组件。
// 本组件经 React.lazy 懒加载（FilePreviewPane 分发）。

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText } from 'lucide-react';

/** 超大文本截断阈值，避免解析卡顿 */
const MAX_TEXT_LENGTH = 2 * 1024 * 1024;
/** 最大 cue 条数上限 */
const MAX_CUES = 5000;

/** 统一的时间轴字幕行 */
interface SubtitleCue {
  start: string;
  end: string;
  text: string;
}

export interface SubtitlePreviewProps {
  text: string;
  ext: string;
}

/** 归一化换行并按行切分 */
function splitLines(src: string): string[] {
  return src.replace(/\r\n?/g, '\n').split('\n');
}

/** SRT：块由空行分隔，序号行 + 时间行 + 其后文本（可多行） */
function parseSrt(src: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const blocks = src.replace(/\r\n?/g, '\n').split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trimEnd());
    const meaningful = lines.filter((l) => l.trim() !== '');
    if (meaningful.length < 2) continue;
    let cursor = 0;
    if (/^\d+$/.test(meaningful[0].trim())) cursor = 1;
    const timeLine = meaningful[cursor];
    if (!timeLine.includes('-->')) continue;
    const parts = timeLine.split('-->');
    const start = parts[0].trim();
    const end = parts[1].trim().split(/\s+/)[0];
    const text = meaningful.slice(cursor + 1).join('\n').trim();
    cues.push({ start, end, text });
    if (cues.length >= MAX_CUES) break;
  }
  return cues;
}

/** VTT：跳过 WEBVTT 头与 NOTE / STYLE / REGION 块；cue 行含 --> */
function parseVtt(src: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const lines = splitLines(src);
  let i = 0;
  if (lines[0] !== undefined && lines[0].startsWith('WEBVTT')) i = 1;
  // 跳过头部元信息直到首个空行
  while (i < lines.length && lines[i].trim() !== '') i++;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (line === '') {
      i++;
      continue;
    }
    if (line.startsWith('NOTE') || line === 'STYLE' || line === 'REGION') {
      i++;
      while (i < lines.length && lines[i].trim() !== '') i++;
      continue;
    }
    if (!line.includes('-->')) {
      // 可能是 cue 标识行，跳过
      i++;
      continue;
    }
    const parts = line.split('-->');
    const start = parts[0].trim();
    const end = parts[1].trim().split(/\s+/)[0];
    const textLines: string[] = [];
    let j = i + 1;
    while (j < lines.length && lines[j].trim() !== '') {
      textLines.push(lines[j]);
      j++;
    }
    cues.push({ start, end, text: textLines.join('\n').trim() });
    i = j;
    if (cues.length >= MAX_CUES) break;
  }
  return cues;
}

/** ASS/SSA：进入 [Events] 段，读 Format 得到列顺序，再逐行取 Dialogue */
function parseAss(src: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const lines = splitLines(src);
  let inEvents = false;
  let format: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('[')) {
      inEvents = /^\[events\]$/i.test(line);
      continue;
    }
    if (!inEvents) continue;
    if (/^format\s*:/i.test(line)) {
      format = line
        .slice(line.indexOf(':') + 1)
        .split(',')
        .map((s) => s.trim().toLowerCase());
      continue;
    }
    if (!/^dialogue\s*:/i.test(line)) continue;
    const body = line.slice(line.indexOf(':') + 1);
    const parts = body.split(',');
    const si = format.indexOf('start');
    const ei = format.indexOf('end');
    const ti = format.indexOf('text');
    const start = (si >= 0 ? parts[si] : parts[1])?.trim() ?? '';
    const end = (ei >= 0 ? parts[ei] : parts[2])?.trim() ?? '';
    const textRaw = ti >= 0 ? parts.slice(ti).join(',') : parts.slice(9).join(',');
    const text = textRaw
      .replace(/\{[^}]*\}/g, '')
      .replace(/\\[Nn]/g, '\n')
      .replace(/\\h/g, ' ')
      .trim();
    cues.push({ start, end, text });
    if (cues.length >= MAX_CUES) break;
  }
  return cues;
}

/** LRC：`[mm:ss.xx]歌词`，可一行多时间戳；忽略元信息标签 */
function parseLrc(src: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const lines = splitLines(src);
  const timeRe = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
  for (const raw of lines) {
    const line = raw.trim();
    if (line === '') continue;
    timeRe.lastIndex = 0;
    const times: string[] = [];
    let lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = timeRe.exec(line)) !== null) {
      const mm = m[1].padStart(2, '0');
      const ss = m[2];
      const frac = m[3].padEnd(2, '0').slice(0, 2);
      times.push(`${mm}:${ss}.${frac}`);
      lastIndex = m.index + m[0].length;
    }
    if (times.length === 0) continue;
    const content = line.slice(lastIndex).trim();
    for (const start of times) {
      cues.push({ start, end: '', text: content });
      if (cues.length >= MAX_CUES) break;
    }
    if (cues.length >= MAX_CUES) break;
  }
  return cues;
}

export function SubtitlePreview({ text, ext }: SubtitlePreviewProps) {
  const { t } = useTranslation();

  const cues = useMemo<SubtitleCue[]>(() => {
    try {
      const src = text.length > MAX_TEXT_LENGTH ? text.slice(0, MAX_TEXT_LENGTH) : text;
      const e = ext.toLowerCase().replace(/^\./, '');
      if (e === 'vtt') return parseVtt(src);
      if (e === 'ass' || e === 'ssa') return parseAss(src);
      if (e === 'lrc') return parseLrc(src);
      return parseSrt(src);
    } catch {
      return [];
    }
  }, [text, ext]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex shrink-0 items-center gap-1.5 px-1 text-xs text-muted-foreground">
        <FileText className="size-3.5" />
        <span className="text-foreground">{t('preview.subtitleTitle')}</span>
        <span className="tabular-nums">{t('preview.subtitleLines', { count: cues.length })}</span>
      </div>

      {cues.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center rounded border border-border bg-muted/20 px-4 text-sm text-muted-foreground">
          {t('preview.subtitleEmpty')}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded border border-border">
          <table className="data-table w-full border-collapse text-xs">
            <thead className="sticky top-0 bg-muted">
              <tr>
                <th className="border-b border-r border-border/60 px-2 py-1 text-left font-medium text-foreground">#</th>
                <th className="border-b border-r border-border/60 px-2 py-1 text-left font-medium text-foreground">
                  {t('preview.subtitleStart')}
                </th>
                <th className="border-b border-r border-border/60 px-2 py-1 text-left font-medium text-foreground">
                  {t('preview.subtitleEnd')}
                </th>
                <th className="border-b border-border/60 px-2 py-1 text-left font-medium text-foreground">
                  {t('preview.subtitleText')}
                </th>
              </tr>
            </thead>
            <tbody>
              {cues.map((cue, index) => (
                <tr key={index} className="border-b border-border/60 align-top">
                  <td className="border-r border-border/60 px-2 py-1 tabular-nums text-muted-foreground">{index + 1}</td>
                  <td className="whitespace-nowrap border-r border-border/60 px-2 py-1 tabular-nums text-foreground">{cue.start}</td>
                  <td className="whitespace-nowrap border-r border-border/60 px-2 py-1 tabular-nums text-foreground">{cue.end}</td>
                  <td className="whitespace-pre-wrap px-2 py-1 text-foreground">{cue.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}