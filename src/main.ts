#!/usr/bin/env bun
// src/main.ts
// MOSS CLI 入口。

import { parseArgs, runCommand } from './cli/commands';

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv);
  const code = await runCommand(parsed);
  if (code !== 0) {
    process.exit(code);
  }
  // 0 退出码：start --foreground 保持运行（不退出），其他命令成功完成
  // start --foreground 的 runCommand 返回永不 resolve 的 Promise，不会走到这里
}

main().catch(err => {
  console.error('Fatal error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
