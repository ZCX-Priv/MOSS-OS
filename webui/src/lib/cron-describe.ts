// webui/src/lib/cron-describe.ts
// cron 表达式 → 用户可读的自然语言描述（面向用户，全站不显示原始 cron）。
// 策略：常见预设模式（每天/每小时/每N分钟/每周X/每周区间/每月N日）自产精准文案，
// 覆盖不到的表达式用 cronstrue 兜底（zh_CN / en）。

import cronstrue from 'cronstrue/i18n';

export type CronLocale = 'zh' | 'en';

const WEEKDAYS_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const WEEKDAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** "9:5" → "09:05" */
function hhmm(h: string, m: string): string {
  return `${pad2(Number(h))}:${pad2(Number(m))}`;
}

/** cron 的 dow 字段（0-6，0 与 7 均为周日）→ 0-6 */
function normDow(v: string): number {
  return Number(v) % 7;
}

/**
 * 将 5 字段 cron 表达式转为自然语言。
 * 解析失败时原样返回（调用方展示占位）。
 */
export function describeCron(cron: string, locale: CronLocale): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const [m, h, dom, mon, dow] = parts;
  const zh = locale === 'zh';

  // 月限定/复杂表达式交由 cronstrue 兜底；自有模式仅覆盖 mon === '*'
  if (mon === '*') {
    const time = hhmm(h, m);
    const isNumM = /^\d+$/.test(m);
    const isNumH = /^\d+$/.test(h);

    // 每天 HH:mm
    if (dom === '*' && dow === '*' && isNumM && isNumH) {
      return zh ? `每天 ${time}` : `Every day at ${time}`;
    }
    // 每小时第 m 分钟
    if (dom === '*' && dow === '*' && h === '*' && isNumM) {
      return zh ? `每小时第 ${Number(m)} 分钟` : `Every hour at minute ${Number(m)}`;
    }
    // 每 N 分钟
    const stepM = m.match(/^\*\/(\d+)$/);
    if (stepM && dom === '*' && dow === '*' && h === '*') {
      return zh ? `每 ${stepM[1]} 分钟` : `Every ${stepM[1]} minutes`;
    }
    // 每周X HH:mm（单日）
    if (dom === '*' && isNumH && isNumM && /^\d+$/.test(dow)) {
      const w = normDow(dow);
      return zh ? `每${WEEKDAYS_ZH[w]} ${time}` : `Every ${WEEKDAYS_EN[w]} at ${time}`;
    }
    // 每周X至Y HH:mm
    const dowRange = dow.match(/^(\d+)-(\d+)$/);
    if (dom === '*' && isNumH && isNumM && dowRange) {
      const a = normDow(dowRange[1]);
      const b = normDow(dowRange[2]);
      return zh
        ? `每${WEEKDAYS_ZH[a]}至${WEEKDAYS_ZH[b]} ${time}`
        : `${WEEKDAYS_EN[a]} through ${WEEKDAYS_EN[b]} at ${time}`;
    }
    // 每月 N 日 HH:mm
    if (dow === '*' && isNumH && isNumM && /^\d+$/.test(dom)) {
      return zh ? `每月 ${Number(dom)} 日 ${time}` : `On day ${Number(dom)} of every month at ${time}`;
    }
  }

  // 兜底：cronstrue（覆盖多值/范围/步进等复杂表达式）
  try {
    return cronstrue.toString(cron, {
      locale: zh ? 'zh_CN' : 'en',
      use24HourTimeFormat: true,
      throwExceptionOnParseError: false,
    });
  } catch {
    return cron;
  }
}
