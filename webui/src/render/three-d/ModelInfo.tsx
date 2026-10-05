// render/three-d/ModelInfo.tsx
// 模型信息浮层（顶点数 / 三角面数 / 包围盒尺寸），绝对定位于画布左下角。
// 纯 DOM 叠加层（位于 Canvas 之外），不参与 WebGL 渲染，pointer-events 关闭不拦截交互。

import { useTranslation } from 'react-i18next';

export interface ModelStats {
  /** 顶点总数 */
  vertices: number;
  /** 三角面总数（索引面数 / 3 或顶点数 / 3，四舍五入） */
  triangles: number;
  /** 包围盒尺寸 [x, y, z]（世界单位） */
  size: [number, number, number];
}

export function ModelInfo({ stats }: { stats: ModelStats | null }) {
  const { t } = useTranslation();
  if (!stats) return null;

  const fmtInt = (n: number) => n.toLocaleString();
  const fmtDim = (n: number) => (Number.isFinite(n) ? n.toFixed(3) : '-');
  const [x, y, z] = stats.size;

  return (
    <div className="pointer-events-none absolute bottom-2 left-2 z-10 rounded-md border border-border/60 bg-background/80 px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-muted-foreground backdrop-blur-sm">
      <div>
        <span className="text-foreground/70">{t('preview.modelVertices')}</span>: {fmtInt(stats.vertices)}
      </div>
      <div>
        <span className="text-foreground/70">{t('preview.modelTriangles')}</span>: {fmtInt(stats.triangles)}
      </div>
      <div>
        <span className="text-foreground/70">{t('preview.modelSize')}</span>: {fmtDim(x)} × {fmtDim(y)} ×{' '}
        {fmtDim(z)}
      </div>
    </div>
  );
}