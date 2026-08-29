// src/modules/tools/web/web.test.ts
// web 工具单元测试：HTML 提取、SSRF 判定、三服务商引擎响应解析、
// 本地免费引擎解析器（bing/baidu/sogou）、回退链与降级、key 脱敏。

import { describe, it, expect } from 'bun:test';
import {
  extractVisibleTextFromHtml,
  decodeHtmlEntities,
  extractLinks,
  extractTitle,
  stripElement,
} from './html-extract';
import {
  isPrivateIpAddress,
  assertSafeTarget,
  normalizeFetchUrl,
  type LookupFn,
} from './fetcher';
import {
  parseZhipuResponse,
  parseBochaResponse,
  parseTavilyResponse,
  runSearch,
  SearchError,
  type SearchParams,
  type SearchProviderRef,
} from './providers';
import {
  parseBingResults,
  parseBaiduResults,
  parseSogouResults,
  runLocalSearch,
  LocalSearchError,
} from './local-engines';

// ============================================================================
// html-extract
// ============================================================================

describe('html-extract', () => {
  it('剥离 script/style/head/noscript/template 与注释，保留可见文本', () => {
    const html = `
      <html><head><title>T</title><style>.a{color:red}</style><script>var x = '<p>hidden</p>';</script></head>
      <body><!-- comment --><noscript>noscript text</noscript><template>t</template>
      <p>可见段落</p></body></html>`;
    const { text } = extractVisibleTextFromHtml(html);
    expect(text).toContain('可见段落');
    expect(text).not.toContain('hidden');
    expect(text).not.toContain('color:red');
    expect(text).not.toContain('comment');
    expect(text).not.toContain('noscript text');
  });

  it('未闭合的 script 元素：剩余文档整体剥离不泄漏', () => {
    const html = '<p>before</p><script>evil()<p>after</p>';
    const { text } = extractVisibleTextFromHtml(html);
    expect(text).toContain('before');
    expect(text).not.toContain('after');
    expect(text).not.toContain('evil()');
  });

  it('属性值中的 < 不被误认为标签起点（title="a<b" 场景）', () => {
    const html = '<p title="a<b">正文</p>';
    const { text } = extractVisibleTextFromHtml(html);
    expect(text).toContain('正文');
  });

  it('块级标签与 <br> 转换行，段落结构保留', () => {
    const html = '<div>第一段</div><div>第二段</div><p>a<br>b</p>';
    const { text } = extractVisibleTextFromHtml(html);
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    expect(lines).toContain('第一段');
    expect(lines).toContain('第二段');
    expect(lines).toContain('a');
    expect(lines).toContain('b');
  });

  it('实体解码：命名/十进制/十六进制', () => {
    expect(decodeHtmlEntities('a&amp;b')).toBe('a&b');
    expect(decodeHtmlEntities('&lt;tag&gt;')).toBe('<tag>');
    expect(decodeHtmlEntities('&#65;&#x42;')).toBe('AB');
    expect(decodeHtmlEntities('&nbsp;x')).toBe(' x');
  });

  it('实体解码：代理区/超界码点原样保留（不抛错不产生坏字符）', () => {
    expect(decodeHtmlEntities('&#xD800;')).toBe('&#xD800;');
    expect(decodeHtmlEntities('&#x110000;')).toBe('&#x110000;');
    expect(decodeHtmlEntities('&#-1;')).toBe('&#-1;');
    expect(decodeHtmlEntities('&unknownentity;')).toBe('&unknownentity;');
  });

  it('标题提取（含实体解码）', () => {
    expect(extractTitle('<html><head><title>A &amp; B</title></head></html>')).toBe('A & B');
    expect(extractTitle('<html><head><title>  </title></head></html>')).toBeNull();
    expect(extractTitle('<html></html>')).toBeNull();
  });

  it('stripElement：扫描式剥离嵌套内容', () => {
    expect(stripElement('<div>a<script>1</script>b</div>', 'script')).toBe('<div>a b</div>');
  });

  it('链接提取：相对链接绝对化、锚点/js 链接跳过、去重、base href 生效', () => {
    const html = `
      <a href="/about">关于</a>
      <a href="https://example.com/about">重复</a>
      <a href="#top">锚点</a>
      <a href="javascript:void(0)">js</a>
      <a href="mailto:a@b.c">邮件</a>
      <a href="https://other.com/x">外站</a>`;
    const links = extractLinks(html, 'https://example.com/page');
    const urls = links.map((l) => l.url);
    expect(urls).toContain('https://example.com/about');
    expect(urls).toContain('https://other.com/x');
    // /about 与 https://example.com/about 绝对化后是同一个 URL，应去重
    expect(urls.filter((u) => u === 'https://example.com/about')).toHaveLength(1);
    expect(urls).not.toContain('https://example.com/page#top');
  });

  it('链接提取：base href 覆盖基准 URL', () => {
    const html = '<base href="https://cdn.example.com/"><a href="img.png">图</a>';
    const links = extractLinks(html, 'https://original.com/');
    expect(links[0]?.url).toBe('https://cdn.example.com/img.png');
  });

  it('链接提取：超过 20 条截断', () => {
    const anchors = Array.from({ length: 30 }, (_, i) =>
      `<a href="https://example.com/p${i}">p${i}</a>`,
    ).join('');
    expect(extractLinks(anchors, 'https://example.com/')).toHaveLength(20);
  });
});

