// scripts/tmp-compaction-e2e.ts
// 压缩流程 E2E：超阈值会话 → compactSession（mock LLM 摘要）→ 标记/摘要消息/历史记录 →
// 发送视图排除 compacted + 含摘要 + env-context 存活 + 配对完整。模拟重启加载语义
//（JSON 序列化往返后 compacted 标记/compactions 保留）。

import { compactSession } from '../src/modules/context/compressor';
import { buildStaticSystemPrompt } from '../src/modules/context/compiler/system-prompt';
import { buildRequestView } from '../src/modules/context/compiler/view-builder';
import { ensureEnvContext } from '../src/modules/context/compiler/env-context';
import { estimateMessagesTokens } from '../src/modules/context/budgeter/estimator';
import { DEFAULT_COMPACTION_CONFIG, DEFAULT_TOOL_PRUNING_CONFIG } from '../src/modules/context/types';
import type { ContextMessage, ContextSessionLike } from '../src/modules/context/types';
import type { LLMRouter } from '../src/modules/contracts';
import type { Environment, Logger } from '../src/core/types';

const env: Environment = {
  platform: 'win32',
  arch: 'x64',
  isWindows: true,
  isMac: false,
  isLinux: false,
  homeDir: 'C:\\Users\\test',
  dataDir: 'C:\\Users\\test\\.moss-test-e2e',
  configDir: 'C:\\Users\\test\\.moss-test-e2e\\config',
  logsDir: 'C:\\Users\\test\\.moss-test-e2e\\logs',
  pidFile: 'C:\\Users\\test\\.moss-test-e2e\\moss.pid',
  runtimeVersion: '1.0.0',
  pid: 12345,
  packageRoot: process.cwd(),
};

const logger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  child: () => logger,
  setLevel: () => {},
  getLevel: () => 'info',
};

let passed = 0;
let failed = 0;
function assert(name: string, cond: boolean): void {
  if (cond) {
    passed++;
    console.log(`PASS ${name}`);
  } else {
    failed++;
    console.error(`FAIL ${name}`);
  }
}

// ===== mock LLM：摘要是七段式结构 =====
const mockSummary = `## 持续事实与约束
- 项目根：C:\\work\\demo，包管理器 npm
- 禁止提交 dist 目录

## 目标
修复登录页在深色模式下的样式问题

## 决策与理由
- 选用 CSS 变量方案：主题切换零重渲染

## 文件与代码
- src/Login.tsx：login() 签名 (user: string) => Promise<void>
- src/theme.css:42 添加 --login-bg 变量

## 命令与结果
- npm run build：通过（12s）

## 错误与修复
- 首次构建 TS2307：补了 types/three.d.ts

## 待办与下一步
- 待验证 Safari；下一步运行 e2e:login`;

let llmCalls = 0;
const mockLlm: LLMRouter = {
  complete: async () => {
    llmCalls++;
    return {
      content: mockSummary,
      finish_reason: 'stop',
      usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 },
    };
  },
  stream: async function* () {
    // 流式未被使用
  },
};

// ===== 构造会话：env-context + 超阈值消息量 =====
const session: ContextSessionLike = {
  id: 'e2e-session',
  messages: [],
  updatedAt: new Date().toISOString(),
};
ensureEnvContext(session, env, 'C:\\work\\demo');

for (let i = 0; i < 60; i++) {
  session.messages.push({ role: 'user', content: `用户请求 ${i}：${'请检查这个功能模块的实现细节。'.repeat(20)}` });
  session.messages.push({
    role: 'assistant',
    content: `处理中 ${i}`,
    toolCalls: [{ id: `c${i}`, name: 'read', arguments: `{"path": "/src/file${i}.ts"}` }],
  });
  session.messages.push({ role: 'tool', content: `文件内容 ${i}：${'export function handler() { return 42; }'.repeat(40)}`, toolCallId: `c${i}`, name: 'read' });
}

const activeBefore = session.messages.filter((m) => !m.deletedAt && !m.compacted);
const beforeTokens = estimateMessagesTokens(activeBefore);
assert('setup: session large enough', beforeTokens > 20000);

