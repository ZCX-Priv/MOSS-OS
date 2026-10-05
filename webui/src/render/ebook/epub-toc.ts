// render/ebook/epub-toc.ts
// EPUB 目录纯逻辑（与 React 解耦，便于用脚本对真实 EPUB 直接验证）：
//   - 导航项 → 层级目录树（保留分组标题与层级）
//   - 层级树 → 带缩进深度的渲染行（键唯一、稳定）
//   - 目录 href → 确实存在的 spine 章节（跳转前的目标解析）
//
// resolveSection 三段式兜底：
//   ① 直接以 href（含去 fragment / 解码变体）交给 epubjs 的 spine.get
//   ② 归一化「归档内绝对路径」后比对：目录文档与 OPF 不在同一目录、或 href 形态
//      （../、编码、绝对/相对）不一致时仍能命中
//   ③ 都未命中返回 null（由调用方决定兜底策略，如按下标 display）

/** epubjs 导航项（最小结构） */
export interface EpubNavItemLike {
  id?: string;
  label?: string;
  href?: string;
  subitems?: EpubNavItemLike[];
}

/** spine 章节（epubjs Section 的最小结构） */
export interface EpubSectionLike {
  href: string;
  index: number;
}

/** spine（epubjs Spine 的最小结构；each 缺省时回退 get(0..length-1) 遍历） */
export interface EpubSpineLike {
  get(target?: string | number): EpubSectionLike | null;
  length?: number;
  each?(fn: (section: EpubSectionLike) => void): void;
}

/** 目标解析所需的 Book 面（epubjs Book 的最小结构） */
export interface EpubBookLike {
  spine?: EpubSpineLike;
  /** 相对 OPF 目录解析路径（absolute=false 时不加 archive url 前缀） */
  resolve?: (path: string, absolute?: boolean) => string | undefined;
  /** OPF 解析结果：navPath（EPUB3 nav）/ ncxPath（EPUB2 NCX），相对 OPF 目录 */
  packaging?: { navPath?: string | false; ncxPath?: string | false };
}

/** 目录树节点（保留层级；分组标题 href 为空） */
export interface TocNode {
  label: string;
  href: string;
  children: TocNode[];
}

/** 导航项 → 层级目录树：保留分组标题与层级，标签规整，空标签以 href/占位兜底 */
export function toTocNodes(items: EpubNavItemLike[] | undefined): TocNode[] {
  if (!items) return [];
  const out: TocNode[] = [];
  for (const item of items) {
    const label = (item.label ?? '').replace(/\s+/g, ' ').trim();
    const href = (item.href ?? '').trim();
    const children = toTocNodes(item.subitems);
    if (!label && !href && children.length === 0) continue;
    out.push({ label: label || href || '•', href, children });
  }
  return out;
}

/** 层级树展开为带缩进深度的渲染行（键唯一、稳定） */
export function flattenForRender(
  nodes: TocNode[],
  depth = 0,
  prefix = '',
): Array<{ node: TocNode; depth: number; key: string }> {
  const out: Array<{ node: TocNode; depth: number; key: string }> = [];
  nodes.forEach((node, i) => {
    const key = `${prefix}${i}`;
    out.push({ node, depth, key });
    if (node.children.length > 0) out.push(...flattenForRender(node.children, depth + 1, `${key}-`));
  });
  return out;
}

/** 归档内路径归一化：解码百分号编码 → 去空段/`.` → `..` 回退一层 → join('/') */
function normalizeAbs(path: string): string {
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    // 非法百分号编码：按原串处理
  }
  const segments: string[] = [];
  for (const seg of decoded.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      segments.pop();
      continue;
    }
    segments.push(seg);
  }
  return segments.join('/');
}

/** 归档内绝对路径的目录部分（不依赖 node:path；`/OEBPS/toc.ncx` → `/OEBPS`） */
function dirnameAbs(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx <= 0 ? '' : path.slice(0, idx);
}

/** 遍历 spine 章节，返回首个满足谓词的章节（优先 each，缺省回退 get(0..length-1)） */
function findSection(
  book: EpubBookLike,
  predicate: (section: EpubSectionLike) => boolean,
): EpubSectionLike | null {
  const spine = book.spine;
  if (!spine) return null;
  if (typeof spine.each === 'function') {
    let found: EpubSectionLike | null = null;
    spine.each((section) => {
      if (found === null && predicate(section)) found = section;
    });
    return found;
  }
  const length = spine.length ?? 0;
  for (let i = 0; i < length; i++) {
    const section = spine.get(i);
    if (section && predicate(section)) return section;
  }
  return null;
}

/**
 * TOC href → 确实存在的 spine 章节。
 * epubjs 的 spineByHref 以「相对 OPF 解析后的 href」为键，而导航 href 相对 nav 文档，
 * 两者在 nav/OPF 不同目录、含 fragment 或编码差异时对不上 → 直接 display(href) 会
 * "No Section Found" 而不跳转。这里逐级兜底解析。
 */
export function resolveSection(book: EpubBookLike | null, href: string): EpubSectionLike | null {
  if (!book?.spine) return null;

  // ① 直接命中（去 fragment / 解码变体；Spine.get 内部另含 encode/decodeURI 尝试）
  const clean = href.split('#')[0];
  const candidates: string[] = [href, clean];
  try {
    candidates.push(decodeURIComponent(clean));
  } catch {
    // 非法百分号编码：忽略该候选
  }
  for (const candidate of candidates) {
    if (!candidate) continue;
    const section = book.spine.get(candidate);
    if (section) return section;
  }

  // ② 归一化绝对路径比对（nav 与 OPF 目录不一致时的形态差异兜底）
  // 注意：必须经 book.resolve 调用——epubjs 的 resolve 内部依赖 this.path / this.url，
  // 若解构为独立函数再调用会丢失 this 并抛 "undefined is not an object (this.path)"。
  const navPath = book.packaging?.navPath || book.packaging?.ncxPath;
  if (typeof book.resolve !== 'function' || !navPath || !clean) return null;
  const navAbs = book.resolve(navPath, false);
  if (!navAbs) return null;
  const navTargetAbs = normalizeAbs(`${dirnameAbs(navAbs)}/${clean}`);
  if (!navTargetAbs) return null;
  return findSection(book, (section) => {
    const sectionAbs = book.resolve?.(section.href, false);
    return typeof sectionAbs === 'string' && normalizeAbs(sectionAbs) === navTargetAbs;
  });
}