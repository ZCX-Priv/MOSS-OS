// scripts/tmp-cache-test.ts
// 缓存对齐验证：同一会话连续两轮请求的公共前缀必须字节级一致（KV-cache 命中条件）；
// system prompt 必须不含时间类动态变量。

import { buildStaticSystemPrompt } from '../src/modules/context/compiler/system-prompt';
import { buildRequestView } from '../src/modules/context/compiler/view-builder';
import { ensureEnvContext } from '../src/modules/context/compiler/env-context';
import type { ContextMessage, ContextSessionLike } from '../src/modules/context/types';
import type { Environment } from '../src/core/types';

const env: Environment = {
  platform: 'win32',
  arch: 'x64',
  isWindows: true,
  isMac: false,
  isLinux: false,
  homeDir: 'C:\\Users\\test',
  dataDir: 'C:\\Users\\test\\.moss-test-cache',
  configDir: 'C:\\Users\\test\\.moss-test-cache\\config',
  logsDir: 'C:\\Users\\test\\.moss-test-cache\\logs',
  pidFile: 'C:\\Users\\test\\.moss-test-cache\\moss.pid',
  runtimeVersion: '1.0.0',
  pid: 12345,
  packageRoot: process.cwd(),
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

// ===== 1. 静态系统提示词确定性 =====
{
  const a = buildStaticSystemPrompt(env, 'C:\\work', 'deepseek-chat', 'DeepSeek V3');
  const b = buildStaticSystemPrompt(env, 'C:\\work', 'deepseek-chat', 'DeepSeek V3');
  assert('system prompt: deterministic', a === b);
  assert('system prompt: no cur_time', !a.includes('{{cur_time') && !/cur_datetime|cur_date|cur_time/.test(a));
  assert('system prompt: no battery', !a.includes('battery_level'));
}

// ===== 2. 前缀字节一致性（追加消息场景） =====
{
  const session: ContextSessionLike = {
    id: 's1',
    messages: [],
    updatedAt: new Date().toISOString(),
  };
  ensureEnvContext(session, env, 'C:\\work');
  session.messages.push({ role: 'user', content: '第一轮问题', timestamp: new Date().toISOString() });
  session.messages.push({ role: 'assistant', content: '第一轮回答', timestamp: new Date().toISOString() });

  const systemPrompt = buildStaticSystemPrompt(env, 'C:\\work', 'deepseek-chat', 'DeepSeek V3');
  const pruning = { enabled: true, thresholdChars: 8192, keepHeadChars: 4096, keepTailChars: 1024 };

  const view1 = buildRequestView(session, systemPrompt, { toolPruning: pruning });
  // 第二轮：追加一条用户消息（前缀不得变化）
  session.messages.push({ role: 'user', content: '第二轮问题', timestamp: new Date().toISOString() });
  const view2 = buildRequestView(session, systemPrompt, { toolPruning: pruning });

  // view1 的全部消息必须是 view2 的前缀（逐条比对 role/content/name/toolCallId）
  let prefixOk = view1.messages.length <= view2.messages.length;
  for (let i = 0; i < view1.messages.length && prefixOk; i++) {
    const m1 = view1.messages[i];
    const m2 = view2.messages[i];
    if (m1.role !== m2.role || m1.content !== m2.content || m1.name !== m2.name || m1.toolCallId !== m2.toolCallId) {
      prefixOk = false;
    }
  }
  assert('prefix stability: append-only extension', prefixOk);
  assert('prefix stability: view2 grew by exactly 1', view2.messages.length === view1.messages.length + 1);
  assert('env-context anchored at head', view1.messages[1]?.name === 'env-context');

  // ===== 3. 工具结果修剪不破坏前缀 =====
  session.messages.push({
    role: 'assistant',
    content: '读一下大文件',
    toolCalls: [{ id: 'c1', name: 'read', arguments: '{"path":"/a"}' }],
    timestamp: new Date().toISOString(),
  });
  session.messages.push({
    role: 'tool',
    content: 'x'.repeat(10000),
    toolCallId: 'c1',
    name: 'read',
    timestamp: new Date().toISOString(),
  });
  const view3 = buildRequestView(session, systemPrompt, { toolPruning: pruning });
  const toolMsg = view3.messages.find(m => m.role === 'tool' && m.toolCallId === 'c1');
  assert('tool pruning: view pruned, original intact', (toolMsg?.content.length ?? 0) < 10000 && session.messages[session.messages.length - 1].content.length === 10000);

  // ===== 4. compacted 消息排除 + 摘要注入 =====
  session.messages[1].compacted = true; // 压缩 env-context 之后的第一条 user（模拟）
  session.messages.splice(2, 0, {
    role: 'user',
    name: 'compaction-summary',
    content: '<compaction-summary>\n摘要内容\n</compaction-summary>',
    timestamp: new Date().toISOString(),
  });
  const view4 = buildRequestView(session, systemPrompt, { toolPruning: pruning });
  const compactedInView = view4.messages.some(m => m.content === '第一轮问题');
  const summaryInView = view4.messages.some(m => m.name === 'compaction-summary');
  const envInView = view4.messages.some(m => m.name === 'env-context');
  assert('view: compacted excluded', !compactedInView);
  assert('view: summary included', summaryInView);
  assert('view: env-context survives compaction', envInView);
}

console.log(`\n===== ${passed} passed, ${failed} failed =====`);
process.exit(failed > 0 ? 1 : 0);
