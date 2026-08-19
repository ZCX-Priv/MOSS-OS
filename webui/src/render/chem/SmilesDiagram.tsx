// render/chem/SmilesDiagram.tsx
// SMILES 分子结构图：懒加载 smiles-drawer，画到 svg 元素（苯环/杂环/任意有机分子）。
// 主题随项目亮暗切换；解析失败回退显示源码 + 错误条。
//
// 调用方（CodeBlock）保证仅在块闭合后挂载本组件 —— 流式中不会反复成图，无闪烁。

import { useEffect, useRef, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { useDarkMode } from '../core/use-dark-mode';

export interface SmilesDiagramProps {
  smiles: string;
}

export function SmilesDiagram({ smiles }: SmilesDiagramProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [status, setStatus] = useState<'loading' | 'done' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const dark = useDarkMode();

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setError(null);
    import('smiles-drawer')
      .then(({ default: SmilesDrawer }) => {
        const svg = svgRef.current;
        if (cancelled || !svg) return;
        // 清空上次绘制（主题切换重画时防叠加）
        while (svg.firstChild) svg.removeChild(svg.firstChild);
        const drawer = new SmilesDrawer.SmiDrawer({ width: 320, height: 240, padding: 14 });
        drawer.draw(
          smiles,
          svg,
          dark ? 'dark' : 'light',
          () => {
            if (!cancelled) setStatus('done');
          },
          (err: Error) => {
            if (!cancelled) {
              setError(err instanceof Error ? err.message : String(err));
              setStatus('error');
            }
          },
        );
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setStatus('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [smiles, dark]);

  if (status === 'error') {
    return (
      <div className="smiles-error my-3 rounded-md border border-destructive/40 bg-destructive/5 p-3">
        <div className="flex items-center gap-1.5 text-xs text-destructive">
          <TriangleAlert className="size-3.5" />
          <span>SMILES parse failed: {error}</span>
        </div>
        <pre className="mt-2 overflow-x-auto font-mono text-[12px] text-muted-foreground">{smiles}</pre>
      </div>
    );
  }

  return (
    <div className="smiles-diagram my-3 flex min-h-[80px] items-center justify-center overflow-x-auto rounded-md border border-border bg-background p-4">
      {status === 'loading' && (
        <span className="text-xs text-muted-foreground">Rendering molecule…</span>
      )}
      <svg
        ref={svgRef}
        xmlns="http://www.w3.org/2000/svg"
        className={status === 'done' ? 'max-w-full' : 'hidden'}
      />
    </div>
  );
}
