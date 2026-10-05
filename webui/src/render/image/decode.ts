// render/image/decode.ts
// 浏览器无法原生解码的图片格式 → 解码后转 objectURL（交给 <img> 显示）。
// - TIFF/TIF：utif 解码到 canvas 再转 PNG blob
// - HEIC/HEIF：heic2any（内嵌 libheif wasm）转 PNG blob
// - Netpbm（pbm/pgm/ppm/pnm/pam）：自写解码器 → canvas
// - TGA（未压缩 / RLE truecolor、grayscale）：自写解码器 → canvas
// - JPEG2000（jp2/j2k/jpf/jpx）：@cornerstonejs/codec-openjpeg（WASM，按需加载）
// 均为懒加载；失败由调用方回退到「无法预览」卡片。

/** 单张解码输出像素上限（超限拒绝，防低配机 OOM） */
const MAX_PIXELS = 30_000_000;

/** 解码图片为可显示的 objectURL（调用方负责在卸载时 revoke） */
export async function decodeImageToObjectUrl(buffer: ArrayBuffer, ext: string): Promise<string> {
  const e = ext.toLowerCase();
  if (e === 'tiff' || e === 'tif') return decodeTiff(buffer);
  if (e === 'heic' || e === 'heif') return decodeHeic(buffer);
  if (e === 'pbm' || e === 'pgm' || e === 'ppm' || e === 'pnm' || e === 'pam') return decodeNetpbm(buffer);
  if (e === 'tga') return decodeTga(buffer);
  if (e === 'jp2' || e === 'j2k' || e === 'jpf' || e === 'jpx') return decodeJpeg2000(buffer);
  throw new Error(`Unsupported image format for decoding: ${ext}`);
}