// ============================================================================
// SSRF 判定（isPrivateIpAddress / normalizeFetchUrl / assertSafeTarget）
// ============================================================================

describe('SSRF 防护', () => {
  it('IPv4 私有/保留段全部拒绝', () => {
    for (const ip of [
      '10.0.0.1',
      '10.255.255.255',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '127.0.0.1',
      '0.0.0.0',
      '169.254.169.254', // 云元数据
      '100.64.0.1',      // CGNAT
      '198.18.0.1',      // 代理 fake-IP 常用段
      '224.0.0.1',       // 组播
      '255.255.255.255',
    ]) {
      expect(isPrivateIpAddress(ip)).toBe(true);
    }
  });

  it('IPv4 边界外与公网地址放行', () => {
    for (const ip of ['172.15.255.255', '172.32.0.1', '8.8.8.8', '1.1.1.1', '93.184.216.34']) {
      expect(isPrivateIpAddress(ip)).toBe(false);
    }
  });

  it('IPv6 保留段拒绝，公网放行', () => {
    for (const ip of ['::', '::1', 'fc00::1', 'fd12::1', 'fe80::1', 'ff02::1', '2001:db8::1']) {
      expect(isPrivateIpAddress(ip)).toBe(true);
    }
    expect(isPrivateIpAddress('2606:4700::1111')).toBe(false);
  });

  it('IPv4-mapped IPv6 还原为 IPv4 后判定（回环拒绝、公网放行）', () => {
    expect(isPrivateIpAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateIpAddress('::ffff:192.168.1.1')).toBe(true);
    expect(isPrivateIpAddress('::ffff:8.8.8.8')).toBe(false);
  });

  it('非 IP 字符串按不安全处理（保守拒绝）', () => {
    expect(isPrivateIpAddress('not-an-ip')).toBe(true);
    expect(isPrivateIpAddress('')).toBe(true);
  });

  it('normalizeFetchUrl：无协议补 https、非 http(s) 拒绝、内嵌凭证拒绝', () => {
    expect(normalizeFetchUrl('example.com/a').toString()).toBe('https://example.com/a');
    expect(() => normalizeFetchUrl('ftp://example.com')).toThrow();
    expect(() => normalizeFetchUrl('javascript:alert(1)')).toThrow();
    expect(() => normalizeFetchUrl('https://user:pass@example.com')).toThrow();
    expect(() => normalizeFetchUrl('  ')).toThrow();
  });

  const okLookup: LookupFn = async (hostname) => [{ address: '93.184.216.34', family: 4 }];

  it('assertSafeTarget：IP 字面量直接判定', async () => {
    await expect(assertSafeTarget(new URL('http://127.0.0.1:8080/'))).rejects.toThrow();
    await expect(assertSafeTarget(new URL('http://169.254.169.254/latest/meta-data'))).rejects.toThrow();
    await expect(assertSafeTarget(new URL('http://[::1]/'))).rejects.toThrow();
    await expect(assertSafeTarget(new URL('http://8.8.8.8/'), okLookup)).resolves.toBeUndefined();
  });

  it('assertSafeTarget：黑名单主机名（localhost / 云元数据域名）', async () => {
    await expect(assertSafeTarget(new URL('http://localhost:7766/'), okLookup)).rejects.toThrow();
    await expect(
      assertSafeTarget(new URL('http://metadata.google.internal/'), okLookup),
    ).rejects.toThrow();
    await expect(
      assertSafeTarget(new URL('http://foo.localhost/'), okLookup),
    ).rejects.toThrow();
  });

  it('assertSafeTarget：域名 DNS 解析进私网段即拒绝（VPN fake-IP 场景）', async () => {
    const privateLookup: LookupFn = async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.5', family: 4 }, // 多地址中有一个私网 → 拒绝
    ];
    await expect(
      assertSafeTarget(new URL('https://example.com/'), privateLookup),
    ).rejects.toThrow(/private network/);
  });

  it('assertSafeTarget：DNS 解析失败拒绝', async () => {
    const failLookup: LookupFn = async () => {
      throw new Error('ENOTFOUND');
    };
    await expect(assertSafeTarget(new URL('https://nx.example.com/'), failLookup)).rejects.toThrow();
  });

  it('assertSafeTarget：公网域名解析通过', async () => {
    await expect(assertSafeTarget(new URL('https://example.com/'), okLookup)).resolves.toBeUndefined();
  });
});

