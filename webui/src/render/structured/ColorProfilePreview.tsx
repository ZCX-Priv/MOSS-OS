// render/structured/ColorProfilePreview.tsx
// 结构化文本预览：ICC 色彩配置文件。
// 解析大端 ICC 头与 tag 表 → 头部字段表 + tag 列表。
// 解析异常仅降级为提示态，绝不抛错影响父组件。
// 本组件经 React.lazy 懒加载（FilePreviewPane 分发）。

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Palette } from 'lucide-react';

/** ICC 头部长度（含 tag 计数字段） */
const HEADER_SIZE = 132;
/** 单个 tag 表项字节数 */
const TAG_ENTRY_SIZE = 12;

interface IccTag {
  sig: string;
  offset: number;
  size: number;
}

interface IccInfo {
  fileSize: number;
  cmm: string;
  version: string;
  deviceClass: string;
  colorSpace: string;
  pcs: string;
  tags: IccTag[];
}

/** 设备类别签名 → 名称 */
const CLASS_NAMES: Record<string, string> = {
  scnr: 'input',
  mntr: 'display',
  prtr: 'output',
  link: 'device link',
  spac: 'color space',
  abst: 'abstract',
  nmcl: 'named color',
};

/** tag 签名 → 名称 */
const TAG_NAMES: Record<string, string> = {
  desc: 'description',
  cprt: 'copyright',
  wtpt: 'media white point',
  rXYZ: 'primaries',
  gXYZ: 'primaries',
  bXYZ: 'primaries',
  rTRC: 'tone curves',
  gTRC: 'tone curves',
  bTRC: 'tone curves',
  A2B0: 'transform',
  B2A0: 'transform',
  chad: 'chromatic adaptation',
};

/** 读取 4 字节 ASCII 签名（跳过末尾空格与 NUL 填充） */
function readSig(view: DataView, offset: number): string {
  let out = '';
  for (let i = 0; i < 4; i++) {
    const code = view.getUint8(offset + i);
    if (code === 0 || code === 32) continue;
    out += String.fromCharCode(code);
  }
  return out;
}

function parseIcc(buffer: ArrayBuffer): IccInfo | null {
  if (buffer.byteLength < HEADER_SIZE) return null;
  const view = new DataView(buffer);
  const magic = readSig(view, 36);
  if (magic !== 'acsp') return null;

  const fileSize = view.getUint32(0, false);
  const cmm = readSig(view, 4);
  const versionRaw = view.getUint32(8, false);
  const major = (versionRaw >>> 24) & 0xff;
  const minor = (versionRaw >>> 20) & 0x0f;
  const deviceClass = readSig(view, 12);
  const colorSpace = readSig(view, 16);
  const pcs = readSig(view, 20);

  const tagCount = view.getUint32(128, false);
  const maxTags = Math.min(tagCount, Math.floor((buffer.byteLength - HEADER_SIZE) / TAG_ENTRY_SIZE));
  const tags: IccTag[] = [];
  for (let i = 0; i < maxTags; i++) {
    const base = HEADER_SIZE + i * TAG_ENTRY_SIZE;
    tags.push({
      sig: readSig(view, base),
      offset: view.getUint32(base + 4, false),
      size: view.getUint32(base + 8, false),
    });
  }

  return {
    fileSize,
    cmm,
    version: `${major}.${minor}`,
    deviceClass,
    colorSpace,
    pcs,
    tags,
  };
}

export interface ColorProfilePreviewProps {
  buffer: ArrayBuffer;
}

export function ColorProfilePreview({ buffer }: ColorProfilePreviewProps) {
  const { t } = useTranslation();

  const info = useMemo<IccInfo | null>(() => {
    try {
      return parseIcc(buffer);
    } catch {
      return null;
    }
  }, [buffer]);

  if (info === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-muted-foreground">
        <Palette className="size-6" />
        <div className="text-sm">{t('preview.iccParseFailed')}</div>
      </div>
    );
  }

  const headerRows: Array<{ label: string; value: string }> = [
    { label: t('preview.iccColorSpace'), value: info.colorSpace },
    { label: t('preview.iccPcs'), value: info.pcs },
    { label: t('preview.iccVersion'), value: info.version },
    { label: t('preview.iccDeviceClass'), value: CLASS_NAMES[info.deviceClass] ?? info.deviceClass },
    { label: 'Size', value: `${info.fileSize} B` },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-auto">
      <div className="flex shrink-0 items-center gap-1.5 px-1 text-xs text-muted-foreground">
        <Palette className="size-3.5" />
        <span className="text-foreground">{t('preview.iccTitle')}</span>
      </div>

      <div className="overflow-hidden rounded border border-border">
        <table className="data-table w-full border-collapse text-xs">
          <tbody>
            {headerRows.map((row, index) => (
              <tr key={index} className="border-b border-border/60 last:border-b-0">
                <th className="w-32 border-r border-border/60 bg-muted/40 px-2 py-1 text-left font-medium text-muted-foreground">
                  {row.label}
                </th>
                <td className="break-all px-2 py-1 font-mono text-foreground">{row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 px-1 text-xs text-muted-foreground">
        <span className="text-foreground">{t('preview.iccTags', { count: info.tags.length })}</span>
      </div>

      <div className="min-h-0 overflow-auto rounded border border-border">
        <table className="data-table w-full border-collapse text-xs">
          <thead className="sticky top-0 bg-muted">
            <tr>
              <th className="border-b border-r border-border/60 px-2 py-1 text-left font-medium text-foreground">
                {t('preview.iccTagName')}
              </th>
              <th className="border-b border-r border-border/60 px-2 py-1 text-left font-medium text-foreground">sig</th>
              <th className="border-b border-border/60 px-2 py-1 text-right font-medium text-foreground">size</th>
            </tr>
          </thead>
          <tbody>
            {info.tags.map((tag, index) => (
              <tr key={index} className="border-b border-border/60 last:border-b-0">
                <td className="px-2 py-1 text-foreground">{TAG_NAMES[tag.sig] ?? tag.sig}</td>
                <td className="border-r border-border/60 px-2 py-1 font-mono text-muted-foreground">{tag.sig}</td>
                <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">{tag.size}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}