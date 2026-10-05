// render/flash/SwfPreview.tsx
// SWF（Flash）结构预览：纯解析（不引入 Ruffle 等 Flash 模拟器，避免拖垮低配机器）。
// 展示：签名/版本/声明长度/压缩类型/舞台尺寸/帧率/帧数/标签清单（前若干项）。
// CWS（zlib 压缩）用浏览器原生 DecompressionStream 解压；ZWS（LZMA）仅展示头部。
// 本组件经 React.lazy 懒加载（FilePreviewPane 分发）。

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, TriangleAlert } from 'lucide-react';

export interface SwfPreviewProps {
  buffer: ArrayBuffer;
  fileName: string;
}

interface SwfInfo {
  signature: string;
  version: number;
  declaredLength: number;
  compressed: boolean;
  width: number | null;
  height: number | null;
  frameRate: number | null;
  frameCount: number | null;
  tags: Array<{ code: number; name: string; length: number }>;
  truncatedTags: boolean;
  note: string | null;
}

/** 常见 SWF 标签码 → 名称 */
const TAG_NAMES: Record<number, string> = {
  0: 'End',
  1: 'ShowFrame',
  2: 'DefineShape',
  4: 'PlaceObject',
  5: 'RemoveObject',
  6: 'DefineBits',
  7: 'DefineButton',
  9: 'SetBackgroundColor',
  10: 'DefineFont',
  11: 'DefineText',
  12: 'DoAction',
  13: 'DefineFontInfo',
  18: 'SoundStreamHead',
  19: 'SoundStreamBlock',
  21: 'DefineBitsJPEG2',
  22: 'DefineShape2',
  24: 'Protect',
  26: 'PlaceObject2',
  28: 'RemoveObject2',
  32: 'DefineShape3',
  34: 'DefineButton2',
  35: 'DefineBitsJPEG3',
  36: 'DefineBitsLossless2',
  37: 'DefineEditText',
  39: 'DefineSprite',
  43: 'FrameLabel',
  45: 'SoundStreamHead2',
  46: 'DefineMorphShape',
  48: 'DefineFont2',
  56: 'ExportAssets',
  57: 'ImportAssets',
  59: 'DoInitAction',
  60: 'DefineVideoStream',
  62: 'DefineFontInfo2',
  69: 'FileAttributes',
  70: 'PlaceObject3',
  75: 'DefineFont3',
  76: 'SymbolClass',
  82: 'DoABC',
  83: 'DefineShape4',
  87: 'DefineBinaryData',
  88: 'DefineFontName',
};

const MAX_TAGS = 200;

/** 读取 stage RECT（5-bit nbits + 4×nbits bits）→ { width, height }（twips → px） */
function readRect(bytes: Uint8Array, bitPos: number): { width: number; height: number; bitPos: number } | null {
  const readBits = (count: number): number => {
    let value = 0;
    for (let i = 0; i < count; i++) {
      const byte = bytes[bitPos >> 3];
      if (byte === undefined) throw new Error('eof');
      const bit = (byte >> (7 - (bitPos & 7))) & 1;
      value = (value << 1) | bit;
      bitPos++;
    }
    // 有符号补码
    if (count > 0 && (value & (1 << (count - 1)))) value -= 1 << count;
    return value;
  };
  const nbits = readBits(5);
  const xMin = readBits(nbits);
  const xMax = readBits(nbits);
  const yMin = readBits(nbits);
  const yMax = readBits(nbits);
  return { width: (xMax - xMin) / 20, height: (yMax - yMin) / 20, bitPos };
}

