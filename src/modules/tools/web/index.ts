// tools/web/index.ts
// web 工具 execute 逻辑：联网能力单工具双模式。
//   mode=search → providers.runSearch（默认搜索服务商→失败降级本地引擎链 bing→baidu→sogou；
//                 engine=local 直达本地链；未配置服务商 = 直接本地链）
//   mode=fetch  → fetcher.runFetch（本地直连 + SSRF 防护 + HTML 转可见文本）
// 搜索服务商与默认引擎来自「设置页 → 服务商」体系（api.json providers kind='search' +
// config.json web.searchProviderId），经 CONFIG_SERVICE 服务运行时读取。
// 输出面向 LLM 阅读优化：header（引擎/条数/耗时/降级标记）+ 编号条目 + 结构化 metadata。
// 元数据见同目录 tool.json。

import { t } from '../../../core/i18n';
import type { ConfigService } from '../../../core/types';
import { ServiceNames } from '../../../core/types';
import type { ToolContext, ToolResult } from '../types';
import {
  runSearch,
  SearchError,
  type SearchOutcome,
  type SearchProviderRef,
} from './providers';
import { runFetch, FetchError } from './fetcher';

/** 工具输入参数（LLM function call） */
interface WebParams {
  mode?: 'search' | 'fetch';
  query?: string;
  url?: string;
  engine?: 'auto' | 'local';
  maxResults?: number;
  freshness?: 'noLimit' | 'oneDay' | 'oneWeek' | 'oneMonth' | 'oneYear';
  timeoutMs?: number;
}

/** config.json tools.web 段（仅行为参数；服务商 key 在 api.json，不在此处） */
interface WebToolConfig {
  timeoutMs?: number;
  maxResults?: number;
  maxFetchChars?: number;
}

const MAX_QUERY_LENGTH = 500;
const MAX_SNIPPET_CHARS = 400;
const MAX_TITLE_CHARS = 200;

export default {
  async execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
    const p = (params ?? {}) as WebParams;

    if (p.mode !== 'search' && p.mode !== 'fetch') {
      return {
        content: [{ type: 'text', text: `Error: ${t('tools.webModeInvalid')}` }],
        isError: true,
      };
    }

    const cfg = (ctx.toolConfig ?? {}) as WebToolConfig;
    return p.mode === 'search'
      ? await executeSearch(p, cfg, ctx)
      : await executeFetch(p, cfg, ctx);
  },
};

// ============================================================================
// 服务商解析（api.json kind='search' + config.json web.searchProviderId）
// ============================================================================

/** 从服务注册表解析默认搜索服务商；解析失败/未配置返回 undefined（= 本地引擎链） */
function resolveSearchProvider(ctx: ToolContext): SearchProviderRef | undefined {
  const config = ctx.services.tryResolve<ConfigService>(ServiceNames.CONFIG_SERVICE);
  if (!config) return undefined;

  let providerId = '';
  let providers: Array<{
    id: string;
    name: string;
    kind?: string;
    searchEngine?: string;
    apiKey?: string;
    endpoint?: string;
  }> = [];
  try {
    providerId = config.getAppConfig().web?.searchProviderId ?? '';
    providers = config.getApiConfig().providers;
  } catch {
    return undefined;
  }

  if (!providerId) return undefined;
  const found = providers.find(
    (p) => p.id === providerId && p.kind === 'search' && !!p.searchEngine,
  );
  if (!found) return undefined;

  const engine = found.searchEngine;
  if (engine !== 'zhipu' && engine !== 'bocha' && engine !== 'tavily') return undefined;

  const ref: SearchProviderRef = {
    id: found.id,
    name: found.name,
    searchEngine: engine,
    apiKey: found.apiKey ?? '',
  };
  // 自定义端点（兼容第三方网关；空 = 官方端点）
  if (found.endpoint && found.endpoint.trim()) {
    ref.baseURL = found.endpoint.trim();
  }
  return ref;
}

// ============================================================================
// search 模式
// ============================================================================

