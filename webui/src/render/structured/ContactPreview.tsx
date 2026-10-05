// render/structured/ContactPreview.tsx
// 结构化文本预览：vCard（.vcf）联系人。
// 处理折叠行，按 BEGIN/END:VCARD 分组为多个联系人卡片。
// 解析异常仅降级为空态，绝不抛错影响父组件。
// 本组件经 React.lazy 懒加载（FilePreviewPane 分发）。

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Users } from 'lucide-react';

/** 超大文本截断阈值 */
const MAX_TEXT_LENGTH = 2 * 1024 * 1024;
/** 最大联系人数上限 */
const MAX_CONTACTS = 500;

interface ContactCard {
  name: string;
  org: string;
  title: string;
  tels: string[];
  emails: string[];
  address: string;
  note: string;
}

export interface ContactPreviewProps {
  text: string;
}

/** 处理 vCard 折叠行（续行以空格或制表符开头） */
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

/** 还原 vCard 文本转义 */
function unescapeVcf(value: string): string {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

/** 拆分属性行，保留参数段（如 `TEL;CELL:...`） */
function splitProperty(line: string): { name: string; params: string; value: string } | null {
  const colon = line.indexOf(':');
  if (colon < 0) return null;
  const left = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const semi = left.indexOf(';');
  const name = (semi >= 0 ? left.slice(0, semi) : left).trim().toUpperCase();
  const params = semi >= 0 ? left.slice(semi + 1) : '';
  return { name, params, value };
}

/** N 属性（Family;Given;...）兜底重排为「姓 名」 */
function nameFromN(raw: string): string {
  const parts = raw.split(';');
  const family = (parts[0] ?? '').trim();
  const given = (parts[1] ?? '').trim();
  return [family, given].filter((s) => s !== '').join(' ').trim();
}

/** ADR 分段：逐段反转义后拼接非空段 */
function addressFromAdr(raw: string): string {
  return raw
    .split(';')
    .map((seg) => unescapeVcf(seg).trim())
    .filter((seg) => seg !== '')
    .join(', ');
}

function parseVcards(src: string): ContactCard[] {
  const lines = unfold(src);
  const contacts: ContactCard[] = [];
  let inCard = false;
  let current: ContactCard | null = null;
  let fn = '';
  let n = '';

  const flush = (): void => {
    if (current === null) return;
    const display = fn.trim() !== '' ? unescapeVcf(fn).trim() : nameFromN(n);
    contacts.push({ ...current, name: display });
    if (contacts.length >= MAX_CONTACTS) return;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^BEGIN:VCARD$/i.test(trimmed)) {
      inCard = true;
      current = { name: '', org: '', title: '', tels: [], emails: [], address: '', note: '' };
      fn = '';
      n = '';
      continue;
    }
    if (/^END:VCARD$/i.test(trimmed)) {
      flush();
      inCard = false;
      current = null;
      if (contacts.length >= MAX_CONTACTS) break;
      continue;
    }
    if (!inCard || current === null) continue;
    const prop = splitProperty(line);
    if (prop === null) continue;
    switch (prop.name) {
      case 'FN':
        fn = prop.value;
        break;
      case 'N':
        if (n === '') n = prop.value;
        break;
      case 'ORG':
        current.org = unescapeVcf(prop.value).replace(/;/g, ' ').trim();
        break;
      case 'TITLE':
        current.title = unescapeVcf(prop.value).trim();
        break;
      case 'TEL':
        current.tels.push(unescapeVcf(prop.value).trim());
        break;
      case 'EMAIL':
        current.emails.push(unescapeVcf(prop.value).trim());
        break;
      case 'ADR':
        if (current.address === '') current.address = addressFromAdr(prop.value);
        break;
      case 'NOTE':
        current.note = unescapeVcf(prop.value).trim();
        break;
      default:
        break;
    }
  }
  return contacts;
}

export function ContactPreview({ text }: ContactPreviewProps) {
  const { t } = useTranslation();

  const contacts = useMemo<ContactCard[]>(() => {
    try {
      const src = text.length > MAX_TEXT_LENGTH ? text.slice(0, MAX_TEXT_LENGTH) : text;
      return parseVcards(src);
    } catch {
      return [];
    }
  }, [text]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex shrink-0 items-center gap-1.5 px-1 text-xs text-muted-foreground">
        <Users className="size-3.5" />
        <span className="text-foreground">{t('preview.contactTitle')}</span>
        <span className="tabular-nums">{t('preview.contactCount', { count: contacts.length })}</span>
      </div>

      {contacts.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center rounded border border-border bg-muted/20 px-4 text-sm text-muted-foreground">
          {t('preview.contactEmpty')}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto pr-1">
          <div className="flex flex-col gap-2">
            {contacts.map((contact, index) => (
              <div key={index} className="rounded border border-border bg-muted/20 p-3">
                <div className="text-sm font-semibold text-foreground">
                  {contact.name !== '' ? contact.name : t('preview.contactName')}
                </div>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  {contact.org !== '' && (
                    <>
                      <dt className="text-muted-foreground">{t('preview.contactOrg')}</dt>
                      <dd className="text-foreground">{contact.org}</dd>
                    </>
                  )}
                  {contact.title !== '' && (
                    <>
                      <dt className="text-muted-foreground">{t('preview.contactTitle2')}</dt>
                      <dd className="text-foreground">{contact.title}</dd>
                    </>
                  )}
                  {contact.tels.length > 0 && (
                    <>
                      <dt className="text-muted-foreground">{t('preview.contactTel')}</dt>
                      <dd className="flex flex-col gap-0.5 tabular-nums text-foreground">
                        {contact.tels.map((tel, i) => (
                          <span key={i}>{tel}</span>
                        ))}
                      </dd>
                    </>
                  )}
                  {contact.emails.length > 0 && (
                    <>
                      <dt className="text-muted-foreground">{t('preview.contactEmail')}</dt>
                      <dd className="flex flex-col gap-0.5 text-foreground">
                        {contact.emails.map((email, i) => (
                          <span key={i} className="break-all">
                            {email}
                          </span>
                        ))}
                      </dd>
                    </>
                  )}
                  {contact.address !== '' && (
                    <>
                      <dt className="text-muted-foreground">{t('preview.contactAddress')}</dt>
                      <dd className="text-foreground">{contact.address}</dd>
                    </>
                  )}
                  {contact.note !== '' && (
                    <>
                      <dt className="text-muted-foreground">{t('preview.contactNote')}</dt>
                      <dd className="whitespace-pre-wrap text-foreground">{contact.note}</dd>
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