async function main(): Promise<void> {
// ===== 压缩执行 =====
const outcome = await compactSession(session, {
  env,
  config: { ...DEFAULT_COMPACTION_CONFIG },
  llm: mockLlm,
  logger,
  staticSystemPrompt: buildStaticSystemPrompt(env, 'C:\\work\\demo', 'test-model', 'Test'),
  summaryModelId: 'test-model',
  summaryModelConfigured: 'inherit',
  windowTokens: 30000, // 小窗口：确保触发有效规划（60组消息远超 16% 尾部）
  trigger: 'auto',
});

assert('compaction: produced record', outcome.record !== null);
const record = outcome.record!;
assert('compaction: llm called once (no retry)', llmCalls === 1);
assert('compaction: compacted count > 0', record.compactedCount > 10);
assert('compaction: after < before', record.afterTokens < record.beforeTokens);
assert('compaction: history recorded', (session.compactions?.length ?? 0) === 1);
assert('compaction: summary is structured', record.summary.includes('## 持续事实与约束'));

// ===== 标记与摘要消息 =====
const compactedCount = session.messages.filter((m) => m.compacted).length;
assert('compaction: messages marked compacted', compactedCount === record.compactedCount);
const summaryMsg = session.messages.find((m) => m.name === 'compaction-summary');
assert('compaction: summary message inserted', summaryMsg !== undefined && summaryMsg.content.includes('<compaction-summary>'));
assert('compaction: summary message not compacted', summaryMsg?.compacted !== true);

// ===== 发送视图：排除 compacted + 含摘要 + env 存活 + 配对完整 =====
const systemPrompt = buildStaticSystemPrompt(env, 'C:\\work\\demo', 'test-model', 'Test');
const view = buildRequestView(session, systemPrompt, { toolPruning: DEFAULT_TOOL_PRUNING_CONFIG });
const viewContents = view.messages.map((m) => m.content);
assert('view: compacted excluded', !viewContents.some((c) => c.startsWith('用户请求 0：')));
assert('view: summary included', viewContents.some((c) => c.includes('<compaction-summary>')));
assert('view: env-context survives', view.messages.some((m) => m.name === 'env-context'));
assert('view: recent tail verbatim', viewContents.some((c) => c.startsWith('用户请求 59：')));
assert('view: breakdown summary tokens > 0', view.breakdown.summary > 0);
assert('view: breakdown history < before', view.breakdown.history < beforeTokens);

// tool 配对完整：视图里每个带 toolCalls 的 assistant 后面紧跟 tool 结果
let pairOk = true;
for (let i = 0; i < view.messages.length; i++) {
  const m = view.messages[i];
  if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
    const next = view.messages[i + 1];
    if (!next || next.role !== 'tool' || next.toolCallId !== m.toolCalls[0].id) {
      pairOk = false;
      break;
    }
  }
}
assert('view: tool_use/result pairs intact', pairOk);

// ===== 模拟重启：JSON 往返后标记/历史保留（持久化语义） =====
const persisted = JSON.parse(JSON.stringify(session)) as ContextSessionLike;
assert('persistence: compacted flags survive', persisted.messages.filter((m) => m.compacted).length === record.compactedCount);
assert('persistence: compactions survive', (persisted.compactions?.length ?? 0) === 1);
assert('persistence: summary message survives', persisted.messages.some((m) => m.name === 'compaction-summary'));
const view2 = buildRequestView(persisted, systemPrompt, { toolPruning: DEFAULT_TOOL_PRUNING_CONFIG });
assert('persistence: view identical semantics', view2.messages.length === view.messages.length);

// ===== 二次压缩：旧摘要并入新摘要 =====
for (let i = 100; i < 160; i++) {
  session.messages.push({ role: 'user', content: `第二轮请求 ${i}：${'继续迭代新功能。'.repeat(20)}` });
  session.messages.push({
    role: 'assistant',
    content: `二轮处理 ${i}`,
    toolCalls: [{ id: `d${i}`, name: 'grep', arguments: '{"pattern":"handler"}' }],
  });
  session.messages.push({ role: 'tool', content: `搜索结果 ${i}：${'src/a.ts:10: handler'.repeat(30)}`, toolCallId: `d${i}`, name: 'grep' });
}
const outcome2 = await compactSession(session, {
  env,
  config: { ...DEFAULT_COMPACTION_CONFIG },
  llm: mockLlm,
  logger,
  staticSystemPrompt: systemPrompt,
  summaryModelId: 'test-model',
  summaryModelConfigured: 'inherit',
  windowTokens: 30000,
  trigger: 'auto',
});
assert('second compaction: ok', outcome2.record !== null);
const allSummaries = session.messages.filter((m) => m.name === 'compaction-summary');
assert('second compaction: old summary compacted', allSummaries.length === 2 && allSummaries.filter((m) => m.compacted).length === 1);
const activeSummaries = session.messages.filter((m) => m.name === 'compaction-summary' && !m.compacted);
assert('second compaction: exactly one active summary', activeSummaries.length === 1);
assert('second compaction: history has 2 records', (session.compactions?.length ?? 0) === 2);
}

void main().then(() => {
  console.log(`\n===== ${passed} passed, ${failed} failed =====`);
  process.exit(failed > 0 ? 1 : 0);
});
