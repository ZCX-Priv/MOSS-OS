// src/modules/context/file-index/sag-engine/extract-rules.ts
// 规则实体抽取（同步零成本）：
//   代码 → 标识符（驼峰/下划线拆词）、导入路径组件
//   文档 → 标题、行内代码、路径形态、大写术语
// 实体类型：symbol（代码标识符）/ path（路径组件）/ concept（文档概念）

export interface RuleEntity {
  name: string;
  type: 'symbol' | 'path' | 'concept';
}

const MAX_ENTITIES_PER_CHUNK = 24;

/** 标识符拆词：camelCase / PascalCase / snake_case → 词组 */
function splitIdentifier(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-]+/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3);
}

/** 代码 chunk 实体抽取 */
export function extractCodeEntities(content: string): RuleEntity[] {
  const out: RuleEntity[] = [];
  const seen = new Set<string>();

  const push = (name: string, type: RuleEntity['type']): void => {
    const n = name.trim();
    if (n.length < 3 || n.length > 64) return;
    // 去重保留大小写（FileIndexService 与 fileIndexService 是不同标识符；
    // 大小写归一发生在存储层 ensureEntity，此处保完整变体供超边连接）
    const key = `${type}:${n}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name: n, type });
  };

  // 1) 标识符（声明与引用）——保留完整标识符（超边连接性强于拆词）
  const identifiers = content.match(/[A-Za-z_$][A-Za-z0-9_$]{2,}/g) ?? [];
  for (const id of identifiers) {
    push(id, 'symbol');
    if (out.length >= MAX_ENTITIES_PER_CHUNK) return out;
  }

  // 2) 字符串字面量中的路径（'./foo/bar' 形态）
  const paths = content.match(/['"`](\.?\.?\/[A-Za-z0-9_\-./]{2,})['"`]/g) ?? [];
  for (const p of paths) {
    const inner = p.slice(1, -1);
    for (const seg of inner.split('/')) {
      if (seg && !seg.startsWith('.')) push(seg, 'path');
    }
    if (out.length >= MAX_ENTITIES_PER_CHUNK) break;
  }
  return out;
}

/** 文档 chunk 实体抽取 */
export function extractDocEntities(content: string): RuleEntity[] {
  const out: RuleEntity[] = [];
  const seen = new Set<string>();

  const push = (name: string, type: RuleEntity['type']): void => {
    const n = name.trim();
    if (n.length < 2 || n.length > 64) return;
    const key = `${type}:${n.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name: n, type });
  };

  // 1) 标题（# 开头行的文本）
  for (const line of content.split('\n')) {
    const m = line.match(/^#{1,6}\s+(.+)/);
    if (m) push(m[1].trim(), 'concept');
  }
  // 2) 行内代码 `xxx`
  for (const m of content.matchAll(/`([^`\n]{2,64})`/g)) {
    push(m[1], 'symbol');
  }
  // 3) 路径形态（src/xxx/yyy 或 ./relative）
  for (const m of content.matchAll(/(?:\.?\.?\/)?(?:[A-Za-z0-9_\-]+\/){1,4}[A-Za-z0-9_\-.]+/g)) {
    for (const seg of m[0].split('/')) {
      if (seg && !seg.startsWith('.')) push(seg, 'path');
    }
  }
  // 4) 中英文关键术语：全大写缩写（API、HTTP）与中文词组（2-8 字）
  for (const m of content.matchAll(/\b[A-Z]{2,8}\b/g)) {
    push(m[0], 'concept');
  }
  for (const m of content.matchAll(/[\u4e00-\u9fa5]{2,8}/g)) {
    push(m[0], 'concept');
  }
  return dedupe(out).slice(0, MAX_ENTITIES_PER_CHUNK);
}

/** 按名称+类型去重 */
function dedupe(list: RuleEntity[]): RuleEntity[] {
  const seen = new Set<string>();
  const out: RuleEntity[] = [];
  for (const e of list) {
    const key = `${e.type}:${e.name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

/** 入口：按代码/文档分派 */
export function extractRuleEntities(content: string, isCode: boolean): RuleEntity[] {
  return isCode ? extractCodeEntities(content) : extractDocEntities(content);
}

export { splitIdentifier };
