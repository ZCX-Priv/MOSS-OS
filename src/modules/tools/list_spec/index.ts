// tools/list_spec/index.ts
// list_spec 工具 execute 逻辑：列出所有可用的 spec 规范文件，以文件树形式展示。
// 元数据见同目录 tool.json。

import type { ToolContext, ToolResult } from '../types';
import { ServiceNames } from '../../../core/types';
import type { Spec, SpecRegistry } from '../get_spec/registry';

export default {
  async execute(_params: unknown, ctx: ToolContext): Promise<ToolResult> {
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
  spec?: Spec;
  children: Map<string, TreeNode>;
}

function renderSpecTree(specs: Spec[]): string {
  const root: TreeNode = { name: '', children: new Map() };

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
      const desc = child.spec.description || '(no description)';
      lines.push(`${prefix}${connector}${child.name}.md — ${desc}`);
      if (hasChildren) {
        renderNode(child, childPrefix, lines);
      }
    } else {
      lines.push(`${prefix}${connector}${child.name}/`);
      renderNode(child, childPrefix, lines);
    }
  }
}