async function executeSearch(
  p: WebParams,
  cfg: WebToolConfig,
  ctx: ToolContext,
): Promise<ToolResult> {
  // ---- query 校验 ----
  if (!p.query || typeof p.query !== 'string' || !p.query.trim()) {
    return { content: [{ type: 'text', text: `Error: ${t('tools.webQueryRequired')}` }], isError: true };
  }
  if (p.query.length > MAX_QUERY_LENGTH) {
    return {
      content: [{ type: 'text', text: `Error: ${t('tools.webQueryTooLong', { max: MAX_QUERY_LENGTH })}` }],
      isError: true,
    };
  }

  // ---- 参数合并（调用参数 > 工具配置 > 默认值）----
  const maxResults = clampInt(p.maxResults ?? cfg.maxResults ?? 8, 1, 20);
  const timeoutMs = clampInt(p.timeoutMs ?? cfg.timeoutMs ?? 20_000, 3_000, 60_000);

  // 引擎路由：local=强制本地链；auto=默认搜索服务商（未配置则本地链）
  const provider = p.engine === 'local' ? undefined : resolveSearchProvider(ctx);

  ctx.emit?.({ type: 'progress', message: t('tools.webSearching') });

  const startedAt = Date.now();
  try {
    const outcome = await runSearch(
      {
        query: p.query.trim(),
        maxResults,
        freshness: p.freshness,
        timeoutMs,
      },
      provider ? { provider } : {},
    );
    return formatSearchResult(outcome, p.query.trim(), Date.now() - startedAt);
  } catch (err) {
    return formatSearchError(err);
  }
}

/** search 成功输出：header（含引擎/降级标记）+ 可选引擎总述 + 编号条目 */
function formatSearchResult(outcome: SearchOutcome, query: string, elapsedMs: number): ToolResult {
  const engineLabel =
    outcome.engineKind === 'local'
      ? `${outcome.engine}(本地)`
      : `${outcome.engine}(服务商)`;
  const degradedSuffix = outcome.degradedFrom
    ? ` | ${t('tools.webDegradedFrom', { provider: outcome.degradedFrom })}`
    : '';
  const header =
    t('tools.webResultHeader', {
      engine: engineLabel,
      count: outcome.items.length,
      elapsed: elapsedMs,
    }) + degradedSuffix;

  // 引擎总述（Tavily answer）：置于条目前，标注为引擎生成
  const noteLines = outcome.note
    ? [`${t('tools.webEngineNote')}: ${outcome.note}`, '']
    : [];

  if (outcome.items.length === 0) {
    return {
      content: [{ type: 'text', text: `${header}\n${t('tools.webNoResults')}` }],
      metadata: {
        mode: 'search',
        engineKind: outcome.engineKind,
        engine: outcome.engine,
        query,
        count: 0,
        items: [],
        ...(outcome.degradedFrom ? { degradedFrom: outcome.degradedFrom } : {}),
      },
    };
  }

  const itemLines: string[] = [];
  outcome.items.forEach((item, i) => {
    const lines: string[] = [];
    lines.push(`[${i + 1}] ${truncate(item.title || item.url, MAX_TITLE_CHARS)}`);
    if (item.url) lines.push(`    URL: ${item.url}`);
    if (item.snippet) lines.push(`    ${t('tools.webSnippetLabel')}: ${truncate(item.snippet, MAX_SNIPPET_CHARS)}`);
    const metaParts: string[] = [];
    if (item.source) metaParts.push(item.source);
    if (item.publishedAt) metaParts.push(item.publishedAt);
    if (metaParts.length > 0) lines.push(`    ${metaParts.join(' | ')}`);
    itemLines.push(lines.join('\n'));
  });

  // 降级说明（服务商用尽后本地链仍成功）：附失败链摘要供 LLM 理解
  const fallbackNote =
    outcome.fallbackFrom && outcome.fallbackFrom.length > 0
      ? `\n${t('tools.webFallbackNote')}: ${outcome.fallbackFrom
          .map((f) => `[${f.engine}] ${f.reason}`)
          .join('；')}`
      : '';

  return {
    content: [
      {
        type: 'text',
        text: [header, ...noteLines, '', itemLines.join('\n\n'), fallbackNote].join('\n'),
      },
    ],
    metadata: {
      mode: 'search',
      engineKind: outcome.engineKind,
      engine: outcome.engine,
      query,
      count: outcome.items.length,
      items: outcome.items,
      ...(outcome.degradedFrom ? { degradedFrom: outcome.degradedFrom } : {}),
      ...(outcome.fallbackFrom ? { fallbackFrom: outcome.fallbackFrom } : {}),
    },
  };
}

