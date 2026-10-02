// render/diagram/MermaidDiagram.tsx
// Mermaid 图表：懒加载 mermaid（securityLevel:'strict' 防 XSS），主题随项目亮暗切换
// （mermaid 不支持 CSS 换主题，主题变化时重渲一次）。渲染失败回退显示源码 + 错误条。
//
// 调用方（CodeBlock）保证仅在块闭合后挂载本组件 —— 流式中不会反复成图，无闪烁。

import { useEffect, useId, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { useDarkMode } from '../core/use-dark-mode';

export interface MermaidDiagramProps {
  code: string;
}

/**
 * 成图结果缓存（key = `${dark}\u0000${code}`）：
 * 再次进入同一会话时首帧即拿到 SVG（useState 初值），不再先出 loading 占位再替换。
 */
const svgCache = new Map<string, string>();
function svgKey(code: string, dark: boolean): string {
  return `${dark ? '1' : '0'}\u0000${code}`;
}

export function MermaidDiagram({ code }: MermaidDiagramProps) {
  const reactId = useId().replace(/[^a-zA-Z0-9]/g, '');
  const dark = useDarkMode();
  // 结果连同「来源 code/dark」一起存：块内容或主题变化时旧结果自动失效
  const [rendered, setRendered] = useState<{ code: string; dark: boolean; svg: string } | null>(() => {
    const cached = svgCache.get(svgKey(code, dark));
    return cached !== undefined ? { code, dark, svg: cached } : null;
  });
  const [error, setError] = useState<string | null>(null);
  const svg = rendered && rendered.code === code && rendered.dark === dark ? rendered.svg : null;

  useEffect(() => {
    if (svg !== null) return; // 缓存命中：首帧即成图，无需再渲染
    let cancelled = false;
    setError(null);
    import('mermaid')
      .then(async (mermaid) => {
        // initialize 可重复调用（更新配置）；主题随亮暗切换重渲
        mermaid.default.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: dark ? 'dark' : 'default',
        });
        const { svg: out } = await mermaid.default.render(`mmd-${reactId}`, code);
        if (!cancelled) {
          svgCache.set(svgKey(code, dark), out);
          setRendered({ code, dark, svg: out });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setRendered(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [code, reactId, dark, svg]);

  if (error !== null) {
    return (
      <div className="mermaid-error my-3 rounded-md border border-destructive/40 bg-destructive/5 p-3">
        <div className="flex items-center gap-1.5 text-xs text-destructive">
          <TriangleAlert className="size-3.5" />
          <span>Mermaid render failed: {error}</span>
        </div>
        <pre className="mt-2 overflow-x-auto font-mono text-[12px] text-muted-foreground">{code}</pre>
      </div>
    );
  }

  if (svg === null) {
    return (
      <div className="mermaid-loading my-3 flex h-24 items-center justify-center rounded-md border border-border bg-muted/30 text-xs text-muted-foreground">
        Rendering diagram…
      </div>
    );
  }

  return (
    <div
      className="mermaid-diagram my-3 flex justify-center overflow-x-auto rounded-md border border-border bg-background p-4"
      // mermaid securityLevel:'strict' 输出的 SVG 已做转义过滤
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