// ── 公共：RGBA 像素 → PNG objectURL ──────────────────────────────────────────
async function rgbaToObjectUrl(rgba: Uint8ClampedArray, width: number, height: number): Promise<string> {
  if (!width || !height) throw new Error('invalid dimensions');
  if (width * height > MAX_PIXELS) throw new Error('image too large to decode');
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  ctx.putImageData(new ImageData(rgba as unknown as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('PNG encoding failed');
  return URL.createObjectURL(blob);
}

// ── TIFF ─────────────────────────────────────────────────────────────────────
async function decodeTiff(buffer: ArrayBuffer): Promise<string> {
  const UTIF = (await import('utif')).default;
  const ifds = UTIF.decode(buffer);
  const first = ifds[0];
  if (!first) throw new Error('TIFF: no image data found');
  UTIF.decodeImage(buffer, first);
  const rgba = UTIF.toRGBA8(first);
  if (!first.width || !first.height) throw new Error('TIFF: invalid dimensions');
  return rgbaToObjectUrl(new Uint8ClampedArray(rgba), first.width, first.height);
}

// ── HEIC ─────────────────────────────────────────────────────────────────────
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

// ── Netpbm（P1-P7） ──────────────────────────────────────────────────────────
/** 字节级 token 扫描器：跳过空白与 '#' 注释行 */
class TokenScanner {
  private pos = 0;
  constructor(private readonly bytes: Uint8Array) {}
  /** 读取下一个非空 token（返回 ASCII 字符串）；EOF 返回 null */
  next(): string | null {
    const b = this.bytes;
    // 跳过空白 / 注释
    for (;;) {
      while (this.pos < b.length && isSpace(b[this.pos])) this.pos++;
      if (this.pos < b.length && b[this.pos] === 0x23) {
        // '#'
        while (this.pos < b.length && b[this.pos] !== 0x0a) this.pos++;
        continue;
      }
      break;
    }
    if (this.pos >= b.length) return null;
    const start = this.pos;
    while (this.pos < b.length && !isSpace(b[this.pos]) && b[this.pos] !== 0x23) this.pos++;
    return String.fromCharCode(...b.subarray(start, this.pos));
  }
  /** 当前字节位置（跳过 token 后的空白由调用方决定） */
  get offset(): number {
    return this.pos;
  }
  /** 跳过一个空白字节（二进制数据前通常紧跟一个空白） */
  skipOneSpace(): void {
    if (this.pos < this.bytes.length && isSpace(this.bytes[this.pos])) this.pos++;
  }
}

function isSpace(c: number): boolean {
  return c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d || c === 0x0b || c === 0x0c;
}

function scaleTo8(v: number, maxval: number): number {
  if (maxval <= 0) return 0;
  if (maxval === 255) return v & 0xff;
  return Math.round((v * 255) / maxval);
}

async function decodeNetpbm(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  const sc = new TokenScanner(bytes);
  const magic = sc.next();
  if (!magic || magic[0] !== 'P') throw new Error('Netpbm: bad magic');
  const type = Number(magic[1]);

  // P7（PAM）使用键值头
  if (type === 7) {
    let width = 0;
    let height = 0;
    let depth = 0;
    let maxval = 255;
    let tuple = '';
    for (;;) {
      const key = sc.next();
      if (key === null) throw new Error('Netpbm: PAM header truncated');
      if (key === 'ENDHDR') break;
      const lk = key.toUpperCase();
      if (lk === 'WIDTH') width = Number(sc.next());
      else if (lk === 'HEIGHT') height = Number(sc.next());
      else if (lk === 'DEPTH') depth = Number(sc.next());
      else if (lk === 'MAXVAL') maxval = Number(sc.next());
      else if (lk === 'TUPLTYPE') tuple = sc.next() ?? '';
      else sc.next(); // 未知值跳过
    }
    sc.skipOneSpace();
    const rgba = new Uint8ClampedArray(width * height * 4);
    const data = bytes.subarray(sc.offset);
    const bytesPerSample = maxval > 255 ? 2 : 1;
    for (let i = 0; i < width * height; i++) {
      const s: number[] = [];
      for (let c = 0; c < depth; c++) {
        const idx = (i * depth + c) * bytesPerSample;
        const raw = bytesPerSample === 2 ? (data[idx] << 8) | data[idx + 1] : data[idx];
        s.push(scaleTo8(raw ?? 0, maxval));
      }
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 255;
      if (tuple.startsWith('RGB_ALPHA') || depth === 4) {
        r = s[0] ?? 0;
        g = s[1] ?? 0;
        b = s[2] ?? 0;
        a = s[3] ?? 255;
      } else if (tuple.startsWith('GRAYSCALE_ALPHA')) {
        r = g = b = s[0] ?? 0;
        a = s[1] ?? 255;
      } else if (depth >= 3) {
        r = s[0] ?? 0;
        g = s[1] ?? 0;
        b = s[2] ?? 0;
      } else {
        r = g = b = s[0] ?? 0;
      }
      rgba[i * 4] = r;
      rgba[i * 4 + 1] = g;
      rgba[i * 4 + 2] = b;
      rgba[i * 4 + 3] = a;
    }
    return rgbaToObjectUrl(rgba, width, height);
  }

  const width = Number(sc.next());
  const height = Number(sc.next());
  const maxval = type === 1 || type === 4 ? 1 : Number(sc.next());
  if (!width || !height) throw new Error('Netpbm: bad dimensions');
  const rgba = new Uint8ClampedArray(width * height * 4);

  if (type === 1 || type === 2 || type === 3) {
    // ASCII
    for (let i = 0; i < width * height; i++) {
      if (type === 1) {
        const v = Number(sc.next());
        const c = v ? 0 : 255; // PBM: 1=black
        rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = c;
      } else if (type === 2) {
        const c = scaleTo8(Number(sc.next()), maxval);
        rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = c;
      } else {
        rgba[i * 4] = scaleTo8(Number(sc.next()), maxval);
        rgba[i * 4 + 1] = scaleTo8(Number(sc.next()), maxval);
        rgba[i * 4 + 2] = scaleTo8(Number(sc.next()), maxval);
      }
      rgba[i * 4 + 3] = 255;
    }
    return rgbaToObjectUrl(rgba, width, height);
  }

  // 二进制 P4/P5/P6
  sc.skipOneSpace();
  const data = bytes.subarray(sc.offset);
  if (type === 4) {
    // 1-bit，行按字节对齐
    const rowBytes = Math.ceil(width / 8);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const byte = data[y * rowBytes + (x >> 3)] ?? 0;
        const bit = (byte >> (7 - (x & 7))) & 1;
        const c = bit ? 0 : 255;
        const i = y * width + x;
        rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = c;
        rgba[i * 4 + 3] = 255;
      }
    }
  } else if (type === 5) {
    const bytesPerSample = maxval > 255 ? 2 : 1;
    for (let i = 0; i < width * height; i++) {
      const idx = i * bytesPerSample;
      const raw = bytesPerSample === 2 ? ((data[idx] ?? 0) << 8) | (data[idx + 1] ?? 0) : (data[idx] ?? 0);
      const c = scaleTo8(raw, maxval);
      rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = c;
      rgba[i * 4 + 3] = 255;
    }
  } else if (type === 6) {
    const bytesPerSample = maxval > 255 ? 2 : 1;
    for (let i = 0; i < width * height; i++) {
      const base = i * 3 * bytesPerSample;
      for (let c = 0; c < 3; c++) {
        const idx = base + c * bytesPerSample;
        const raw = bytesPerSample === 2 ? ((data[idx] ?? 0) << 8) | (data[idx + 1] ?? 0) : (data[idx] ?? 0);
        rgba[i * 4 + c] = scaleTo8(raw, maxval);
      }
      rgba[i * 4 + 3] = 255;
    }
  } else {
    throw new Error(`Netpbm: unsupported type P${type}`);
  }
  return rgbaToObjectUrl(rgba, width, height);
}

