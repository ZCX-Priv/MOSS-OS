// render/three-d/Model3DViewer.tsx
// 3D 模型查看器：@react-three/fiber Canvas + drei OrbitControls。
// glb/gltf 走 useGLTF（Suspense），obj/stl 走 three examples loaders。
// 本组件经 React.lazy 懒加载（FilePreviewDialog 分发）。

import { Suspense, useEffect, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { Grid, OrbitControls, useGLTF } from '@react-three/drei';
import type { Group, BufferGeometry } from 'three';

export interface Model3DViewerProps {
  /** 文件 objectURL */
  url: string;
  /** 扩展名（glb/gltf/obj/stl） */
  ext: string;
}

function GltfModel({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  return <primitive object={scene as Group} />;
}

function useLoadedModel(url: string, ext: string): { geometry: BufferGeometry } | { group: Group } | null {
  const [model, setModel] = useState<{ geometry: BufferGeometry } | { group: Group } | null>(null);
  useEffect(() => {
    let cancelled = false;
    setModel(null);
    void (async () => {
      if (ext === 'stl') {
        const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js');
        const loader = new STLLoader();
        loader.load(url, (geometry) => {
          if (!cancelled) setModel({ geometry });
        });
      } else if (ext === 'obj') {
        const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
        const loader = new OBJLoader();
        loader.load(url, (group) => {
          if (!cancelled) setModel({ group });
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, ext]);
  return model;
}

function ObjStlModel({ url, ext }: { url: string; ext: string }) {
  const model = useLoadedModel(url, ext);
  if (!model) return null;
  if ('geometry' in model) {
    return <mesh geometry={model.geometry} castShadow receiveShadow />;
  }
  return <primitive object={model.group} />;
}

export function Model3DViewer({ url, ext }: Model3DViewerProps) {
  const normalized = ext.toLowerCase();
  const isGltf = normalized === 'glb' || normalized === 'gltf';

  const content = useMemo(
    () =>
      isGltf ? (
        <GltfModel url={url} />
      ) : (
        <ObjStlModel url={url} ext={normalized} />
      ),
    [isGltf, url, normalized],
  );

  return (
    <div className="h-[calc(80dvh-9rem)] overflow-hidden rounded border border-border bg-muted/30">
      <Canvas camera={{ position: [3, 2, 5], fov: 50 }} shadows>
        <ambientLight intensity={0.6} />
        <directionalLight position={[5, 8, 5]} intensity={1.2} castShadow />
        <Suspense fallback={null}>{content}</Suspense>
        <Grid
          infiniteGrid
          cellSize={0.5}
          sectionSize={2}
          fadeDistance={30}
          cellColor="var(--border)"
          sectionColor="var(--primary)"
        />
        <OrbitControls enableDamping dampingFactor={0.1} makeDefault />
      </Canvas>
    </div>
  );
}
