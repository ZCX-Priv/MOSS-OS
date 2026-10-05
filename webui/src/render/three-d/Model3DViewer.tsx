// render/three-d/Model3DViewer.tsx
// 3D 模型查看器（专业工具化）：@react-three/fiber Canvas + drei OrbitControls
// + Bounds 自动取景 + 世界坐标轴（X/Y/Z，随模型自适应）+ 视角指示器（DOM/SVG）
// + 网格地面 + 模型信息浮层（顶点/面/包围盒尺寸）。
// glb/gltf 走 useGLTF（Suspense）；其余格式走 three examples loaders（按扩展名懒加载）。
// 顶点数超阈值 → 降级为「统计信息 + 提示」避免低配机卡死。
// 本组件经 React.lazy 懒加载（FilePreviewPane 分发）；加载失败由 PreviewErrorBoundary 回退。

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Canvas } from '@react-three/fiber';
import { Bounds, Grid, OrbitControls, useBounds, useGLTF } from '@react-three/drei';
import { Box3, Vector3 } from 'three';
import type { BufferGeometry, Group, Object3D } from 'three';
import { Focus } from 'lucide-react';
import { SceneAxes } from './SceneAxes';
import { CameraBridge, OrientationGizmo, type GizmoAxis, type QuaternionArray } from './OrientationGizmo';
import { useThreeThemeColors } from './theme-color';
import { ModelInfo, type ModelStats } from './ModelInfo';

/** 渲染顶点数上限（超出仅显示统计，避免低配机 GPU/内存爆掉） */
const MAX_VERTICES = 3_000_000;
/** NRRD 体素抽样上限 */
const NRRD_MAX_POINTS = 200_000;

export interface Model3DViewerProps {
  /** 文件 objectURL */
  url: string;
  /** 扩展名（glb/gltf/stl/ply/obj/fbx/3mf/dae/3ds/wrl/vrml/amf/usdz/kmz/gcode/md2/bvh/pcd/pdb/vox/xyz/nrrd/drc） */
  ext: string;
}

type Loaded = { object: Object3D; stats: ModelStats };

/** 统计顶点数 / 三角面数 / 包围盒尺寸 */
function computeStats(object: Object3D): ModelStats {
  let vertices = 0;
  let triangles = 0;
  object.traverse((child) => {
    const geo = (child as { geometry?: BufferGeometry }).geometry;
    const position = geo?.attributes?.position;
    if (!position) return;
    vertices += position.count;
    triangles += geo?.index ? geo.index.count / 3 : position.count / 3;
  });
  const box = new Box3().setFromObject(object);
  const sizeVec = box.getSize(new Vector3());
  return {
    vertices,
    triangles: Math.round(triangles),
    size: [sizeVec.x, sizeVec.y, sizeVec.z],
  };
}

/** glb/gltf：drei useGLTF（Suspense 友好），加载完成后回报统计信息 */
function GltfModel({ url, onStats }: { url: string; onStats: (stats: ModelStats) => void }) {
  const { scene } = useGLTF(url);
  useEffect(() => {
    onStats(computeStats(scene));
  }, [scene, onStats]);
  return <primitive object={scene as Group} />;
}

