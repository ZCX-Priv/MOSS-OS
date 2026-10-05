// render/cad/DxfViewer.tsx
// AutoCAD DXF 2D 图纸预览：dxf-render 解析 + three 正交相机渲染（仅平移/缩放，不旋转）。
// 自持 WebGL 生命周期（卸载时 dispose + 取消观察者），失败回退提示。
// 本组件经 React.lazy 懒加载（FilePreviewPane 分发）。

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, TriangleAlert } from 'lucide-react';

export interface DxfViewerProps {
  text: string;
}

export function DxfViewer({ text }: DxfViewerProps) {
  const { t } = useTranslation();
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready'>('loading');

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let dispose: (() => void) | null = null;

    void (async () => {
      try {
        const [{ parseDxf, createThreeObjectsFromDXF }, THREE, { OrbitControls }] = await Promise.all([
          import('dxf-render'),
          import('three'),
          import('three/examples/jsm/controls/OrbitControls.js'),
        ]);
        if (cancelled) return;

        const dxf = parseDxf(text);
        const { group } = await createThreeObjectsFromDXF(dxf);
        if (cancelled) return;

        const width = host.clientWidth || 640;
        const height = host.clientHeight || 480;

        const scene = new THREE.Scene();
        scene.add(group);

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(width, height);
        renderer.setClearColor(0x000000, 0);
        host.appendChild(renderer.domElement);

        // 图纸包围盒 → 正交相机取景
        const box = new THREE.Box3().setFromObject(group);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, 1);
        const aspect = width / height;
        const frustum = maxDim * 1.25;
        const camera = new THREE.OrthographicCamera(
          (-frustum * aspect) / 2,
          (frustum * aspect) / 2,
          frustum / 2,
          -frustum / 2,
          -10000,
          10000,
        );
        camera.position.set(center.x, center.y, Math.max(maxDim, 10));
        camera.lookAt(center.x, center.y, 0);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableRotate = false; // 2D 图纸：禁止旋转
        controls.target.set(center.x, center.y, 0);
        controls.update();

        const render = () => renderer.render(scene, camera);
        controls.addEventListener('change', render);
        render();

        const ro = new ResizeObserver(() => {
          const w = host.clientWidth || width;
          const h = host.clientHeight || height;
          renderer.setSize(w, h);
          const a = w / h;
          camera.left = (-frustum * a) / 2;
          camera.right = (frustum * a) / 2;
          camera.updateProjectionMatrix();
          render();
        });
        ro.observe(host);

        setStatus('ready');

        dispose = () => {
          ro.disconnect();
          controls.removeEventListener('change', render);
          controls.dispose();
          renderer.dispose();
          scene.remove(group);
          if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
        };
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
      dispose?.();
      if (host) host.innerHTML = '';
    };
  }, [text]);

  if (error !== null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-destructive">
        <TriangleAlert className="size-6" />
        <div className="text-sm">{t('preview.dxfFailed')}</div>
        <div className="max-w-md break-all text-xs text-muted-foreground">{error}</div>
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-0 overflow-hidden rounded border border-border bg-muted/20">
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 size-5 animate-spin" />
          <span className="text-sm">{t('preview.loading')}</span>
        </div>
      )}
      <div ref={hostRef} className="dxf-host h-full w-full" />
    </div>
  );
}