/** SearchError → 用户可读错误（含逐引擎失败明细） */
function formatSearchError(err: unknown): ToolResult {
  if (err instanceof SearchError) {
    if (err.code === 'all-failed') {
      const lines = err.failures.map((f) => `[${f.engine}] ${f.reason}`).join('\n');
      return {
        content: [{ type: 'text', text: `Error: ${t('tools.webAllEnginesFailed')}\n${lines}` }],
        isError: true,
      };
    }
    return {
      content: [{ type: 'text', text: `Error: ${t('tools.webEngineFailed')}: ${err.message}` }],
      isError: true,
    };
  }
  return {
    content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
    isError: true,
  };
}

// ============================================================================
// fetch 模式
// ============================================================================

async function executeFetch(
  p: WebParams,
  cfg: WebToolConfig,
  ctx: ToolContext,
): Promise<ToolResult> {
  // ---- url 校验 ----
  if (!p.url || typeof p.url !== 'string' || !p.url.trim()) {
    return { content: [{ type: 'text', text: `Error: ${t('tools.webUrlRequired')}` }], isError: true };
  }

  const timeoutMs = clampInt(p.timeoutMs ?? cfg.timeoutMs ?? 20_000, 3_000, 60_000);
  const maxChars = clampInt(cfg.maxFetchChars ?? 20_000, 1_000, 100_000);

  ctx.emit?.({ type: 'progress', message: t('tools.webFetching', { url: p.url }) });

  try {
    const result = await runFetch({
      url: p.url,
      timeoutMs,
      maxChars,
      signal: ctx.signal,
    });
    return formatFetchResult(result);
  } catch (err) {
    return formatFetchError(err, timeoutMs);
  }
}

/** fetch 成功输出：header + 标题 + 正文 + 页内链接 + 警告 */
function formatFetchResult(result: Awaited<ReturnType<typeof runFetch>>): ToolResult {
  const header = t('tools.webFetchHeader', {
    url: result.finalUrl,
    status: `${result.status} ${result.statusText}`.trim(),
    bytes: formatBytes(result.meta.bytes),
    elapsed: result.meta.elapsedMs,
  });

  const sections: string[] = [header];
  if (result.title) {
    sections.push(`${t('tools.webTitleLabel')}: ${result.title}`);
  }
  sections.push('', result.text);
  if (result.meta.truncated) {
    sections.push('', t('tools.webTruncated'));
  }
  if (result.links.length > 0) {
    const linkLines = result.links.map(
      (link, i) => `${i + 1}. ${link.text} → ${link.url}`,
    );
    sections.push('', t('tools.webLinksLabel'), linkLines.join('\n'));
  }
  if (result.warnings.length > 0) {
    sections.push('', result.warnings.map((w) => `${t('tools.webWarningLabel')}: ${w}`).join('\n'));
  }

  return {
    content: [{ type: 'text', text: sections.join('\n') }],
    metadata: {
      mode: 'fetch',
      url: result.requestUrl,
      finalUrl: result.finalUrl,
      status: result.status,
      contentType: result.contentType,
      bytes: result.meta.bytes,
      truncated: result.meta.truncated,
      redirectChain: result.meta.redirectChain,
      title: result.title,
      elapsedMs: result.meta.elapsedMs,
      links: result.links,
    },
  };
}

/** FetchError → 用户可读错误（按 code 映射 i18n） */
function formatFetchError(err: unknown, timeoutMs: number): ToolResult {
  if (err instanceof FetchError) {
    const reason = [err.message, err.causeMessage].filter(Boolean).join(': ');
    switch (err.code) {
      case 'invalid-url':
        return { content: [{ type: 'text', text: `Error: ${t('tools.webUrlInvalid', { reason })}` }], isError: true };
      case 'unsafe-target':
        return { content: [{ type: 'text', text: `Error: ${t('tools.webUnsafeUrl', { reason })}` }], isError: true };
      case 'timeout':
        return { content: [{ type: 'text', text: `Error: ${t('tools.webTimeout', { ms: timeoutMs })}` }], isError: true };
      case 'too-large':
        return { content: [{ type: 'text', text: `Error: ${t('tools.webTooLarge')}` }], isError: true };
      case 'unsupported-type':
        return { content: [{ type: 'text', text: `Error: ${t('tools.webUnsupportedType', { reason: err.message })}` }], isError: true };
      case 'too-many-redirects':
        return { content: [{ type: 'text', text: `Error: ${t('tools.webTooManyRedirects')}` }], isError: true };
      default:
        return { content: [{ type: 'text', text: `Error: ${t('tools.webFetchFailed', { reason })}` }], isError: true };
    }
  }
  return {
    content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
    isError: true,
  };
}

// ============================================================================
// 辅助
// ============================================================================

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
