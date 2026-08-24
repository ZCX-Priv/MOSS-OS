// src/modules/context/file-index/graph-engine/extract.ts
// 符号与 import 提取：语言无关注节点类型映射表 + TS/JS/Python/Go 精细规则。
// 提取精度分层：全语言符号定义 + import 语句；import 目标解析（相对路径补全，
// 解析失败丢弃不猜）。调用图/继承需作用域分析，第一版不做（避免虚报）。

import type { GraphImportEdge, GraphSymbol, SymbolKind } from '../types';
import { parseSource, langOfExt, type ParseNode } from './parser';

/** 节点类型 → 符号类型（语言无关映射） */
const SYMBOL_NODE_TYPES: Readonly<Record<string, SymbolKind>> = {
  // TS / JS
  function_declaration: 'function',
  generator_function_declaration: 'function',
  function_signature: 'function',
  class_declaration: 'class',
  abstract_class_declaration: 'class',
  method_definition: 'method',
  abstract_method_signature: 'method',
  interface_declaration: 'interface',
  type_alias_declaration: 'type',
  enum_declaration: 'enum',
  // Python
  function_definition: 'function',
  class_definition: 'class',
  // Go / Java（function_declaration 与 TS/JS 共用键，见上）
  method_declaration: 'method',
  // C / C++ / Rust
  struct_specifier: 'class',
  trait_item: 'interface',
};

/** 提取符号名（优先字段名，回退首个 identifier 子节点） */
function symbolName(node: ParseNode): string | null {
  const byField = node.childForFieldName('name');
  if (byField) return byField.text;
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (!c) continue;
    if (c.type === 'identifier' || c.type === 'type_identifier' || c.type === 'property_identifier' || c.type === 'field_identifier') {
      return c.text;
    }
  }
  return null;
}

/** 节点签名（首行文本，截断 160） */
function signatureOf(node: ParseNode, source: string): string {
  const nl = source.indexOf('\n', node.startIndex);
  const end = nl === -1 ? node.endIndex : Math.min(nl, node.endIndex);
  const sig = source.slice(node.startIndex, end).trim();
  return sig.length > 160 ? `${sig.slice(0, 160)}…` : sig;
}

/** 顶层容器节点类型（program/module/source_file 等各语言根与文件体；export_statement 为 TS/JS 导出包裹层） */
const TOP_CONTAINER_TYPES = new Set([
  'program', 'module', 'source_file', 'translation_unit', 'export_statement',
]);

/** 成员容器节点类型（类体/接口体/对象体等：方法与成员定义的直接父节点） */
const MEMBER_CONTAINER_TYPES = new Set([
  'class_body', 'class_declaration', 'interface_declaration', 'abstract_class_declaration',
  'object_body', 'declaration_list', 'block', 'decorated_definition',
]);

/**
 * 是否值得提取符号的容器上下文：按父节点类型判断（跨语言稳健，
 * 不依赖 AST 层级——method_definition 位于 class_body 下第三层）。
 */
function inSymbolContext(parentType: string | null): boolean {
  if (parentType === null) return true;
  return TOP_CONTAINER_TYPES.has(parentType) || MEMBER_CONTAINER_TYPES.has(parentType);
}

/** 递归遍历提取符号（限深 4，防深嵌套爆炸） */
function collectSymbols(node: ParseNode, source: string, out: GraphSymbol[], depth: number, parentType: string | null): void {
  const kind = SYMBOL_NODE_TYPES[node.type];
  if (kind && inSymbolContext(parentType)) {
    const name = symbolName(node);
    if (name) {
      out.push({
        file: '',
        name,
        kind,
        line: node.startPosition.row + 1,
        col: node.startPosition.column + 1,
        endLine: node.endPosition.row + 1,
        signature: signatureOf(node, source),
      });
    }
  }
  if (depth >= 4) return;
  // Python decorated_definition：下钻一层取内层定义
  if (node.type === 'decorated_definition') {
    const inner = node.namedChild(0);
    if (inner) collectSymbols(inner, source, out, depth, node.type);
    return;
  }
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child) collectSymbols(child, source, out, depth + 1, node.type);
  }
}

// ============================================================================
// import 提取
// ============================================================================

/** TS/JS import 源字符串（'./foo'、'react' 等；export ... from 同样算依赖） */
function tsImportSources(root: ParseNode): string[] {
  const out: string[] = [];
  for (const n of root.descendantsOfType(['import_statement', 'export_statement'])) {
    // import x from './foo' / export { x } from './foo'：首个 string 字面量即模块源
    // 无 from 的纯 export（export const x = ...）不含 string，自然跳过
    const strs = n.descendantsOfType(['string']);
    if (strs.length === 0) continue;
    const s = strs[0].text;
    out.push(s.slice(1, -1));
  }
  return out;
}