/** 非 gltf：按扩展名加载并归一化为 Object3D */
async function loadModel(url: string, ext: string): Promise<Object3D> {
  const THREE = await import('three');
  // 表面实体几何 → Mesh。STL/PLY/MD2 均为表面模型（STL 常态是非索引的三角汤，
  // 不是点云）；旧实现按 geometry.index 判定会把它们误当点云，用 PointsMaterial(size:0.02)
  // 渲染 → 几乎不可见的细点。真正的点云由各自 loader 分支直接返回 Points。
  const asMesh = (geometry: BufferGeometry): Object3D => {
    geometry.computeVertexNormals();
    return new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.1, roughness: 0.8 }),
    );
  };

  switch (ext) {
    case 'stl': {
      const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js');
      return asMesh(await new STLLoader().loadAsync(url));
    }
    case 'ply': {
      const { PLYLoader } = await import('three/examples/jsm/loaders/PLYLoader.js');
      return asMesh(await new PLYLoader().loadAsync(url));
    }
    case 'md2': {
      const { MD2Loader } = await import('three/examples/jsm/loaders/MD2Loader.js');
      return asMesh(await new MD2Loader().loadAsync(url));
    }
    case 'drc': {
      const { DRACOLoader } = await import('three/examples/jsm/loaders/DRACOLoader.js');
      const loader = new DRACOLoader();
      loader.setDecoderPath(`${import.meta.env.BASE_URL}draco/`);
      try {
        return asMesh(await loader.loadAsync(url));
      } finally {
        loader.dispose();
      }
    }
    case 'obj': {
      const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
      return await new OBJLoader().loadAsync(url);
    }
    case 'fbx': {
      const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
      return await new FBXLoader().loadAsync(url);
    }
    case '3mf': {
      const { ThreeMFLoader } = await import('three/examples/jsm/loaders/3MFLoader.js');
      return await new ThreeMFLoader().loadAsync(url);
    }
    case 'dae': {
      const { ColladaLoader } = await import('three/examples/jsm/loaders/ColladaLoader.js');
      const collada = await new ColladaLoader().loadAsync(url);
      if (!collada) throw new Error('DAE: empty document');
      return collada.scene;
    }
    case '3ds': {
      const { TDSLoader } = await import('three/examples/jsm/loaders/TDSLoader.js');
      return await new TDSLoader().loadAsync(url);
    }
    case 'wrl':
    case 'vrml': {
      const { VRMLLoader } = await import('three/examples/jsm/loaders/VRMLLoader.js');
      return await new VRMLLoader().loadAsync(url);
    }
    case 'amf': {
      const { AMFLoader } = await import('three/examples/jsm/loaders/AMFLoader.js');
      return await new AMFLoader().loadAsync(url);
    }
    case 'usdz': {
      const { USDLoader } = await import('three/examples/jsm/loaders/USDLoader.js');
      return await new USDLoader().loadAsync(url);
    }
    case 'kmz': {
      const { KMZLoader } = await import('three/examples/jsm/loaders/KMZLoader.js');
      const result = await new KMZLoader().loadAsync(url);
      return result.scene;
    }
    case 'gcode': {
      const { GCodeLoader } = await import('three/examples/jsm/loaders/GCodeLoader.js');
      return await new GCodeLoader().loadAsync(url);
    }
    case 'pcd': {
      const { PCDLoader } = await import('three/examples/jsm/loaders/PCDLoader.js');
      const points = await new PCDLoader().loadAsync(url);
      points.material = new THREE.PointsMaterial({ size: 0.02, vertexColors: true });
      return points;
    }
    case 'xyz': {
      const { XYZLoader } = await import('three/examples/jsm/loaders/XYZLoader.js');
      const geo = await new XYZLoader().loadAsync(url);
      return new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.02, vertexColors: geo.hasAttribute('color') }));
    }
    case 'vox': {
      const { VOXLoader, buildMesh } = await import('three/examples/jsm/loaders/VOXLoader.js');
      const result = (await new VOXLoader().loadAsync(url)) as unknown as {
        scene: Object3D | null;
        chunks: unknown[];
      };
      if (result.scene) return result.scene;
      const first = result.chunks?.[0];
      if (first) return buildMesh(first as never);
      throw new Error('VOX: no geometry');
    }
    case 'bvh': {
      const { BVHLoader } = await import('three/examples/jsm/loaders/BVHLoader.js');
      const result = await new BVHLoader().loadAsync(url);
      const root = result.skeleton.bones[0];
      if (!root) throw new Error('BVH: empty skeleton');
      return new THREE.SkeletonHelper(root);
    }
    case 'pdb': {
      const { PDBLoader } = await import('three/examples/jsm/loaders/PDBLoader.js');
      const result = await new PDBLoader().loadAsync(url);
      const group = new THREE.Group();
      group.add(new THREE.Points(result.geometryAtoms, new THREE.PointsMaterial({ size: 0.2, vertexColors: true })));
      group.add(new THREE.LineSegments(result.geometryBonds, new THREE.LineBasicMaterial({ color: 0x888888 })));
      return group;
    }
    case 'nrrd': {
      const { NRRDLoader } = await import('three/examples/jsm/loaders/NRRDLoader.js');
      const volume = (await new NRRDLoader().loadAsync(url)) as unknown as {
        data: Float32Array | Uint8Array;
        xLength: number;
        yLength: number;
        zLength: number;
        min: number;
        max: number;
      };
      // 体数据抽样为点云（阈值取中值）
      const { data, xLength, yLength, zLength, min, max } = volume;
      const total = xLength * yLength * zLength;
      const stride = Math.max(1, Math.floor(total / NRRD_MAX_POINTS));
      const threshold = min + (max - min) * 0.5;
      const positions: number[] = [];
      for (let i = 0; i < total; i += stride) {
        const v = data[i];
        if (v === undefined || v < threshold) continue;
        const x = i % xLength;
        const y = Math.floor(i / xLength) % yLength;
        const z = Math.floor(i / (xLength * yLength));
        positions.push(x, y, z);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      return new THREE.Points(geo, new THREE.PointsMaterial({ size: 1, color: 0x9aa0a6 }));
    }
    default:
      throw new Error(`Unsupported 3D format: ${ext}`);
  }
}

