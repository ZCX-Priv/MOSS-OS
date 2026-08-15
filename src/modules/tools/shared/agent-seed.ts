// src/modules/tools/shared/agent-seed.ts
// agent/ 提示词目录播种：首次运行时从 <packageRoot>/agent/ 递归复制到 ~/.moss/agent/。
// 之后运行时只动态读取 ~/.moss/agent/（不依赖包内目录，无需编译进程序）。
// 幂等：目标目录已存在则跳过（用户已初始化，不覆盖其修改/删除）。

import { cpSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Environment } from '../../../core/types';

/** 是否已执行过本次进程内的播种检查（幂等加速：stat 代价低，但避免重复日志） */
let seeded = false;

/**
 * 播种内置 agent 提示词到 ~/.moss/agent/。
 * 失败不阻断启动（静默降级，调用方各自处理目录缺失场景）。
 */
export function seedBuiltinAgentPrompts(env: Environment): boolean {
  if (seeded) return true;
  const src = join(env.packageRoot, 'agent');
  const dest = join(env.dataDir, 'agent');
  try {
    if (existsSync(dest)) {
      seeded = true;
      return true;
    }
    if (!existsSync(src)) {
      // 无种子源（异常安装），跳过；调用方回退到各自默认逻辑
      seeded = true;
      return false;
    }
    cpSync(src, dest, { recursive: true });
    seeded = true;
    return true;
  } catch {
    // 播种失败不阻断，返回 false 让调用方走兜底
    return false;
  }
}
