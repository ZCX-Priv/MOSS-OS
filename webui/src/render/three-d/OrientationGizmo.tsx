// render/three-d/OrientationGizmo.tsx
// 视角指示器（DOM/SVG）+ Canvas 内的相机桥。
//
// 为什么不用 three 的 ViewHelper（原 ViewCube 的做法）：
//   ViewHelper 需要「抢占 r3f 渲染循环（useFrame(cb, 1)） + 在同一张 WebGL 画布上做第二遍渲染」；
//   实测该第二遍渲染会让主场景（模型/网格）整块不可见——模型与基准平面只闪现一瞬，随后画面变黑。
//   本实现改为纯 DOM/SVG 叠加层：Canvas 内只有一个 priority = 0 的桥（只读相机姿态、不接管渲染），
//   DOM 侧自带 requestAnimationFrame 读取姿态并直写 SVG 属性，完全不触碰 WebGL 状态。
//
// 数据流：
//   相机四元数 → CameraBridge（Canvas 内，useFrame priority 0）写入 quaternionRef
//              → OrientationGizmo（Canvas 外，rAF）读取并更新 SVG
//   点击端点 → onSnap(axis) → 父级写入 snapRef → CameraBridge 下一帧执行相机切换

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Quaternion, Vector3 } from 'three';

/** 六个轴向（世界方向） */
export type GizmoAxis = 'posX' | 'negX' | 'posY' | 'negY' | 'posZ' | 'negZ';

interface AxisDef {
  axis: GizmoAxis;
  dir: readonly [number, number, number];
  color: string;
  label: string;
  positive: boolean;
}

/** 轴色与 SceneAxes 的 X/Y/Z 配色一致 */
export const AXES: readonly AxisDef[] = [
  { axis: 'posX', dir: [1, 0, 0], color: '#ff4466', label: 'X', positive: true },
  { axis: 'negX', dir: [-1, 0, 0], color: '#ff4466', label: '−X', positive: false },
  { axis: 'posY', dir: [0, 1, 0], color: '#88ff44', label: 'Y', positive: true },
  { axis: 'negY', dir: [0, -1, 0], color: '#88ff44', label: '−Y', positive: false },
  { axis: 'posZ', dir: [0, 0, 1], color: '#4488ff', label: 'Z', positive: true },
  { axis: 'negZ', dir: [0, 0, -1], color: '#4488ff', label: '−Z', positive: false },
];

const AXIS_BY_NAME: Record<GizmoAxis, AxisDef> = Object.fromEntries(
  AXES.map((a) => [a.axis, a]),
) as Record<GizmoAxis, AxisDef>;

/** SVG 逻辑坐标系：边长 / 中心 / 投影半径 */
const SIZE = 96;
const CENTER = SIZE / 2;
const RADIUS = 34;
const POS_DOT = 8.5;
const NEG_DOT = 3.5;

/** OrbitControls 的最小可操作面（仅用 target / update） */
interface ControlsLike {
  target: Vector3;
  update: () => void;
}

/** 相机世界四元数（顺序 x, y, z, w）——跨 Canvas 边界传递的唯一数据 */
export type QuaternionArray = [number, number, number, number];

/**
 * 把相机绕当前 target 转到指定轴向视图（保持观察距离不变）。
 * 优先交给 OrbitControls.update()（其内部会 lookAt(target) 并对极角做 EPS 夹取，
 * 因此 ±Y 的正交视图也不会出现 lookAt 与 up 平行导致的退化）。
 */
export function snapCameraToAxis(
  camera: { position: Vector3; up: Vector3; lookAt: (t: Vector3) => void; updateProjectionMatrix: () => void },
  controls: ControlsLike | null,
  axis: GizmoAxis,
): void {
  const dir = AXIS_BY_NAME[axis].dir;
  const target = controls ? controls.target : new Vector3();
  const distance = camera.position.distanceTo(target) || 1;
  camera.position.copy(target).addScaledVector(new Vector3(dir[0], dir[1], dir[2]), distance);
  camera.up.set(0, 1, 0);
  if (controls) {
    controls.update();
  } else {
    if (Math.abs(dir[1]) > 0.999) camera.up.set(0, 0, dir[1] > 0 ? -1 : 1);
    camera.lookAt(target);
  }
  camera.updateProjectionMatrix();
}

export interface CameraBridgeProps {
  /** 相机四元数出口（每帧写入，零 React 重渲染） */
  quaternionRef: { current: QuaternionArray };
  /** 待执行的切视图请求（DOM 侧写入，Canvas 侧消费） */
  snapRef: { current: GizmoAxis | null };
}