// ── TGA ──────────────────────────────────────────────────────────────────────
async function decodeTga(buffer: ArrayBuffer): Promise<string> {
  const b = new Uint8Array(buffer);
  if (b.length < 18) throw new Error('TGA: header truncated');
  const idLength = b[0];
  const colorMapType = b[1];
  const imageType = b[2];
  const width = b[12] | (b[13] << 8);
  const height = b[14] | (b[15] << 8);
  const bpp = b[16];
  const descriptor = b[17];
  if (colorMapType !== 0) throw new Error('TGA: color-mapped images not supported');
  if (!width || !height) throw new Error('TGA: bad dimensions');
  if (width * height > MAX_PIXELS) throw new Error('TGA: image too large');
  const isRle = imageType === 10 || imageType === 11;
  const isGray = imageType === 3 || imageType === 11;
  const isTruecolor = imageType === 2 || imageType === 10;
  if (!isGray && !isTruecolor) throw new Error(`TGA: unsupported image type ${imageType}`);
  const bytesPerPixel = bpp / 8;
  if (isTruecolor && bpp !== 24 && bpp !== 32) throw new Error(`TGA: unsupported bpp ${bpp}`);
  if (isGray && bpp !== 8) throw new Error(`TGA: unsupported gray bpp ${bpp}`);

  let p = 18 + idLength;
  const pixelCount = width * height;
  const rgba = new Uint8ClampedArray(pixelCount * 4);

  const writePixel = (i: number, data: Uint8Array, off: number): void => {
    if (isGray) {
      rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = data[off] ?? 0;
      rgba[i * 4 + 3] = 255;
    } else {
      // TGA 为 BGRA
      rgba[i * 4] = data[off + 2] ?? 0;
      rgba[i * 4 + 1] = data[off + 1] ?? 0;
      rgba[i * 4 + 2] = data[off] ?? 0;
      rgba[i * 4 + 3] = bytesPerPixel === 4 ? (data[off + 3] ?? 255) : 255;
    }
  };

  if (!isRle) {
    for (let i = 0; i < pixelCount; i++) {
      writePixel(i, b, p);
      p += bytesPerPixel;
    }
  } else {
    let i = 0;
    while (i < pixelCount) {
      const header = b[p++] ?? 0;
      const count = (header & 0x7f) + 1;
      if (header & 0x80) {
        // RLE 包：单像素重复
        for (let k = 0; k < count && i < pixelCount; k++, i++) writePixel(i, b, p);
        p += bytesPerPixel;
      } else {
        // 原始包
        for (let k = 0; k < count && i < pixelCount; k++, i++) {
          writePixel(i, b, p);
          p += bytesPerPixel;
        }
      }
    }
  }

  // 垂直翻转（descriptor bit5 为 0 表示自上而下；TGA 默认自下而上）
  if ((descriptor & 0x20) === 0) {
    const flipped = new Uint8ClampedArray(rgba.length);
    for (let y = 0; y < height; y++) {
      const src = (height - 1 - y) * width * 4;
      flipped.set(rgba.subarray(src, src + width * 4), y * width * 4);
    }
    return rgbaToObjectUrl(flipped, width, height);
  }
  return rgbaToObjectUrl(rgba, width, height);
}

