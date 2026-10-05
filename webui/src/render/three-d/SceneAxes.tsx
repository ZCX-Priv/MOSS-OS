// render/three-d/SceneAxes.tsx
// 世界坐标轴：AxesHelper（长度随模型包围盒自适应）+ X/Y/Z 轴端标签。
// 标签用本地 CanvasTexture 绘制（不依赖网络字体），与视角指示器（OrientationGizmo）配色一致。
// 受控容器内渲染（r3f 场景），卸载时释放纹理。

import { useEffect, useMemo } from 'react';
import { CanvasTexture, SRGBColorSpace } from 'three';

/** 轴色（与视角指示器的 X/Y/Z 配色保持一致：红/绿/蓝） */
const AXIS_COLOR = { x: '#ff4466', y: '#88ff44', z: '#4488ff' } as const;

/** 用本地画布绘制单字标签纹理（不下载字体，离线可用） */
function makeLabelTexture(text: string, color: string): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.font = 'bold 46px Arial, Helvetica, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(text, 32, 34);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

export interface SceneAxesProps {
  /** 坐标轴长度（一般取包围盒对角线 × 0.6） */
  size: number;
}

export function SceneAxes({ size }: SceneAxesProps) {
  const labels = useMemo(
    () => ({
      x: makeLabelTexture('X', AXIS_COLOR.x),
      y: makeLabelTexture('Y', AXIS_COLOR.y),
      z: makeLabelTexture('Z', AXIS_COLOR.z),
    }),
    [],
  );

  useEffect(
    () => () => {
      labels.x.dispose();
      labels.y.dispose();
      labels.z.dispose();
    },
    [labels],
  );

  const tip = size * 1.05;
  const scale = Math.max(size * 0.16, 0.001);

  return (
    <group>
      <axesHelper args={[size]} />
      <sprite position={[tip, 0, 0]} scale={[scale, scale, 1]}>
        <spriteMaterial map={labels.x} toneMapped={false} transparent depthWrite={false} />
      </sprite>
      <sprite position={[0, tip, 0]} scale={[scale, scale, 1]}>
        <spriteMaterial map={labels.y} toneMapped={false} transparent depthWrite={false} />
      </sprite>
      <sprite position={[0, 0, tip]} scale={[scale, scale, 1]}>
        <spriteMaterial map={labels.z} toneMapped={false} transparent depthWrite={false} />
      </sprite>
    </group>
  );
}