/** Canvas 内的桥：只读相机 + 消费切视图请求。renderPriority 必须保持 0（不接管渲染循环）。 */
export function CameraBridge({ quaternionRef, snapRef }: CameraBridgeProps) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as ControlsLike | null;
  const controlsRef = useRef<ControlsLike | null>(null);
  controlsRef.current = controls;

  useFrame(() => {
    const q = camera.quaternion;
    const out = quaternionRef.current;
    out[0] = q.x;
    out[1] = q.y;
    out[2] = q.z;
    out[3] = q.w;

    const axis = snapRef.current;
    if (axis) {
      snapRef.current = null;
      snapCameraToAxis(camera, controlsRef.current, axis);
    }
  });

  return null;
}

export interface OrientationGizmoProps {
  /** 相机四元数来源（CameraBridge 写入） */
  quaternionRef: { current: QuaternionArray };
  /** 点击端点 → 请求切换视角 */
  onSnap: (axis: GizmoAxis) => void;
}

export function OrientationGizmo({ quaternionRef, onSnap }: OrientationGizmoProps) {
  const containerRef = useRef<SVGGElement | null>(null);
  const itemRefs = useRef<Array<SVGGElement | null>>([]);
  const lineRefs = useRef<Array<SVGLineElement | null>>([]);

  // 自有 rAF：读四元数 → 更新 SVG 几何（不 setState，不触发 React 重渲染）
  useEffect(() => {
    const invQuat = new Quaternion();
    const dir = new Vector3();
    const projected = AXES.map(() => ({ x: CENTER, y: CENTER, z: 0 }));
    let order = '';
    let raf = 0;

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const q = quaternionRef.current;
      invQuat.set(q[0], q[1], q[2], q[3]).invert();

      for (let i = 0; i < AXES.length; i++) {
        const a = AXES[i];
        dir.set(a.dir[0], a.dir[1], a.dir[2]).applyQuaternion(invQuat);
        const p = projected[i];
        p.x = CENTER + dir.x * RADIUS;
        p.y = CENTER - dir.y * RADIUS;
        p.z = dir.z;
      }

      // 远端（z 小）先画、近端（z 大）后画：仅当顺序变化时重排 DOM
      const nextOrder = projected
        .map((p, i) => ({ i, z: p.z }))
        .sort((m, n) => m.z - n.z)
        .map((o) => o.i)
        .join(',');
      const container = containerRef.current;
      if (container && nextOrder !== order) {
        order = nextOrder;
        for (const idx of nextOrder.split(',').map(Number)) {
          const node = itemRefs.current[idx];
          if (node) container.appendChild(node);
        }
      }

      for (let i = 0; i < AXES.length; i++) {
        const p = projected[i];
        const node = itemRefs.current[i];
        if (node) node.setAttribute('transform', `translate(${p.x.toFixed(2)} ${p.y.toFixed(2)})`);
        const line = lineRefs.current[i];
        if (line) {
          line.setAttribute('x1', String(CENTER));
          line.setAttribute('y1', String(CENTER));
          line.setAttribute('x2', p.x.toFixed(2));
          line.setAttribute('y2', p.y.toFixed(2));
          // 越靠近观察者越实
          line.setAttribute('stroke-opacity', (0.35 + 0.5 * ((p.z + 1) / 2)).toFixed(2));
        }
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [quaternionRef]);

  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-full w-full">
      {/* 轴心连到正方向端点（负方向只给点，避免视觉噪声） */}
      {AXES.map((a, i) =>
        a.positive ? (
          <line
            key={`l-${a.axis}`}
            ref={(el) => {
              lineRefs.current[i] = el;
            }}
            stroke={a.color}
            strokeWidth={1.5}
            strokeLinecap="round"
          />
        ) : null,
      )}
      <g ref={containerRef}>
        {AXES.map((a, i) => (
          <g
            key={a.axis}
            ref={(el) => {
              itemRefs.current[i] = el;
            }}
            className="cursor-pointer"
            style={{ pointerEvents: 'auto' }}
            onClick={() => onSnap(a.axis)}
          >
            <title>{a.label}</title>
            <circle
              r={a.positive ? POS_DOT : NEG_DOT}
              fill={a.color}
              fillOpacity={a.positive ? 1 : 0.35}
              stroke={a.positive ? 'rgba(0,0,0,0.55)' : 'none'}
              strokeWidth={a.positive ? 1 : 0}
            />
            {a.positive && (
              <text
                y={0.5}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={7}
                fontWeight={700}
                fill="#0b0b0c"
                style={{ userSelect: 'none' }}
              >
                {a.label}
              </text>
            )}
          </g>
        ))}
      </g>
    </svg>
  );
}