/** Python import 源（import a.b → 'a.b'；from a import b → 'a'） */
function pyImportSources(root: ParseNode): string[] {
  const out: string[] = [];
  for (const n of root.descendantsOfType(['import_statement'])) {
    // dotted_name 序列（import a, b → 两条）
    for (const d of n.descendantsOfType(['dotted_name'])) {
      out.push(d.text);
      break; // import_statement 每个模块一个 dotted_name（多模块由多个 statement 或 comma 分隔子节点承载，取首层即可）
    }
  }
  for (const n of root.descendantsOfType(['import_from_statement'])) {
    const dotted = n.descendantsOfType(['relative_import', 'dotted_name']);
    if (dotted.length > 0) out.push(dotted[0].text);
  }
  return out;
}

/** Go import 源（import_spec 的 interpreted_string_literal） */
function goImportSources(root: ParseNode): string[] {
  const out: string[] = [];
  for (const n of root.descendantsOfType(['import_spec'])) {
    const strs = n.descendantsOfType(['interpreted_string_literal']);
    if (strs.length === 0) continue;
    const s = strs[0].text;
    out.push(s.slice(1, -1));
  }
  return out;
}

/** import 源字符串提取（语言分派） */
function extractImportSources(lang: string, root: ParseNode): string[] {
  switch (lang) {
    case 'typescript':
    case 'tsx':
    case 'javascript':
      return tsImportSources(root);
    case 'python':
      return pyImportSources(root);
    case 'go':
      return goImportSources(root);
    default:
      return [];
  }
}

// ============================================================================
// import 目标解析（相对路径 → 真实文件）
// ============================================================================

/** 相对 import 补全候选扩展名/索引文件（按语言优先级排列） */
const RESOLVE_EXTENSIONS = [
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts',
  '.py', '.go', '.rs', '.json', '',
];
const RESOLVE_INDEX = ['index.ts', 'index.tsx', 'index.js', 'index.jsx', '__init__.py'];

/**
 * 解析 import 源字符串为项目内真实文件。
 * 仅处理相对路径（./ ../）；非相对（包名/别名）返回 null。
 * @param fileSet 项目内全部已知文件 pathKey 集合（小写正斜杠）
 */
export function resolveImportSource(specifier: string, fromFile: string, fileSet: Set<string>): string | null {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return null;
  // fromFile 目录 + specifier 归一化
  const dir = fromFile.includes('/') ? fromFile.slice(0, fromFile.lastIndexOf('/')) : '';
  const combined = normalizeRel(`${dir}/${specifier}`);
  if (!combined) return null;
  // 1) 直接补全扩展名
  for (const ext of RESOLVE_EXTENSIONS) {
    const cand = `${combined}${ext}`.toLowerCase();
    if (fileSet.has(cand)) return `${combined}${ext}`;
  }
  // 2) 目录索引文件
  for (const idx of RESOLVE_INDEX) {
    const cand = `${combined}/${idx}`.toLowerCase();
    if (fileSet.has(cand)) return `${combined}/${idx}`;
  }
  return null;
}

/** 相对路径归一化（消解 ./ ../；越界返回 null） */
function normalizeRel(p: string): string | null {
  const parts = p.split('/');
  const stack: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (stack.length === 0) return null;
      stack.pop();
    } else {
      stack.push(part);
    }
  }
  return stack.join('/');
}

// ============================================================================
// 提取入口
// ============================================================================

export interface ExtractionResult {
  symbols: GraphSymbol[];
  /** import 边（目标已解析为真实文件；未解析成功的丢弃） */
  imports: GraphImportEdge[];
  /** 语言不可用/解析失败 */
  skipped: boolean;
}

/**
 * 解析并提取单文件符号与 import 边。
 * @param relFile 文件相对路径（正斜杠）
 * @param ext 小写扩展名（含点）
 * @param source 源码文本
 * @param fileSet 项目文件 pathKey 集合（import 解引用用）
 */
export async function extractFile(relFile: string, ext: string, source: string, fileSet: Set<string>): Promise<ExtractionResult> {
  const lang = langOfExt(ext);
  if (!lang) return { symbols: [], imports: [], skipped: true };

  const root = await parseSource(lang, source);
  if (!root) return { symbols: [], imports: [], skipped: true };

  const symbols: GraphSymbol[] = [];
  collectSymbols(root, source, symbols, 0, null);
  for (const s of symbols) s.file = relFile;

  const imports: GraphImportEdge[] = [];
  for (const spec of extractImportSources(lang, root)) {
    const dst = resolveImportSource(spec, relFile, fileSet);
    if (dst) imports.push({ src: relFile, dst });
  }
  return { symbols, imports, skipped: false };
}
