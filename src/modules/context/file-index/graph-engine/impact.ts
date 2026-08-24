// src/modules/context/file-index/graph-engine/impact.ts
// 影响面分析：上游（谁 import 我）+ 下游（我 import 谁）+ 文件符号清单。
// 渲染为紧凑中文文本（edit/write 工具结果附加段，≤10 文件、受 token 预算控制）。

import type { ImpactResult } from '../types';
import type { GraphStore, SymbolRow } from './store';

const MAX_FILES = 10;
const MAX_LINE_CHARS = 120;

/** 结构化影响面查询 */
export function queryImpact(store: GraphStore, pathKey: string): ImpactResult {
  const upstream = store.upstream(pathKey);
  const downstream = store.downstream(pathKey);
  const symbols = store.fileSymbols(pathKey).map(s => ({
    name: s.name,
    kind: s.kind as ImpactResult['symbols'][number]['kind'],
    line: s.line,
  }));
  return { upstream, downstream, symbols };
}

/**
 * 渲染影响面为紧凑文本（追加到 edit/write 工具结果）。
 * 图谱无该文件数据 / 无上下游 / 无符号 → 返回 null（零噪音）。
 */
export function renderImpactText(impact: ImpactResult): string | null {
  const parts: string[] = [];
  const upstream = impact.upstream.slice(0, MAX_FILES);
  if (upstream.length > 0) {
    const more = impact.upstream.length > MAX_FILES ? ` 等 ${impact.upstream.length} 个文件` : '';
    parts.push(`此文件被 ${impact.upstream.length} 个文件导入${more}：${upstream.join('、')}`);
  }
  if (impact.symbols.length > 0) {
    const sig = impact.symbols
      .slice(0, 8)
      .map(s => `${s.name}(${s.kind},L${s.line})`)
      .join('、');
    parts.push(`文件内符号：${sig}${impact.symbols.length > 8 ? ' …' : ''}`);
  }
  if (parts.length === 0) return null;
  const note = impact.upstream.length > 0 ? '修改导出内容时请同步检查上述文件。' : '';
  const text = `[影响面] ${parts.join('；')}。${note}`;
  return text.length > MAX_LINE_CHARS * 4 ? `${text.slice(0, MAX_LINE_CHARS * 4)}…` : text;
}

/** 文件符号首行摘要（read 场景轻量注入用，可选） */
export function renderSymbolDigest(symbols: SymbolRow[]): string | null {
  if (symbols.length === 0) return null;
  const top = symbols
    .slice(0, 12)
    .map(s => `${s.name}(${s.kind},L${s.line})`)
    .join('、');
  return `[文件符号] ${top}${symbols.length > 12 ? ' …' : ''}`;
}