// ============================================================================
// 服务商引擎响应解析（智谱/博查/Tavily）
// ============================================================================

describe('服务商引擎响应解析', () => {
  it('智谱：search_result 字段映射（link→url、content→snippet、media→source）', () => {
    const items = parseZhipuResponse({
      search_result: [
        {
          title: '智谱标题',
          content: '智谱摘要内容',
          link: 'https://example.com/zhipu',
          media: '示例网',
          publish_date: '2026-08-28',
        },
      ],
    });
    expect(items[0]).toEqual({
      title: '智谱标题',
      url: 'https://example.com/zhipu',
      snippet: '智谱摘要内容',
      source: '示例网',
      publishedAt: '2026-08-28',
    });
  });

  it('智谱：error 对象抛 SearchError', () => {
    expect(() =>
      parseZhipuResponse({ error: { code: '401', message: 'invalid api key' } }),
    ).toThrow(SearchError);
  });

  it('博查：webPages.value 字段映射（name→title、summary 优先于 snippet）', () => {
    const items = parseBochaResponse({
      code: 200,
      data: {
        webPages: {
          value: [
            {
              name: '博查标题',
              url: 'https://example.com/bocha',
              snippet: '短摘要',
              summary: '长摘要优先',
              siteName: '博查站',
              datePublished: '2026-08-27T00:00:00+08:00',
            },
            {
              name: '无 summary 条目',
              url: 'https://example.com/b2',
              snippet: '只有 snippet',
            },
          ],
        },
      },
    });
    expect(items[0]?.snippet).toBe('长摘要优先');
    expect(items[0]?.source).toBe('博查站');
    expect(items[1]?.snippet).toBe('只有 snippet');
  });

  it('博查：code != 200 抛 SearchError', () => {
    expect(() => parseBochaResponse({ code: 401, msg: 'bad key' })).toThrow(SearchError);
  });

  it('Tavily：results 映射 + answer 作为 note + source 取 hostname', () => {
    const { items, note } = parseTavilyResponse({
      answer: 'Tavily 生成的总述',
      results: [
        { title: 'Tavily 标题', url: 'https://example.com/a', content: '内容' },
      ],
    });
    expect(note).toBe('Tavily 生成的总述');
    expect(items[0]?.source).toBe('example.com');
    expect(items[0]?.snippet).toBe('内容');
  });
});

