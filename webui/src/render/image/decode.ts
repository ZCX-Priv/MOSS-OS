// render/image/decode.ts
// 浏览器无法原生解码的图片格式 → 解码后转 objectURL（交给 <img> 显示）。
// - TIFF/TIF：utif 解码到 canvas 再转 PNG blob
// - HEIC/HEIF：heic2any（内嵌 libheif wasm）转 PNG blob
// 均为懒加载；失败由调用方回退到「无法预览」卡片。

/** 解码图片为可显示的 objectURL（调用方负责在卸载时 revoke） */
export async function decodeImageToObjectUrl(buffer: ArrayBuffer, ext: string): Promise<string> {
  const e = ext.toLowerCase();
  if (e === 'tiff' || e === 'tif') return decodeTiff(buffer);
  if (e === 'heic' || e === 'heif') return decodeHeic(buffer);
  throw new Error(`Unsupported image format for decoding: ${ext}`);
}

async function decodeTiff(buffer: ArrayBuffer): Promise<string> {
  const UTIF = (await import('utif')).default;
  const ifds = UTIF.decode(buffer);
  const first = ifds[0];
  if (!first) throw new Error('TIFF: no image data found');
  UTIF.decodeImage(buffer, first);
  const rgba = UTIF.toRGBA8(first);
  if (!first.width || !first.height) throw new Error('TIFF: invalid dimensions');

  const canvas = document.createElement('canvas');
  canvas.width = first.width;
  canvas.height = first.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('TIFF: canvas 2d context unavailable');
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), first.width, first.height), 0, 0);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('TIFF: PNG encoding failed');
  return URL.createObjectURL(blob);
}

async function decodeHeic(buffer: ArrayBuffer): Promise<string> {
  const heic2any = (await import('heic2any')).default;
  const out = await heic2any({
    blob: new Blob([buffer], { type: 'image/heic' }),
    toType: 'image/png',
  });
  const blob = Array.isArray(out) ? out[0] : out;
  if (!blob) throw new Error('HEIC: conversion produced no output');
  return URL.createObjectURL(blob);
}