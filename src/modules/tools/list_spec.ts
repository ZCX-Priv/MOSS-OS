// src/modules/tools/list_spec.ts
// list_spec 工具：列出所有可用的 spec 规范文件，以文件树形式展示。
// Spec 来自 agent/prompts/main/spec/ 目录（支持子文件夹）。

import type { Tool, ToolResult } from './types';
import { ServiceNames } from '../../core/types';
import type { Spec, SpecRegistry } from './specs';

export const listSpecTool: Tool = {
  name: 'list_spec',
  description:
    'List all available specification files as a tree. ' +
    'Specs live in agent/prompts/main/spec/ and may be organized in subfolders. ' +
    'Each spec id is its relative path without the .md extension (e.g. "coding/typescript"). ' +
    'Use this to discover what specs are available before reading one with get_spec.',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
  },
  icon: 'book-open',
  async execute(_params, ctx): Promise<ToolResult> {
    const reg = ctx.services.tryResolve<SpecRegistry>(ServiceNames.SPEC_REGISTRY);
    if (!reg) {
      return {
        content: [{ type: 'text', text: 'Error: spec registry not available' }],
        isError: true,
      };
    }

    const specs = reg.list();
    if (specs.length === 0) {
      return {
        content: [
          { type: 'text', text: '(no specs available. Add .md files to agent/prompts/main/spec/)' },
        ],
        metadata: { count: 0 },
      };
    }

    const tree = renderSpecTree(specs);
    return {
      content: [{ type: 'text', text: tree }],
      metadata: { count: specs.length },
    };
  },
};

// ============================================================================
// 树形渲染
// ============================================================================

interface TreeNode {
  name: string;
  /** 叶子节点对应的 spec（该路径是一个 .md 文件） */
  spec?: Spec;
  children: Map<string, TreeNode>;
}

/** 将扁平 spec 列表构建为嵌套树，并渲染为带缩进的文本 */
function renderSpecTree(specs: Spec[]): string {
  const root: TreeNode = { name: '', children: new Map() };

  // 构建树
  for (const spec of specs) {
    const parts = spec.id.split('/');
    let cur = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      let child = cur.children.get(part);
      if (!child) {
        child = { name: part, children: new Map() };
        cur.children.set(part, child);
      }
      cur = child;
      if (i === parts.length - 1) {
        cur.spec = spec;
      }
    }
  }

  const lines: string[] = ['spec/'];
  renderNode(root, '', lines);
  return lines.join('\n');
}

function renderNode(node: TreeNode, prefix: string, lines: string[]): void {
  const entries = Array.from(node.children.values()).sort((a, b) => {
    // 目录在前，文件在后；同类按字母序
    const aIsDir = a.children.size > 0;
    const bIsDir = b.children.size > 0;
    if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  for (let i = 0; i < entries.length; i++) {
    const child = entries[i];
    const isLast = i === entries.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    const childPrefix = prefix + (isLast ? '    ' : '│   ');

    const hasChildren = child.children.size > 0;
    if (child.spec) {
      // 叶子文件（或同时是文件和目录的罕见情况）
      const desc = child.spec.description || '(no description)';
      lines.push(`${prefix}${connector}${child.name}.md — ${desc}`);
      if (hasChildren) {
        renderNode(child, childPrefix, lines);
      }
    } else {
      // 纯目录
      lines.push(`${prefix}${connector}${child.name}/`);
      renderNode(child, childPrefix, lines);
    }
  }
}
