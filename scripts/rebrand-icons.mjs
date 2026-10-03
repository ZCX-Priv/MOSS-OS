#!/usr/bin/env node
/**
 * rebrand-icons.mjs — 清除 MOSS.png 元数据/AIGC 标识，并重建 webui/public 品牌图标套件
 *
 * 流程（全部在内存中处理并校验通过后才写盘，不会产生中间损坏状态）：
 *   A. 清洗根目录 MOSS.png（原生尺寸，原地覆盖）：
 *      - 质数中间尺寸双轮重采样（N→prime→N，cubic）：全像素插值扰动，破坏像素级频域隐水印
 *        （prime 取靠近 N×0.985 的质数，与母版尺寸解耦，换母版无需改代码）
 *      - 微亮度扰动 ×1.002（不可感知）
 *      - 保留母版自带的透明圆角（不再叠加任何圆角遮罩，避免二次裁切 over-round）
 *      - sharp 默认不写入任何元数据 chunk（不调用 withMetadata），并额外做 chunk 白名单重建
 *   B. 从清洗后的源生成 webui/public/ 图标套件（等比缩放，圆角比例随几何缩放保持）：
 *      - MOSS.png            1024×1024（favicon / boot / sidebar / splash / settings 通用）
 *      - icon-192.png         192×192（PWA any，透明圆角）
 *      - icon-512.png         512×512（PWA any，透明圆角）
 *      - icon-512-maskable.png 512×512（PWA maskable：采样母版边缘蓝实底铺满全出血）
 *   C. 读回校验：PNG chunk 白名单 {IHDR, PLTE, tRNS, IDAT, IEND}、尺寸精确、IEND 后无 trailing 字节、
 *      四角像素 alpha（透明圆角图 ≈ 0 / maskable 实底 = 边缘蓝且 alpha 255）、中心像素 alpha = 255
 */

import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'MOSS.png');
const PUB = path.join(ROOT, 'webui', 'public');

