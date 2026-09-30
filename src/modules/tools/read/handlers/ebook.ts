// read/handlers/ebook.ts
// 电子书处理：
// - EPUB（epub/opf）：jszip 解包 → META-INF/container.xml → OPF(spine/manifest) → 逐章提取正文（cheerio 剥离标签）
// - FB2（fb2）：XML 结构，cheerio 解析取 <body> 文本
// - MOBI/AZW3（mobi/azw3/azw）：无稳定纯 JS 解析方案，明确报错提示转换
// 所有库均通过 await import() 动态懒加载。

import { readFileSync } from 'node:fs';
import { extname, basename, posix } from 'node:path';
import type { CheerioAPI } from 'cheerio';
import type { ToolResult } from '../../types';

/** 支持 zip 容器 EPub 的扩展名 */
const EPUB_EXTS = new Set(['.epub', '.opf']);

/** FB2（FictionBook） */
const FB2_EXTS = new Set(['.fb2']);

/**
 * 读取电子书文件，提取文本。
 */
export async function readEbook(path: string): Promise<ToolResult> {
  const ext = extname(path).toLowerCase();
  try {
    if (EPUB_EXTS.has(ext)) {
      return await readEpub(path);
    }
    if (FB2_EXTS.has(ext)) {
      return await readFb2(path);
    }
    // mobi / azw3 / azw
    return {
      content: [{
        type: 'text',
        text: `Error: ${ext || 'unknown'} e-book format is not supported (no stable pure-JS parser). Please convert to .epub (e.g. with Calibre) and read again: ${path}`,
      }],
      isError: true,
      metadata: { type: 'ebook', supported: false },
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error reading e-book: ${err instanceof Error ? err.message : String(err)}` }],
      isError: true,
    };
  }
}

/** 读取 EPUB：按 spine 顺序逐章提取正文文本 */
async function readEpub(path: string): Promise<ToolResult> {
  const JSZip = (await import('jszip')).default;
  const { load } = await import('cheerio');

  const zip = await JSZip.loadAsync(readFileSync(path));

  // 1. 定位 OPF（package document）
  let opfPath = '';
  const container = zip.file('META-INF/container.xml');
  if (container) {
    const xml = await container.async('string');
    const $c = load(xml, { xmlMode: true });
    opfPath = $c('rootfile').attr('full-path') ?? '';
  }
  if (!opfPath) {
    // 回退：取第一个 .opf
    opfPath = Object.keys(zip.files).find((n) => n.toLowerCase().endsWith('.opf')) ?? '';
  }
  if (!opfPath) throw new Error('EPUB package document (OPF) not found');
  const opfFile = zip.file(opfPath);
  if (!opfFile) throw new Error(`EPUB OPF not found in archive: ${opfPath}`);

  const opfDir = posix.dirname(opfPath);
  const opfDirPrefix = opfDir === '.' ? '' : `${opfDir}/`;

  const $ = load(await opfFile.async('string'), { xmlMode: true });

  // 2. manifest（id → href / media-type）
  const manifest = new Map<string, { href: string; mediaType: string }>();
  $('manifest > item').each((_i, el) => {
    const id = $(el).attr('id');
    const href = $(el).attr('href');
    if (id && href) manifest.set(id, { href, mediaType: $(el).attr('media-type') ?? '' });
  });

  // 3. spine 顺序（无 spine 时回退为全部 HTML 类 manifest 项）
  const spineHrefs: string[] = [];
  $('spine > itemref').each((_i, el) => {
    const idref = $(el).attr('idref');
    const item = idref ? manifest.get(idref) : undefined;
    if (item) spineHrefs.push(item.href);
  });
  if (spineHrefs.length === 0) {
    for (const item of manifest.values()) {
      if (/\.x?html?$/i.test(item.href)) spineHrefs.push(item.href);
    }
  }

  // 4. 逐章提取正文
  const chapters: string[] = [];
  for (const href of spineHrefs) {
    const rel = decodeURIComponent(href).replace(/^\.\//, '').split('#')[0];
    const full = `${opfDirPrefix}${rel}`;
    const f = zip.file(full) ?? zip.file(decodeURIComponent(full));
    if (!f) continue;
    const html = await f.async('string');
    const $ch = load(html);
    $ch('script, style, head').remove();
    // 块级元素之间补换行，避免「第一章你好世界」式粘连
    $ch('br').replaceWith('\n');
    $ch('p, div, li, tr, h1, h2, h3, h4, h5, h6, section, article, blockquote, pre').each((_i, el) => {
      $ch(el).append('\n');
    });
    const text = ($ch('body').text() || $ch.root().text()).replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim();
    if (text) chapters.push(text);
  }

  const title = readOpfTitle($, basename(path));
  const body = chapters.join('\n\n---\n\n');

  return {
    content: [{ type: 'text', text: `${path} (EPUB · ${title})\n${body}` }],
    metadata: { type: 'epub', title, chapters: chapters.length },
  };
}

/**
 * 读取 OPF 元数据标题。
 * OPF 中标题常带命名空间前缀（dc:title），CSS 选择器难以跨命名空间匹配，
 * 故按元素本地名扫描 metadata 子元素。
 */
function readOpfTitle($: CheerioAPI, fallback: string): string {
  let title = '';
  $('metadata')
    .find('*')
    .each((_i, el) => {
      if (title) return;
      const tag = typeof el.tagName === 'string' ? el.tagName.toLowerCase() : '';
      const local = tag.includes(':') ? tag.slice(tag.indexOf(':') + 1) : tag;
      if (local === 'title') {
        const text = $(el).text().trim();
        if (text) title = text;
      }
    });
  return title || fallback;
}

/** 读取 FB2（FictionBook）：取 <body> 文本，剔除内嵌二进制资源 */
async function readFb2(path: string): Promise<ToolResult> {
  const { load } = await import('cheerio');
  const xml = readFileSync(path).toString('utf-8');
  const $ = load(xml, { xmlMode: true });

  const title = $('book-title').first().text().trim() || basename(path);
  const authors = $('author')
    .map((_i, el) => {
      const first = $(el).find('first-name').text().trim();
      const last = $(el).find('last-name').text().trim();
      return `${first} ${last}`.trim();
    })
    .get()
    .filter(Boolean)
    .join(', ');

  // 内嵌 base64 资源体量大且无文本价值，剔除
  $('binary').remove();
  const body = $('body').text().replace(/\n{3,}/g, '\n\n').trim();

  const header = [title, authors].filter(Boolean).join(' · ');
  return {
    content: [{ type: 'text', text: `${path} (FB2 · ${header})\n${body}` }],
    metadata: { type: 'fb2', title, authors },
  };
}