// ============================================================================
// 本地引擎解析器（bing / baidu / sogou）—— fixture HTML
// ============================================================================

const BING_HTML = `
<html><body><div id="b_results">
  <li class="b_algo"><h2><a href="https://example.com/1">结果一 标题</a></h2>
    <div class="b_caption"><p>结果一摘要内容</p></div><cite>example.com</cite></li>
  <li class="b_algo"><h2><a href="https://example.com/2">结果二</a></h2>
    <div class="b_caption"><p>结果二摘要</p></div><cite>example.com › path</cite></li>
  <li class="b_ad"><h2><a href="https://ad.example.com/x">广告条目</a></h2></li>
  <li class="b_algo"><h2><a href="https://example.com/1">重复 URL 条目</a></h2></li>
</div></body></html>`;

const BAIDU_HTML = `
<html><body><div id="content_left">
  <div class="result c-container"><h3 class="t"><a href="https://www.baidu.com/link?url=abc">百度结果一</a></h3>
    <div class="c-abstract"><span class="cos-row">百度摘要一</span></div>
    <div class="cosc-source">来源一站</div></div>
  <div class="result c-container"><h3><a href="https://www.example.com/2">百度结果二</a></h3>
    <div class="c-font-normal c-color-text" aria-label="aria 摘要二"></div></div>
  <div class="result-op"><h3>非 http 链接</h3><a href="/relative">x</a></div>
</div></body></html>`;

const SOGOU_HTML = `
<html><body><div id="main">
  <div class="vrwrap"><h3><a href="/link?url=https%3A%2F%2Fexample.com%2Freal1">搜狗结果一</a></h3>
    <div class="str_info">搜狗摘要一</div><cite>example.com</cite></div>
  <div class="vrwrap"><h3><a href="https://www.sogou.com/link?url=https://example.com/real2">搜狗结果二</a></h3>
    <p>搜狗摘要二</p></div>
  <div class="vrwrap"><h3><a href="/link?url=javascript:x">坏链接</a></h3></div>
</div></body></html>`;

describe('本地引擎解析器', () => {
  it('Bing：.b_algo 提取标题/URL/摘要/来源，去重', () => {
    const results = parseBingResults(BING_HTML);
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results[0]).toMatchObject({
      title: '结果一 标题',
      url: 'https://example.com/1',
      snippet: '结果一摘要内容',
      engine: 'bing',
    });
    expect(results[0]?.source).toBe('example.com');
    // 重复 URL 去重：example.com/1 只出现一次
    expect(results.filter((r) => r.url === 'https://example.com/1')).toHaveLength(1);
  });

  it('Bing：反爬页（无结果 + captcha 信号）抛错', () => {
    const blocked = '<html><head><title>请输入验证码</title></head><body><div id="b_captcha"></div></body></html>';
    expect(() => parseBingResults(blocked)).toThrow(/验证|反爬/);
  });

  it('Bing：正常无结果页（无 captcha 信号）返回空数组不抛错', () => {
    const empty = '<html><body><div id="b_results"></div></body></html>';
    expect(parseBingResults(empty)).toEqual([]);
  });

  it('Baidu：#content_left 卡片提取；aria-label 摘要优先', () => {
    const results = parseBaiduResults(BAIDU_HTML);
    expect(results.length).toBe(2);
    expect(results[0]).toMatchObject({
      title: '百度结果一',
      url: 'https://www.baidu.com/link?url=abc',
      snippet: '百度摘要一',
      engine: 'baidu',
    });
    expect(results[1]?.snippet).toBe('aria 摘要二');
  });

  it('Baidu：安全验证页抛错', () => {
    expect(() => parseBaiduResults('<html><body>百度安全验证</body></html>')).toThrow(/安全验证/);
    expect(() => parseBaiduResults('<html><body>wappass.baidu.com captcha</body></html>')).toThrow();
  });

  it('Sogou：跳转链还原真实 URL；相对/绝对形式均可解析', () => {
    const results = parseSogouResults(SOGOU_HTML);
    expect(results.length).toBe(2);
    expect(results[0]).toMatchObject({
      title: '搜狗结果一',
      url: 'https://example.com/real1',
      snippet: '搜狗摘要一',
      engine: 'sogou',
    });
    expect(results[1]?.url).toBe('https://example.com/real2');
    // 无 source 文本时回退 hostname
    expect(results[1]?.source).toBe('example.com');
  });

  it('Sogou：验证码/反爬页抛错', () => {
    expect(() => parseSogouResults('<html><body>请输入验证码</body></html>')).toThrow();
    expect(() => parseSogouResults('<html><body>antispider</body></html>')).toThrow();
  });
});