// ── JPEG2000 ─────────────────────────────────────────────────────────────────
interface OpenJpegFrameInfo {
  width: number;
  height: number;
  componentCount: number;
  bitsPerSample: number;
}
interface OpenJpegDecoder {
  getEncodedBuffer(size?: number): Uint8Array;
  getDecodedBuffer(): Uint8Array;
  decode(): void;
  getFrameInfo(): OpenJpegFrameInfo;
}
interface OpenJpegLib {
  J2KDecoder: new () => OpenJpegDecoder;
}
type OpenJpegFactory = (arg?: { locateFile?: (f: string) => string }) => Promise<OpenJpegLib>;

async function decodeJpeg2000(buffer: ArrayBuffer): Promise<string> {
  // 懒加载 wasm 二进制与其 JS 包装（decode-only 版本，体积更小）
  const [{ default: wasmUrl }, mod] = await Promise.all([
    import('@cornerstonejs/codec-openjpeg/decodewasm?url'),
    import('@cornerstonejs/codec-openjpeg/decodewasmjs'),
  ]);
  const factory = ((mod as unknown as { default?: OpenJpegFactory }).default ?? mod) as unknown as OpenJpegFactory;
  const lib = await factory({ locateFile: () => wasmUrl });
  const decoder = new lib.J2KDecoder();
  const encoded = new Uint8Array(buffer);
  const target = decoder.getEncodedBuffer(encoded.length);
  target.set(encoded);
  decoder.decode();
  const info = decoder.getFrameInfo();
  const decoded = decoder.getDecodedBuffer();
  const { width, height, componentCount } = info;
  if (!width || !height) throw new Error('JPEG2000: bad dimensions');
  if (width * height > MAX_PIXELS) throw new Error('JPEG2000: image too large');

  const plane = width * height;
  const rgba = new Uint8ClampedArray(plane * 4);
  // cornerstone openjpeg 输出为 planar（component-major）
  if (componentCount >= 3) {
    for (let i = 0; i < plane; i++) {
      rgba[i * 4] = decoded[i] ?? 0;
      rgba[i * 4 + 1] = decoded[plane + i] ?? 0;
      rgba[i * 4 + 2] = decoded[plane * 2 + i] ?? 0;
      rgba[i * 4 + 3] = componentCount >= 4 ? (decoded[plane * 3 + i] ?? 255) : 255;
    }
  } else {
    for (let i = 0; i < plane; i++) {
      const c = decoded[i] ?? 0;
      rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = c;
      rgba[i * 4 + 3] = 255;
    }
  }
  return rgbaToObjectUrl(rgba, width, height);
}