async function parseSwf(buffer: ArrayBuffer): Promise<SwfInfo> {
  const all = new Uint8Array(buffer);
  if (all.length < 8) throw new Error('too short');
  const signature = String.fromCharCode(all[0], all[1], all[2]);
  const version = all[3];
  const view = new DataView(buffer);
  const declaredLength = view.getUint32(4, true);

  let body: Uint8Array;
  let note: string | null = null;
  if (signature === 'FWS') {
    body = all.subarray(8);
  } else if (signature === 'CWS') {
    // zlib 流（0x78 头）
    const compressed = all.subarray(8);
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate'));
    body = new Uint8Array(await new Response(stream).arrayBuffer());
  } else if (signature === 'ZWS') {
    body = new Uint8Array(0);
    note = 'LZMA';
  } else {
    throw new Error(`unknown signature: ${signature}`);
  }

  const info: SwfInfo = {
    signature,
    version,
    declaredLength,
    compressed: signature !== 'FWS',
    width: null,
    height: null,
    frameRate: null,
    frameCount: null,
    tags: [],
    truncatedTags: false,
    note,
  };

  if (body.length === 0) return info;

  // RECT（舞台尺寸）→ 帧率（16.16）→ 帧数（16）
  const rect = readRect(body, 0);
  if (rect) {
    info.width = Math.round(rect.width);
    info.height = Math.round(rect.height);
    // RECT 后按字节对齐
    let bytePos = (rect.bitPos + 7) >> 3;
    if (bytePos + 4 <= body.length) {
      const sub = new DataView(body.buffer, body.byteOffset + bytePos, 4);
      const rateRaw = sub.getUint32(0, true);
      // 高 16 位小数、低 16 位整数
      info.frameRate = Math.round(((rateRaw >> 16) / 256) * 100) / 100;
      bytePos += 4;
      if (bytePos + 2 <= body.length) {
        info.frameCount = new DataView(body.buffer, body.byteOffset + bytePos, 2).getUint16(0, true);
        bytePos += 2;
      }
      // 标签遍历
      while (bytePos + 2 <= body.length) {
        const codeLen = new DataView(body.buffer, body.byteOffset + bytePos, 2).getUint16(0, true);
        const code = codeLen >> 6;
        let length = codeLen & 0x3f;
        bytePos += 2;
        if (length === 0x3f) {
          if (bytePos + 4 > body.length) break;
          length = new DataView(body.buffer, body.byteOffset + bytePos, 4).getInt32(0, true);
          bytePos += 4;
        }
        if (info.tags.length < MAX_TAGS) {
          info.tags.push({ code, name: TAG_NAMES[code] ?? `Tag${code}`, length });
        } else {
          info.truncatedTags = true;
        }
        if (code === 0) break;
        bytePos += length;
      }
    }
  }

  return info;
}

export function SwfPreview({ buffer, fileName }: SwfPreviewProps) {
  const { t } = useTranslation();
  const [info, setInfo] = useState<SwfInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setInfo(null);
    setError(null);
    parseSwf(buffer)
      .then(setInfo)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [buffer]);

  useEffect(() => {
    load();
  }, [load]);

  if (error !== null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-destructive">
        <TriangleAlert className="size-6" />
        <div className="text-sm">{error}</div>
      </div>
    );
  }
  if (info === null) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 size-5 animate-spin" />
        <span className="text-sm">{fileName}</span>
      </div>
    );
  }

  const meta: Array<[string, string]> = [
    ['Signature', info.signature],
    ['Version', String(info.version)],
    ['Declared length', `${info.declaredLength} B`],
    ['Compression', info.compressed ? 'zlib / LZMA' : 'none'],
    ['Stage', info.width !== null && info.height !== null ? `${info.width} × ${info.height} px` : '—'],
    ['Frame rate', info.frameRate !== null ? `${info.frameRate} fps` : '—'],
    ['Frames', info.frameCount !== null ? String(info.frameCount) : '—'],
  ];

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="shrink-0 rounded border border-border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
        {t('preview.swfNotPlayable')}
        {info.note === 'LZMA' ? ` · ${t('preview.swfLzmaLimited')}` : ''}
      </div>
      <div className="grid shrink-0 grid-cols-2 gap-x-4 gap-y-1 rounded border border-border p-3 text-xs sm:grid-cols-3">
        {meta.map(([k, v]) => (
          <div key={k} className="flex flex-col">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{k}</span>
            <span className="font-mono text-foreground">{v}</span>
          </div>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded border border-border">
        <table className="data-table w-full border-collapse text-xs">
          <thead className="sticky top-0 bg-muted">
            <tr>
              <th className="border-b border-r border-border/60 px-2 py-1 text-left font-medium text-foreground">#</th>
              <th className="border-b border-r border-border/60 px-2 py-1 text-left font-medium text-foreground">Tag</th>
              <th className="border-b border-border/60 px-2 py-1 text-right font-medium text-foreground">Size</th>
            </tr>
          </thead>
          <tbody>
            {info.tags.map((tag, i) => (
              <tr key={i} className="border-b border-border/60">
                <td className="border-r border-border/60 px-2 py-1 text-muted-foreground tabular-nums">{i + 1}</td>
                <td className="border-r border-border/60 px-2 py-1 font-mono text-foreground">
                  {tag.name} <span className="text-muted-foreground">({tag.code})</span>
                </td>
                <td className="px-2 py-1 text-right text-muted-foreground tabular-nums">{tag.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {info.truncatedTags && (
          <div className="px-2 py-1 text-[11px] text-muted-foreground">{t('preview.swfTagsTruncated', { count: MAX_TAGS })}</div>
        )}
      </div>
    </div>
  );
}