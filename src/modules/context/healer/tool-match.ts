// src/modules/context/healer/tool-match.ts
// 工具名模糊纠正：精确命中直用；编辑距离 ≤2（长度 ≥4）的唯一最近邻纠正；
// MCP 工具（mcp__server__tool）server 段精确 + tool 段模糊分段匹配。

/** 编辑距离（Levenshtein） */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1, // 删除
        curr[j - 1] + 1, // 插入
        prev[j - 1] + cost, // 替换
      );
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[n];
}

/** 模糊纠正的距离上限（短名误纠正风险高，仅长度 ≥4 参与） */
const FUZZY_MAX_DISTANCE = 2;
const FUZZY_MIN_NAME_LENGTH = 4;

export interface ToolMatchResult {
  /** 纠正后的工具名（精确命中 = 原名）；null = 无法纠正 */
  matched: string | null;
  /** 是否发生了纠正 */
  corrected: boolean;
  /** 近邻候选（按距离升序，供错误信息/提示使用） */
  candidates: string[];
}

/** 已知工具名集合的鸭子类型（避免直接依赖 ToolRegistry） */
export interface KnownToolsSource {
  listSchemas(): Array<{ name: string }>;
}

/**
 * 模糊匹配工具名。
 * @param name 模型输出的工具名
 * @param source 工具名来源（ToolRegistry 结构子集）
 * @param fuzzyEnabled 是否启用模糊纠正（config.context.healer.toolNameFuzzy）
 */
export function fuzzyMatchToolName(
  name: string,
  source: KnownToolsSource,
  fuzzyEnabled: boolean,
): ToolMatchResult {
  let known: string[];
  try {
    known = source.listSchemas().map(s => s.name);
  } catch {
    known = [];
  }

  // 1. 精确命中（含 MCP 全名）
  if (known.includes(name)) {
    return { matched: name, corrected: false, candidates: [] };
  }

  if (!fuzzyEnabled || name.length < FUZZY_MIN_NAME_LENGTH || known.length === 0) {
    return { matched: null, corrected: false, candidates: nearestCandidates(name, known, 3) };
  }

  // 2. MCP 分段匹配：mcp__server__tool（server 段必须精确，tool 段模糊）
  const mcpMatch = /^mcp__([^_]+)__(.+)$/.exec(name);
  if (mcpMatch) {
    const [, server, tool] = mcpMatch;
    const sameServer = known.filter(k => k === `mcp__${server}__${tool}` || k.startsWith(`mcp__${server}__`));
    // server 精确命中的候选里做 tool 段模糊
    const scored = sameServer
      .map(k => ({ name: k, dist: editDistance(tool, k.slice(`mcp__${server}__`.length)) }))
      .filter(x => x.dist <= FUZZY_MAX_DISTANCE)
      .sort((a, b) => a.dist - b.dist);
    if (scored.length > 0 && (scored.length === 1 || scored[0].dist < scored[1].dist)) {
      return { matched: scored[0].name, corrected: true, candidates: [] };
    }
    return { matched: null, corrected: false, candidates: sameServer.slice(0, 3) };
  }

  // 3. 全名模糊：唯一最近邻且距离 ≤ 阈值
  const scored = known
    .map(k => ({ name: k, dist: editDistance(name, k) }))
    .filter(x => x.dist <= FUZZY_MAX_DISTANCE)
    .sort((a, b) => a.dist - b.dist || a.name.localeCompare(b.name));
  if (scored.length > 0 && (scored.length === 1 || scored[0].dist < scored[1].dist)) {
    return { matched: scored[0].name, corrected: true, candidates: [] };
  }
  return { matched: null, corrected: false, candidates: scored.slice(0, 3).map(x => x.name) };
}

/** 取距离最近的候选名列表（不含距离过滤，仅排序） */
function nearestCandidates(name: string, known: string[], count: number): string[] {
  return known
    .map(k => ({ name: k, dist: editDistance(name, k) }))
    .sort((a, b) => a.dist - b.dist || a.name.localeCompare(b.name))
    .slice(0, count)
    .map(x => x.name);
}