const CHUNK_WHITELIST = new Set(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND']);
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** 中间重采样比例：原始方案为 2017/2048 ≈ 0.985（约 1.5% 降采样再回采） */
const RESAMPLE_RATIO = 0.985;
/** 透明圆角像素 alpha 容差：重采样后极端角像素可能被邻域插值带出个位数 alpha */
const CORNER_ALPHA_TOL = 16;
/** maskable 实底色 RGB 容差（flatten 边缘若有极低 alpha 混合，色值可能微偏） */
const MASKABLE_RGB_TOL = 6;

/** 解析 PNG chunk；返回 { chunks: string[], width, height, trailing } */
function inspectPng(buf, file) {
  if (!buf.subarray(0, 8).equals(PNG_SIG)) {
    throw new Error(`${file}: 不是合法 PNG（签名错误）`);
  }
  const chunks = [];
  let pos = 8;
  let width = 0;
  let height = 0;
  while (pos + 12 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    if (type === 'IHDR') {
      width = buf.readUInt32BE(pos + 8);
      height = buf.readUInt32BE(pos + 12);
    }
    chunks.push(type);
    pos += 12 + len;
    if (type === 'IEND') break;
  }
  return { chunks, width, height, trailing: buf.length - pos };
}

/** 字节级剥除白名单之外的 chunk（重组原始字节段，CRC 原样保留，无损） */
function stripChunks(buf) {
  const parts = [PNG_SIG];
  let pos = 8;
  while (pos + 12 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const end = pos + 12 + len;
    if (CHUNK_WHITELIST.has(type)) {
      parts.push(buf.subarray(pos, end));
    }
    pos = end;
    if (type === 'IEND') break;
  }
  return Buffer.concat(parts);
}

/** 校验：chunk 白名单 + 期望尺寸 + 无 trailing；返回检查摘要行 */
function validatePng(buf, file, expectW, expectH) {
  const { chunks, width, height, trailing } = inspectPng(buf, file);
  const illegal = [...new Set(chunks)].filter((t) => !CHUNK_WHITELIST.has(t));
  const problems = [];
  if (illegal.length) problems.push(`非法 chunk: ${illegal.join(',')}`);
  if (width !== expectW || height !== expectH) problems.push(`尺寸 ${width}x${height} ≠ 期望 ${expectW}x${expectH}`);
  if (trailing !== 0) problems.push(`IEND 后有 ${trailing} 字节 trailing 数据`);
  if (problems.length) {
    throw new Error(`${file}: ${problems.join('；')}`);
  }
  return `${file}: ${width}x${height}, ${(buf.length / 1024).toFixed(0)}KB, chunks=[${[...new Set(chunks)].join(',')}] ✓`;
}

/** 读回磁盘文件再校验一次（不信写盘结果） */
function validateOnDisk(file, expectW, expectH) {
  return validatePng(fs.readFileSync(file), file, expectW, expectH);
}

/** 读取单个像素的 RGBA（ensureAlpha 保证 4 通道）；pos 为 [left, top] */
async function readPixel(input, left, top) {
  const buf = await sharp(input)
    .extract({ left, top, width: 1, height: 1 })
    .ensureAlpha()
    .raw()
    .toBuffer();
  return { r: buf[0], g: buf[1], b: buf[2], a: buf[3] };
}

/** 取靠近 target 的质数（不小于 64，避免过小失真） */
function nearestPrimeAround(target) {
  const isPrime = (n) => {
    if (n < 2) return false;
    for (let d = 2; d * d <= n; d++) if (n % d === 0) return false;
    return true;
  };
  let up = Math.max(64, Math.round(target));
  let down = up;
  while (!isPrime(up)) up++;
  while (!isPrime(down)) down--;
  return Math.abs(up - target) <= Math.abs(down - target) ? up : down;
}

/**
 * 圆角/实底像素断言（不信管线声明，读像素实证）：
 * - transparentCorners=true：四角 alpha 必须 ≤ 容差（透明圆角已生效），中心 alpha 必须 255
 * - transparentCorners=false（maskable 实底）：四角必须为 edgeBlue 且 alpha 255
 */
async function validateCorners(input, file, expectSize, transparentCorners, edgeBlue) {
  const corners = [
    [0, 0],
    [expectSize - 1, 0],
    [0, expectSize - 1],
    [expectSize - 1, expectSize - 1],
  ];
  const problems = [];
  for (const [x, y] of corners) {
    const px = await readPixel(input, x, y);
    if (transparentCorners) {
      if (px.a > CORNER_ALPHA_TOL) problems.push(`角(${x},${y}) alpha=${px.a} > ${CORNER_ALPHA_TOL}（圆角未生效）`);
    } else {
      const near =
        Math.abs(px.r - edgeBlue.r) <= MASKABLE_RGB_TOL &&
        Math.abs(px.g - edgeBlue.g) <= MASKABLE_RGB_TOL &&
        Math.abs(px.b - edgeBlue.b) <= MASKABLE_RGB_TOL;
      if (px.a !== 255 || !near) {
        problems.push(
          `角(${x},${y}) rgba(${px.r},${px.g},${px.b},${px.a}) ≠ 实底 rgba(${edgeBlue.r},${edgeBlue.g},${edgeBlue.b},255)`,
        );
      }
    }
  }
  const center = await readPixel(input, Math.floor(expectSize / 2), Math.floor(expectSize / 2));
  if (center.a !== 255) problems.push(`中心 alpha=${center.a} ≠ 255`);
  if (problems.length) {
    throw new Error(`${file}: ${problems.join('；')}`);
  }
  return `${file}: 四角${transparentCorners ? '透明（原生圆角生效）' : `实底 rgba(${edgeBlue.r},${edgeBlue.g},${edgeBlue.b})`} + 中心不透明 ✓`;
}

/** 采样母版四边中点像素均值，作为 maskable 全出血实底蓝 */
async function sampleEdgeBlue(input, size) {
  const mid = Math.floor(size / 2);
  const pts = [
    [mid, 2],
    [mid, size - 3],
    [2, mid],
    [size - 3, mid],
  ];
  let r = 0;
  let g = 0;
  let b = 0;
  for (const [x, y] of pts) {
    const px = await readPixel(input, x, y);
    r += px.r;
    g += px.g;
    b += px.b;
  }
  return { r: Math.round(r / pts.length), g: Math.round(g / pts.length), b: Math.round(b / pts.length) };
}

async function main() {
  const meta = await sharp(SRC).metadata();
  const N = meta.width;
  if (!N || meta.height !== N) {
    throw new Error(`MOSS.png: 母版必须为正方形，实际 ${meta.width}x${meta.height}`);
  }
  const prime = nearestPrimeAround(N * RESAMPLE_RATIO);
  console.log(`== A. 清洗根目录 MOSS.png（原生 ${N}×${N}，重采样 ${N}→${prime}→${N} + 元数据清零） ==`);
  if (!meta.hasAlpha) {
    throw new Error('MOSS.png: 母版缺少 alpha 通道，无法保留透明圆角');
  }

  const cleaned = stripChunks(
    await sharp(SRC)
      .resize(prime, prime, { kernel: 'cubic' }) // 质数中间尺寸：破坏频域水印对齐
      .resize(N, N, { kernel: 'cubic' }) // 回到原生尺寸：全像素二次插值
      .modulate({ brightness: 1.002 }) // 微亮度扰动（不可感知）
      .png({ compressionLevel: 9 })
      .toBuffer(),
  );
  const edgeBlue = await sampleEdgeBlue(cleaned, N);
  console.log(validatePng(cleaned, 'MOSS.png (内存)', N, N));
  console.log(await validateCorners(cleaned, 'MOSS.png (内存)', N, true));
  fs.writeFileSync(SRC, cleaned);
  console.log(validateOnDisk(SRC, N, N));
  console.log(await validateCorners(SRC, 'MOSS.png (磁盘读回)', N, true));
  console.log(`maskable 实底蓝（母版边缘采样）: rgba(${edgeBlue.r},${edgeBlue.g},${edgeBlue.b},255)`);

  console.log('\n== B. 生成 webui/public 图标套件（以清洗后的圆角源为基准，缩放继承原生圆角） ==');
  const outputs = [];

  // 通用：从清洗 buffer 缩放（透明圆角随几何缩放，比例严格保持）
  async function derive(size, name) {
    const buf = stripChunks(
      await sharp(cleaned).resize(size, size, { kernel: 'cubic' }).png({ compressionLevel: 9 }).toBuffer(),
    );
    const file = path.join(PUB, name);
    console.log(validatePng(buf, `${name} (内存)`, size, size));
    console.log(await validateCorners(buf, `${name} (内存)`, size, true));
    fs.writeFileSync(file, buf);
    outputs.push(validateOnDisk(file, size, size));
    outputs.push(await validateCorners(file, `${name} (磁盘读回)`, size, true));
  }

  await derive(1024, 'MOSS.png');
  await derive(192, 'icon-192.png');
  await derive(512, 'icon-512.png');

  // maskable：全出血——整图缩放到 512，透明圆角以边缘蓝 flatten 填满（图案铺满、无安全区留白）
  const maskable = stripChunks(
    await sharp(cleaned)
      .resize(512, 512, { kernel: 'cubic' })
      .flatten({ background: edgeBlue })
      .png({ compressionLevel: 9 })
      .toBuffer(),
  );
  {
    const file = path.join(PUB, 'icon-512-maskable.png');
    console.log(validatePng(maskable, 'icon-512-maskable.png (内存)', 512, 512));
    console.log(await validateCorners(maskable, 'icon-512-maskable.png (内存)', 512, false, edgeBlue));
    fs.writeFileSync(file, maskable);
    outputs.push(validateOnDisk(file, 512, 512));
    outputs.push(await validateCorners(file, 'icon-512-maskable.png (磁盘读回)', 512, false, edgeBlue));
  }

  console.log('\n== C. 写盘后读回校验汇总 ==');
  outputs.forEach((line) => console.log(line));
  console.log('\n全部通过：零元数据 chunk、尺寸精确、无 trailing 数据、原生圆角与 maskable 全出血经像素级实证。');
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});