/** 非 gltf：useEffect 加载 + 卸载释放 */
function useLoadedModel(url: string, ext: string): { loaded: Loaded | null; error: string | null; loading: boolean } {
  const [state, setState] = useState<{ loaded: Loaded | null; error: string | null; loading: boolean }>({
    loaded: null,
    error: null,
    loading: true,
  });

  useEffect(() => {
    if (!url) {
      setState({ loaded: null, error: null, loading: false });
      return;
    }
    let cancelled = false;
    let created: Object3D | null = null;
    setState({ loaded: null, error: null, loading: true });
    void (async () => {
      try {
        const object = await loadModel(url, ext);
        if (cancelled) {
          disposeObject(object);
          return;
        }
        created = object;
        setState({ loaded: { object, stats: computeStats(object) }, error: null, loading: false });
      } catch (err: unknown) {
        if (!cancelled) setState({ loaded: null, error: err instanceof Error ? err.message : String(err), loading: false });
      }
    })();
    return () => {
      cancelled = true;
      if (created) disposeObject(created);
    };
  }, [url, ext]);

  return state;
}

/** 释放 Object3D 的几何/材质/贴图 */
function disposeObject(object: Object3D): void {
  object.traverse((child) => {
    const mesh = child as { geometry?: BufferGeometry; material?: unknown };
    mesh.geometry?.dispose();
    const material = mesh.material;
    const list = Array.isArray(material) ? material : material ? [material] : [];
    for (const m of list) {
      const mat = m as { dispose?: () => void; map?: { dispose?: () => void } };
      mat.map?.dispose?.();
      mat.dispose?.();
    }
  });
}

/** Home/适应窗口：token 变化时重新取景（必须位于 <Bounds> 子树内才能拿到 useBounds） */
function HomeHandler({ token }: { token: number }) {
  const bounds = useBounds();
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    boundsRef.current.refresh().clip().fit();
  }, [token]);

  return null;
}

