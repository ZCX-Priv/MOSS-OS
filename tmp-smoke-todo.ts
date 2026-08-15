// 一次性冒烟脚本：验证 todo 工具 create 双模式 + delete 移除（跑完即删）
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import createExecute from './src/modules/tools/builtin/todo/index';
import type { Environment } from './src/core/types';
import type { ToolContext } from './src/modules/tools/types';

const tmp = mkdtempSync(join(tmpdir(), 'moss-todo-smoke-'));
const env = { dataDir: tmp } as Environment;
const ctx = { sessionId: 'smoke-test' } as ToolContext;
const { execute } = createExecute(env);
const storeFile = join(tmp, 'todo', 'smoke-test.json');

let failed = 0;
function check(name: string, cond: boolean, extra = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!cond) failed += 1;
}

// 1. 默认 append 新建两条
const r1 = await execute({ action: 'create', text: 'task A' }, ctx);
const r2 = await execute({ action: 'create', text: 'task B', priority: 'high' }, ctx);
check('append default creates id=1', r1.content[0].type === 'text' && r1.content[0].text.includes('id=1'));
check('append metadata mode=append', (r1.metadata as Record<string, string>).mode === 'append');
check('append second creates id=2', r2.content[0].type === 'text' && r2.content[0].text.includes('id=2'));

// 2. replace：1 项带旧 id "1"，2 项无 id → 覆盖为 3 条
const r3 = await execute({ action: 'create', mode: 'replace', items: [
  { id: '1', text: 'task A (revised)', status: 'completed' },
  { text: 'task C' },
  { text: 'task D', priority: 'low' },
] }, ctx);
const stored3 = JSON.parse(readFileSync(storeFile, 'utf8')) as { nextId: number; items: Array<{ id: string }> };
const ids3 = stored3.items.map(i => i.id);
check('replace returns 3 items', (r3.metadata as Record<string, number>).count === 3);
check('replace keeps provided id "1"', ids3[0] === '1');
check('replace assigns fresh ids without collision', new Set(ids3).size === 3 && ids3.slice(1).every(id => id !== '1'));
check('replace bumps nextId beyond max', stored3.nextId === Math.max(...ids3.map(Number)) + 1, `nextId=${stored3.nextId} ids=${JSON.stringify(ids3)}`);

// 3. replace 空数组 → 报错
const r4 = await execute({ action: 'create', mode: 'replace', items: [] }, ctx);
check('replace empty items rejected', r4.isError === true);

// 4. replace 缺 text → 报错
const r5 = await execute({ action: 'create', mode: 'replace', items: [{ text: 'ok' }, { text: '  ' }] }, ctx);
check('replace blank text rejected', r5.isError === true && r5.content[0].type === 'text' && r5.content[0].text.includes('items[1]'));

// 5. 旧 delete 入参 → unknown action
const r6 = await execute({ action: 'delete', id: '1' }, ctx);
check('delete action now unknown', r6.isError === true && r6.content[0].type === 'text' && r6.content[0].text.includes('unknown action "delete"'));

// 6. list 反映覆盖后清单
const r7 = await execute({ action: 'list' }, ctx);
check('list reflects replaced store', r7.content[0].type === 'text' && r7.content[0].text.includes('task A (revised)') && !r7.content[0].text.includes('task B'));

rmSync(tmp, { recursive: true, force: true });
console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
