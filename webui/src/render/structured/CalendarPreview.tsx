// render/structured/CalendarPreview.tsx
// 结构化文本预览：iCalendar（.ics）日程。
// 处理 RFC5545 折叠行，提取 VEVENT 属性并以卡片列表展示。
// 解析异常仅降级为空态，绝不抛错影响父组件。
// 本组件经 React.lazy 懒加载（FilePreviewPane 分发）。

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar } from 'lucide-react';

/** 超大文本截断阈值 */
const MAX_TEXT_LENGTH = 2 * 1024 * 1024;
/** 最大事件数上限 */
const MAX_EVENTS = 500;

interface CalendarEvent {
  summary: string;
  start: string;
  end: string;
  location: string;
  description: string;
  rrule: string;
}

export interface CalendarPreviewProps {
  text: string;
}

/** RFC5545 行折叠：以空格或制表符开头的续行接到上一行末尾 */
function unfold(src: string): string[] {
  const raw = src.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

/** 拆分属性行，剥离 `;参数`，取冒号后的值（参数值引号内的冒号不误判） */
function splitProperty(line: string): { name: string; value: string } | null {
  let colon = -1;
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuote = !inQuote;
    else if (ch === ':' && !inQuote) {
      colon = i;
      break;
    }
  }
  if (colon < 0) return null;
  const left = line.slice(0, colon);
  const value = line.slice(colon + 1).trim();
  const name = left.split(';')[0].toUpperCase();
  return { name, value };
}

/** 还原 ICS 文本转义 */
function unescapeIcs(value: string): string {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

/** 格式化 ICS 时间：`20240101T120000Z` → `2024-01-01 12:00 UTC`；无法解析则原样返回 */
function formatIcsDateTime(value: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value);
  if (m === null) return value;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  if (m[4] === undefined) return date;
  const time = `${m[4]}:${m[5]}${m[6] !== undefined ? `:${m[6]}` : ''}`;
  return `${date} ${time}${m[7] === 'Z' ? ' UTC' : ''}`;
}

function parseIcs(src: string): CalendarEvent[] {
  const lines = unfold(src);
  const events: CalendarEvent[] = [];
  let current: Partial<CalendarEvent> | null = null;
  let inEvent = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^BEGIN:VEVENT$/i.test(trimmed)) {
      inEvent = true;
      current = {};
      continue;
    }
    if (/^END:VEVENT$/i.test(trimmed)) {
      if (current !== null) {
        events.push({
          summary: current.summary ?? '',
          start: current.start ?? '',
          end: current.end ?? '',
          location: current.location ?? '',
          description: current.description ?? '',
          rrule: current.rrule ?? '',
        });
      }
      inEvent = false;
      current = null;
      if (events.length >= MAX_EVENTS) break;
      continue;
    }
    if (!inEvent || current === null) continue;
    const prop = splitProperty(line);
    if (prop === null) continue;
    switch (prop.name) {
      case 'SUMMARY':
        current.summary = unescapeIcs(prop.value);
        break;
      case 'DTSTART':
        current.start = formatIcsDateTime(prop.value);
        break;
      case 'DTEND':
        current.end = formatIcsDateTime(prop.value);
        break;
      case 'LOCATION':
        current.location = unescapeIcs(prop.value);
        break;
      case 'DESCRIPTION':
        current.description = unescapeIcs(prop.value);
        break;
      case 'RRULE':
        current.rrule = prop.value;
        break;
      default:
        break;
    }
  }
  return events;
}

export function CalendarPreview({ text }: CalendarPreviewProps) {
  const { t } = useTranslation();

  const events = useMemo<CalendarEvent[]>(() => {
    try {
      const src = text.length > MAX_TEXT_LENGTH ? text.slice(0, MAX_TEXT_LENGTH) : text;
      return parseIcs(src);
    } catch {
      return [];
    }
  }, [text]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex shrink-0 items-center gap-1.5 px-1 text-xs text-muted-foreground">
        <Calendar className="size-3.5" />
        <span className="text-foreground">{t('preview.calendarTitle')}</span>
        <span className="tabular-nums">{t('preview.calendarCount', { count: events.length })}</span>
      </div>

      {events.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center rounded border border-border bg-muted/20 px-4 text-sm text-muted-foreground">
          {t('preview.calendarEmpty')}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto pr-1">
          <div className="flex flex-col gap-2">
            {events.map((event, index) => (
              <div key={index} className="rounded border border-border bg-muted/20 p-3">
                <div className="text-sm font-semibold text-foreground">
                  {event.summary !== '' ? event.summary : t('preview.calendarSummary')}
                </div>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  {event.start !== '' && (
                    <>
                      <dt className="text-muted-foreground">{t('preview.calendarStart')}</dt>
                      <dd className="tabular-nums text-foreground">{event.start}</dd>
                    </>
                  )}
                  {event.end !== '' && (
                    <>
                      <dt className="text-muted-foreground">{t('preview.calendarEnd')}</dt>
                      <dd className="tabular-nums text-foreground">{event.end}</dd>
                    </>
                  )}
                  {event.location !== '' && (
                    <>
                      <dt className="text-muted-foreground">{t('preview.calendarLocation')}</dt>
                      <dd className="text-foreground">{event.location}</dd>
                    </>
                  )}
                  {event.description !== '' && (
                    <>
                      <dt className="text-muted-foreground">{t('preview.calendarDescription')}</dt>
                      <dd className="whitespace-pre-wrap text-foreground">{event.description}</dd>
                    </>
                  )}
                  {event.rrule !== '' && (
                    <>
                      <dt className="text-muted-foreground">RRULE</dt>
                      <dd className="break-all font-mono text-foreground">{event.rrule}</dd>
                    </>
                  )}
                </dl>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}