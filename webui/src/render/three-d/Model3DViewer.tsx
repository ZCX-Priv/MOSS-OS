// render/three-d/Model3DViewer.tsx
// 3D 模型查看器：@react-three/fiber Canvas + drei OrbitControls（拖拽换视角 / 滚轮缩放 / 右键平移）
// + drei Bounds 自动取景（不同模型的尺寸差异极大，避免出现「看不见」）。
// glb/gltf 走 useGLTF（Suspense）；其余格式走 three examples loaders（按扩展名懒加载）。
// 本组件经 React.lazy 懒加载（FilePreviewPane 分发）；加载失败由 PreviewErrorBoundary 回退。

import { Suspense, useEffect, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { Bounds, Grid, OrbitControls, useGLTF } from '@react-three/drei';
import type { BufferGeometry, Group, Object3D } from 'three';

export interface Model3DViewerProps {
  /** 文件 objectURL */
  url: string;
  /** 扩展名（glb/gltf/obj/stl/fbx/ply/3mf/dae/3ds/wrl/vrml/amf） */
  ext: string;
}

function GltfModel({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  return <primitive object={scene as Group} />;
}

type LoadedModel = { geometry: BufferGeometry } | { object: Object3D };

/** 按扩展名加载模型（geometry 或 Object3D），失败时保持 null（由外层回退） */
function useLoadedModel(url: string, ext: string): LoadedModel | null {
  const [model, setModel] = useState<LoadedModel | null>(null);

  useEffect(() => {
    let cancelled = false;
    setModel(null);
    const onLoad = (result: LoadedModel) => {
      if (!cancelled) setModel(result);
    };
    const onError = (_err: unknown) => {
      // 加载失败：保持 null，外层 PreviewErrorBoundary 回退
    };

    void (async () => {
      try {
        if (ext === 'stl') {
          const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js');
          new STLLoader().load(url, (geometry) => onLoad({ geometry }), undefined, onError);
        } else if (ext === 'ply') {
          const { PLYLoader } = await import('three/examples/jsm/loaders/PLYLoader.js');
          new PLYLoader().load(url, (geometry) => onLoad({ geometry }), undefined, onError);
        } else if (ext === 'obj') {
          const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
          new OBJLoader().load(url, (object) => onLoad({ object }), undefined, onError);
        } else if (ext === 'fbx') {
          const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
          new FBXLoader().load(url, (object) => onLoad({ object }), undefined, onError);
        } else if (ext === '3mf') {
          const { ThreeMFLoader } = await import('three/examples/jsm/loaders/3MFLoader.js');
          new ThreeMFLoader().load(url, (object) => onLoad({ object }), undefined, onError);
        } else if (ext === 'dae') {
          const { ColladaLoader } = await import('three/examples/jsm/loaders/ColladaLoader.js');
          new ColladaLoader().load(
            url,
            (collada) => {
              if (collada) onLoad({ object: collada.scene });
            },
            undefined,
            onError,
          );
        } else if (ext === '3ds') {
          const { TDSLoader } = await import('three/examples/jsm/loaders/TDSLoader.js');
          new TDSLoader().load(url, (object) => onLoad({ object }), undefined, onError);
        } else if (ext === 'wrl' || ext === 'vrml') {
          const { VRMLLoader } = await import('three/examples/jsm/loaders/VRMLLoader.js');
          new VRMLLoader().load(url, (object) => onLoad({ object }), undefined, onError);
        } else if (ext === 'amf') {
          const { AMFLoader } = await import('three/examples/jsm/loaders/AMFLoader.js');
          new AMFLoader().load(url, (object) => onLoad({ object }), undefined, onError);
        }
      } catch {
        // 动态 import 失败：保持 null
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [url, ext]);

  return model;
}

function LoadedObjectModel({ url, ext }: { url: string; ext: string }) {
  const model = useLoadedModel(url, ext);
  if (!model) return null;
  if ('geometry' in model) {
    return <mesh geometry={model.geometry} castShadow receiveShadow />;
  }
  return <primitive object={model.object} />;
}

export function Model3DViewer({ url, ext }: Model3DViewerProps) {
  const normalized = ext.toLowerCase();
  const isGltf = normalized === 'glb' || normalized === 'gltf';

  const content = useMemo(
    () => (isGltf ? <GltfModel url={url} /> : <LoadedObjectModel url={url} ext={normalized} />),
    [isGltf, url, normalized],
  );

  return (
    <div className="h-full overflow-hidden rounded border border-border bg-muted/30">
      <Canvas camera={{ position: [3, 2, 5], fov: 50 }} shadows>
        <ambientLight intensity={0.6} />
        <directionalLight position={[5, 8, 5]} intensity={1.2} castShadow />
        <Suspense fallback={null}>
          <Bounds fit clip observe margin={1.2}>
            {content}
          </Bounds>
        </Suspense>
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