export function Model3DViewer({ url, ext }: Model3DViewerProps) {
  const { t } = useTranslation();
  const normalized = ext.toLowerCase();
  const isGltf = normalized === 'glb' || normalized === 'gltf';

  // gltf 走 useGLTF；其余走自建加载（单次加载，结果同时用于渲染与阈值判断）
  const { loaded, error, loading } = useLoadedModel(isGltf ? '' : url, normalized);
  const [gltfStats, setGltfStats] = useState<ModelStats | null>(null);
  const [fitToken, setFitToken] = useState(0);
  // 视角指示器：跨 Canvas 边界只用两个 ref 传数据（相机姿态出、切视图请求入），零重渲染
  const gizmoQuatRef = useRef<QuaternionArray>([0, 0, 0, 1]);
  const gizmoSnapRef = useRef<GizmoAxis | null>(null);
  // 网格配色：主题变量是 oklch，必须解析成 three 可用的实色（见 theme-color.ts）
  const { gridCell, gridSection } = useThreeThemeColors();

  const onGltfStats = useCallback((stats: ModelStats) => setGltfStats(stats), []);

  const content = useMemo(
    () => (isGltf ? <GltfModel url={url} onStats={onGltfStats} /> : loaded ? <primitive object={loaded.object} /> : null),
    [isGltf, url, loaded, onGltfStats],
  );

  const stats = isGltf ? gltfStats : loaded?.stats ?? null;

  if (!isGltf) {
    if (error !== null) {
      return (
        <div className="flex h-full items-center justify-center px-4 text-center text-sm text-destructive">{error}</div>
      );
    }
    if (loading) {
      return (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          {t('preview.loading')}
        </div>
      );
    }
  }

  if (stats && stats.vertices > MAX_VERTICES) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <div className="text-sm">{t('preview.modelTooComplex')}</div>
        <div className="font-mono text-xs tabular-nums">{stats.vertices.toLocaleString()} vertices</div>
      </div>
    );
  }

  // 坐标轴/网格随模型尺寸自适应（未取得统计前用保守默认值）
  const diag = stats ? Math.hypot(stats.size[0], stats.size[1], stats.size[2]) : 0;
  const hasScale = diag > 0 && Number.isFinite(diag);
  const axisSize = hasScale ? diag * 0.6 : 1;
  const cellSize = hasScale ? diag / 20 : 0.5;
  const sectionSize = hasScale ? diag / 4 : 2;
  const fadeDistance = hasScale ? diag * 6 : 30;

  return (
    <div className="relative h-full overflow-hidden rounded border border-border bg-muted/30">
      <Canvas camera={{ position: [3, 2, 5], fov: 50 }} shadows>
        <ambientLight intensity={0.6} />
        <directionalLight position={[5, 8, 5]} intensity={1.2} castShadow />
        <Suspense fallback={null}>
          <Bounds fit clip observe margin={1.2}>
            {content}
            <HomeHandler token={fitToken} />
          </Bounds>
        </Suspense>
        <Grid
          infiniteGrid
          cellSize={cellSize}
          sectionSize={sectionSize}
          fadeDistance={fadeDistance}
          cellColor={gridCell}
          sectionColor={gridSection}
        />
        {stats && <SceneAxes size={axisSize} />}
        <CameraBridge quaternionRef={gizmoQuatRef} snapRef={gizmoSnapRef} />
        <OrbitControls enableDamping dampingFactor={0.1} makeDefault />
      </Canvas>

      {/* 右上：视角指示器（DOM/SVG 叠加层，不参与 WebGL 渲染） */}
      <div className="pointer-events-none absolute right-2 top-2 z-10 h-24 w-24">
        <OrientationGizmo
          quaternionRef={gizmoQuatRef}
          onSnap={(axis) => {
            gizmoSnapRef.current = axis;
          }}
        />
      </div>

      {/* 左上：适应窗口（重新取景） */}
      <button
        type="button"
        onClick={() => setFitToken((n) => n + 1)}
        title={t('preview.modelFitView')}
        aria-label={t('preview.modelFitView')}
        className="absolute left-2 top-2 z-10 inline-flex size-7 items-center justify-center rounded-md border border-border/60 bg-background/80 text-muted-foreground backdrop-blur-sm transition-colors hover:bg-muted hover:text-foreground"
      >
        <Focus className="size-3.5" />
      </button>

      {/* 左下：模型信息 */}
      <ModelInfo stats={stats} />
    </div>
  );
}