// ============================================================================
// 本地链回退与 runSearch 降级（mock fetch）
// ============================================================================

function htmlResponse(html: string, headers?: Record<string, string>): Response {
  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html', ...headers },
  });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeParams(overrides: Partial<SearchParams> = {}): SearchParams {
  return {
    query: '测试查询',
    maxResults: 8,
    timeoutMs: 5000,
    ...overrides,
  };
}

const testProvider = (overrides: Partial<SearchProviderRef> = {}): SearchProviderRef => ({
  id: 'provider_test',
  name: '测试智谱',
  searchEngine: 'zhipu',
  apiKey: 'sk-test-key-123456',
  ...overrides,
});

describe('回退与降级', () => {
  it('无默认服务商 → 直接本地链（bing 成功）', async () => {
    const mockFetch = async (url: string) => {
      expect(url).toContain('cn.bing.com');
      return htmlResponse(BING_HTML);
    };
    const outcome = await runSearch(makeParams(), {}, mockFetch);
    expect(outcome.engineKind).toBe('local');
    expect(outcome.engine).toBe('bing');
    expect(outcome.items.length).toBeGreaterThanOrEqual(2);
    expect(outcome.degradedFrom).toBeUndefined();
  });

  it('本地链：bing 被反爬 → 降级 baidu 成功，fallbackFrom 记录原因', async () => {
    const mockFetch = async (url: string) => {
      if (url.includes('cn.bing.com')) {
        return htmlResponse('<html><title>请输入验证码</title><div id="b_captcha"></div></html>');
      }
      if (url.includes('baidu.com')) {
        return htmlResponse(BAIDU_HTML);
      }
      throw new Error(`unexpected url: ${url}`);
    };
    const outcome = await runSearch(makeParams(), {}, mockFetch);
    expect(outcome.engine).toBe('baidu');
    expect(outcome.fallbackFrom).toHaveLength(1);
    expect(outcome.fallbackFrom?.[0]?.engine).toBe('bing');
  });

  it('本地链：全部引擎失败 → LocalSearchError 含逐引擎原因', async () => {
    const mockFetch = async () => htmlResponse('<html><body>empty</body></html>');
    try {
      await runLocalSearch({ query: 'x', maxResults: 5, timeoutMs: 1000, fetchFn: mockFetch });
      throw new Error('should not reach');
    } catch (err) {
      expect(err).toBeInstanceOf(LocalSearchError);
      const e = err as LocalSearchError;
      expect(e.failures).toHaveLength(3);
      expect(e.failures.map((f) => f.engine)).toEqual(['bing', 'baidu', 'sogou']);
    }
  });

  it('默认服务商失败 → 降级本地引擎，标记 degradedFrom', async () => {
    const mockFetch = async (url: string) => {
      if (url.includes('bigmodel.cn')) {
        // 服务商 500 → 触发降级
        return jsonResponse(500, 'server error');
      }
      if (url.includes('cn.bing.com')) {
        return htmlResponse(BING_HTML);
      }
      throw new Error(`unexpected url: ${url}`);
    };
    const outcome = await runSearch(
      makeParams(),
      { provider: testProvider() },
      mockFetch,
    );
    expect(outcome.engineKind).toBe('local');
    expect(outcome.engine).toBe('bing');
    expect(outcome.degradedFrom).toBe('测试智谱');
    expect(outcome.fallbackFrom?.[0]?.engine).toBe('测试智谱');
  });

  it('默认服务商成功 → 不降级，engineKind=provider', async () => {
    const mockFetch = async (url: string) => {
      expect(url).toContain('bigmodel.cn');
      return jsonResponse(200, {
        search_result: [
          { title: 't', content: 's', link: 'https://example.com/x', media: 'm', publish_date: '2026-08-28' },
        ],
      });
    };
    const outcome = await runSearch(
      makeParams(),
      { provider: testProvider() },
      mockFetch,
    );
    expect(outcome.engineKind).toBe('provider');
    expect(outcome.engine).toBe('测试智谱');
    expect(outcome.items).toHaveLength(1);
    expect(outcome.degradedFrom).toBeUndefined();
  });

  it('服务商与本地链全部失败 → all-failed 含双方原因', async () => {
    const mockFetch = async (url: string) => {
      if (url.includes('bigmodel.cn')) {
        return jsonResponse(500, 'server error');
      }
      return htmlResponse('<html><body>empty</body></html>');
    };
    try {
      await runSearch(makeParams(), { provider: testProvider() }, mockFetch);
      throw new Error('should not reach');
    } catch (err) {
      const e = err as SearchError;
      expect(e).toBeInstanceOf(SearchError);
      expect(e.code).toBe('all-failed');
      expect(e.failures).toHaveLength(4); // 服务商 + bing/baidu/sogou
      expect(e.failures[0]?.engine).toBe('测试智谱');
    }
  });

  it('key 脱敏：服务商错误详情中的 key 绝不泄漏到降级记录', async () => {
    const SECRET = 'sk-secret-zhipu-123456';
    // 网关错误体回显 Authorization 头（含 key）→ 降级记录 reason 必须已 redact
    const mockFetch = async (url: string) => {
      if (url.includes('bigmodel.cn')) {
        return jsonResponse(500, `authorized as ${SECRET}`);
      }
      if (url.includes('cn.bing.com')) {
        return htmlResponse(BING_HTML);
      }
      throw new Error(`unexpected url: ${url}`);
    };
    const outcome = await runSearch(
      makeParams(),
      { provider: testProvider({ apiKey: SECRET }) },
      mockFetch,
    );
    const providerFailure = outcome.fallbackFrom?.find((f) => f.engine === '测试智谱');
    expect(providerFailure?.reason).not.toContain(SECRET);
    expect(providerFailure?.reason).toContain('[redacted]');
  });

  it('Tavily 432 配额耗尽 → 降级本地链成功（原因含配额指引）', async () => {
    const mockFetch = async (url: string) => {
      if (url.includes('tavily.com')) {
        return jsonResponse(432, 'monthly quota exceeded');
      }
      if (url.includes('cn.bing.com')) {
        return htmlResponse(BING_HTML);
      }
      throw new Error(`unexpected url: ${url}`);
    };
    const outcome = await runSearch(
      makeParams(),
      { provider: testProvider({ searchEngine: 'tavily', name: '我的Tavily' }) },
      mockFetch,
    );
    expect(outcome.engineKind).toBe('local');
    expect(outcome.degradedFrom).toBe('我的Tavily');
    const reason = outcome.fallbackFrom?.[0]?.reason ?? '';
    expect(reason).toContain('配额');
  });
});
