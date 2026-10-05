// render/structured/CertificatePreview.tsx
// 结构化文本预览：X.509 证书（PEM / DER）。
// 自写轻量 ASN.1 DER 解析器 → 提取 subject/issuer/validity/serial/keyAlg/SAN。
// 指纹用 WebCrypto SHA-256 异步计算。解析异常仅降级为提示态。
// 本组件经 React.lazy 懒加载（FilePreviewPane 分发）。

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck } from 'lucide-react';

/** Name（RDNSequence）中 OID → 短名映射 */
const NAME_OIDS: Record<string, string> = {
  '2.5.4.3': 'CN',
  '2.5.4.6': 'C',
  '2.5.4.10': 'O',
  '2.5.4.11': 'OU',
  '2.5.4.7': 'L',
  '2.5.4.8': 'ST',
  '1.2.840.113549.1.9.1': 'E',
};

/** 公钥/签名算法 OID → 名称映射 */
const ALG_OIDS: Record<string, string> = {
  '1.2.840.113549.1.1.1': 'RSA',
  '1.2.840.10045.2.1': 'EC',
  '1.2.840.113549.1.1.5': 'sha1WithRSA',
  '1.2.840.113549.1.1.11': 'sha256WithRSA',
  '1.2.840.113549.1.1.12': 'sha384WithRSA',
  '1.2.840.113549.1.1.13': 'sha512WithRSA',
  '1.2.840.113549.1.1.10': 'RSASSA-PSS',
  '1.2.840.10045.4.3.2': 'ecdsa-with-SHA256',
  '1.2.840.10045.4.3.3': 'ecdsa-with-SHA384',
  '1.2.840.10045.4.3.4': 'ecdsa-with-SHA512',
  '1.3.101.112': 'Ed25519',
  '1.3.101.113': 'Ed448',
};

const OID_SAN = '2.5.29.17';

interface Asn1Node {
  tagClass: number;
  constructed: boolean;
  tagNumber: number;
  offset: number;
  contentStart: number;
  contentEnd: number;
  children: Asn1Node[];
}

/** 极简 DER 读取器：解析 TLV 并递归构造类型 */
class DerReader {
  private readonly buf: Uint8Array;
  private pos: number;
  private readonly limit: number;

  constructor(buf: Uint8Array, pos = 0, limit = buf.length) {
    this.buf = buf;
    this.pos = pos;
    this.limit = limit;
  }

  get done(): boolean {
    return this.pos >= this.limit;
  }

  readNode(): Asn1Node {
    const buf = this.buf;
    const offset = this.pos;
    const first = buf[this.pos];
    if (first === undefined) throw new Error('DER: unexpected end');
    this.pos += 1;
    const tagClass = (first >> 6) & 0x03;
    const constructed = (first & 0x20) !== 0;
    let tagNumber = first & 0x1f;
    if (tagNumber === 0x1f) {
      tagNumber = 0;
      let byte = 0;
      do {
        byte = buf[this.pos];
        if (byte === undefined) throw new Error('DER: bad high tag');
        this.pos += 1;
        tagNumber = (tagNumber << 7) | (byte & 0x7f);
      } while ((byte & 0x80) !== 0);
    }
    let length = buf[this.pos];
    if (length === undefined) throw new Error('DER: unexpected end');
    this.pos += 1;
    if ((length & 0x80) !== 0) {
      const count = length & 0x7f;
      length = 0;
      for (let i = 0; i < count; i++) {
        const byte = buf[this.pos];
        if (byte === undefined) throw new Error('DER: bad length');
        this.pos += 1;
        length = (length << 8) | byte;
      }
    }
    const contentStart = this.pos;
    const contentEnd = contentStart + length;
    if (contentEnd > this.limit) throw new Error('DER: content out of bounds');
    this.pos = contentEnd;
    const node: Asn1Node = { tagClass, constructed, tagNumber, offset, contentStart, contentEnd, children: [] };
    if (constructed) {
      const childReader = new DerReader(buf, contentStart, contentEnd);
      while (!childReader.done) node.children.push(childReader.readNode());
    }
    return node;
  }
}

interface CertInfo {
  subject: string;
  issuer: string;
  notBefore: string;
  notAfter: string;
  serial: string;
  keyAlg: string;
  san: string[];
}

function contentOf(bytes: Uint8Array, node: Asn1Node): Uint8Array {
  return bytes.subarray(node.contentStart, node.contentEnd);
}

function decodeAscii(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    return decodeAscii(bytes);
  }
}

/** OID 内容字节 → 点分字符串 */
function readOidContent(bytes: Uint8Array): string {
  if (bytes.length === 0) return '';
  const arcs: number[] = [];
  const first = bytes[0];
  arcs.push(Math.floor(first / 40));
  arcs.push(first % 40);
  let value = 0;
  for (let i = 1; i < bytes.length; i++) {
    value = (value << 7) | (bytes[i] & 0x7f);
    if ((bytes[i] & 0x80) === 0) {
      arcs.push(value);
      value = 0;
    }
  }
  return arcs.join('.');
}

/** INTEGER 内容字节 → 十进制字符串（BigInt 保证大数正确） */
function readIntegerDecimal(bytes: Uint8Array): string {
  if (bytes.length === 0) return '0';
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value.toString();
}

/** UTCTime / GeneralizedTime → 可读字符串 */
function readTime(bytes: Uint8Array): string {
  const raw = decodeAscii(bytes).trim();
  const utc = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(?:\.\d+)?Z?$/.exec(raw);
  if (utc !== null) {
    const yy = Number(utc[1]);
    const year = yy >= 50 ? 1900 + yy : 2000 + yy;
    const sec = utc[6] !== undefined ? `:${utc[6]}` : '';
    return `${year}-${utc[2]}-${utc[3]} ${utc[4]}:${utc[5]}${sec} UTC`;
  }
  const gen = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(?:\.\d+)?Z?$/.exec(raw);
  if (gen !== null) {
    const sec = gen[6] !== undefined ? `:${gen[6]}` : '';
    return `${gen[1]}-${gen[2]}-${gen[3]} ${gen[4]}:${gen[5]}${sec} UTC`;
  }
  return raw;
}

/** 解码属性值：UTF8String 用 UTF-8，其余按 ASCII 处理 */
function readAttrValue(node: Asn1Node, bytes: Uint8Array): string {
  const content = contentOf(bytes, node);
  if (node.tagNumber === 12) return decodeUtf8(content);
  return decodeAscii(content);
}

/** 解析 Name（RDNSequence）为 `CN=..., O=...` 形式 */
function parseName(node: Asn1Node, bytes: Uint8Array): string {
  const parts: string[] = [];
  const pushAtv = (atv: Asn1Node): void => {
    if (atv.children.length < 2) return;
    const oid = readOidContent(contentOf(bytes, atv.children[0]));
    const value = readAttrValue(atv.children[1], bytes);
    const short = NAME_OIDS[oid] ?? oid;
    parts.push(`${short}=${value}`);
  };
  for (const item of node.children) {
    const head = item.children[0];
    if (head !== undefined && head.tagClass === 0 && head.tagNumber === 6) {
      pushAtv(item);
    } else {
      for (const atv of item.children) pushAtv(atv);
    }
  }
  return parts.join(', ');
}

/** IP 地址 SAN 格式化 */
function formatIp(bytes: Uint8Array): string {
  if (bytes.length === 4) return `${bytes[0]}.${bytes[1]}.${bytes[2]}.${bytes[3]}`;
  if (bytes.length === 16) {
    const groups: string[] = [];
    for (let i = 0; i < 16; i += 2) groups.push(((bytes[i] << 8) | bytes[i + 1]).toString(16));
    return groups.join(':');
  }
  return decodeAscii(bytes);
}

/** 从 [3] extensions 中提取 SAN */
function extractSan(extensions: Asn1Node | undefined, bytes: Uint8Array): string[] {
  const san: string[] = [];
  if (extensions === undefined) return san;
  // [3] extensions 为 EXPLICIT 标签，标准编码会额外包一层 SEQUENCE OF Extension
  let extList = extensions.children;
  if (extList.length === 1) {
    const only = extList[0];
    const head = only.children[0];
    if (only.tagClass === 0 && only.tagNumber === 16 && head !== undefined && head.tagClass === 0 && head.tagNumber === 16) {
      extList = only.children;
    }
  }
  for (const ext of extList) {
    if (ext.children.length < 2) continue;
    const oid = readOidContent(contentOf(bytes, ext.children[0]));
    if (oid !== OID_SAN) continue;
    const octet = ext.children.find((c) => c.tagClass === 0 && c.tagNumber === 4);
    if (octet === undefined) continue;
    const valueBytes = contentOf(bytes, octet);
    const reader = new DerReader(valueBytes);
    const generalNames = reader.readNode();
    for (const name of generalNames.children) {
      if (name.tagClass !== 2) continue;
      const content = contentOf(valueBytes, name);
      if (name.tagNumber === 2 || name.tagNumber === 1 || name.tagNumber === 6) {
        san.push(decodeAscii(content));
      } else if (name.tagNumber === 7) {
        san.push(formatIp(content));
      }
    }
  }
  return san;
}

function parseCertificate(der: Uint8Array): CertInfo {
  const reader = new DerReader(der);
  const cert = reader.readNode();
  if (cert.tagNumber !== 16 || cert.children.length < 3) throw new Error('DER: not a certificate');
  const tbs = cert.children[0];
  let idx = 0;
  const first = tbs.children[0];
  if (first !== undefined && first.tagClass === 2 && first.tagNumber === 0) idx = 1;

  const serialNode = tbs.children[idx];
  const issuerNode = tbs.children[idx + 2];
  const validityNode = tbs.children[idx + 3];
  const subjectNode = tbs.children[idx + 4];
  const spkiNode = tbs.children[idx + 5];
  if (serialNode === undefined || issuerNode === undefined || validityNode === undefined || subjectNode === undefined || spkiNode === undefined) {
    throw new Error('DER: incomplete tbsCertificate');
  }

  const validity = validityNode.children;
  const notBeforeNode = validity[0];
  const notAfterNode = validity[1];

  const spkiAlg = spkiNode.children[0];
  let keyAlg = '';
  if (spkiAlg !== undefined && spkiAlg.children[0] !== undefined) {
    const algOid = readOidContent(contentOf(der, spkiAlg.children[0]));
    keyAlg = ALG_OIDS[algOid] ?? algOid;
  }

  const extensions = tbs.children.find((c) => c.tagClass === 2 && c.tagNumber === 3);

  return {
    subject: parseName(subjectNode, der),
    issuer: parseName(issuerNode, der),
    notBefore: notBeforeNode !== undefined ? readTime(contentOf(der, notBeforeNode)) : '',
    notAfter: notAfterNode !== undefined ? readTime(contentOf(der, notAfterNode)) : '',
    serial: readIntegerDecimal(contentOf(der, serialNode)),
    keyAlg,
    san: extractSan(extensions, der),
  };
}

/** PEM → DER；否则按原始 DER 处理 */
function decodeCertificate(buffer: ArrayBuffer): Uint8Array | null {
  const bytes = new Uint8Array(buffer);
  const head = decodeAscii(bytes.subarray(0, Math.min(bytes.length, 64)));
  if (head.includes('-----BEGIN CERTIFICATE-----')) {
    const text = decodeUtf8(bytes);
    const match = /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/.exec(text);
    if (match === null) return null;
    const base64 = match[1].replace(/[^A-Za-z0-9+/=]/g, '');
    try {
      const binary = atob(base64);
      const der = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) der[i] = binary.charCodeAt(i);
      return der;
    } catch {
      return null;
    }
  }
  return bytes;
}

export interface CertificatePreviewProps {
  buffer: ArrayBuffer;
  ext: string;
}

export function CertificatePreview({ buffer }: CertificatePreviewProps) {
  const { t } = useTranslation();
  const [fingerprint, setFingerprint] = useState<string | null>(null);

  const parsed = useMemo<{ der: Uint8Array | null; info: CertInfo | null }>(() => {
    try {
      const der = decodeCertificate(buffer);
      if (der === null) return { der: null, info: null };
      const info = parseCertificate(der);
      return { der, info };
    } catch {
      return { der: null, info: null };
    }
  }, [buffer]);

  const der = parsed.der;

  useEffect(() => {
    if (der === null) {
      setFingerprint(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const copy = new Uint8Array(der.byteLength);
        copy.set(der);
        const digest = await crypto.subtle.digest('SHA-256', copy.buffer as ArrayBuffer);
        if (cancelled) return;
        const view = new Uint8Array(digest);
        const hex = Array.from(view)
          .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
          .join(':');
        setFingerprint(hex);
      } catch {
        if (!cancelled) setFingerprint(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [der]);

  const info = parsed.info;

  if (info === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-muted-foreground">
        <ShieldCheck className="size-6" />
        <div className="text-sm">{t('preview.certParseFailed')}</div>
        <div className="max-w-md text-center text-xs">{t('preview.certDerHint')}</div>
      </div>
    );
  }

  const rows: Array<{ label: string; value: string }> = [
    { label: t('preview.certSubject'), value: info.subject },
    { label: t('preview.certIssuer'), value: info.issuer },
    { label: t('preview.certValidFrom'), value: info.notBefore },
    { label: t('preview.certValidTo'), value: info.notAfter },
    { label: t('preview.certSerial'), value: info.serial },
    { label: t('preview.certKeyAlg'), value: info.keyAlg },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-auto">
      <div className="flex shrink-0 items-center gap-1.5 px-1 text-xs text-muted-foreground">
        <ShieldCheck className="size-3.5" />
        <span className="text-foreground">{t('preview.certTitle')}</span>
      </div>

      <div className="overflow-hidden rounded border border-border">
        <table className="data-table w-full border-collapse text-xs">
          <tbody>
            {rows.map((row, index) => (
              <tr key={index} className="border-b border-border/60 align-top last:border-b-0">
                <th className="w-32 border-r border-border/60 bg-muted/40 px-2 py-1 text-left font-medium text-muted-foreground">
                  {row.label}
                </th>
                <td className="break-all px-2 py-1 font-mono text-foreground">{row.value}</td>
              </tr>
            ))}
            <tr className="align-top">
              <th className="w-32 border-r border-border/60 bg-muted/40 px-2 py-1 text-left font-medium text-muted-foreground">
                {t('preview.certSan')}
              </th>
              <td className="px-2 py-1 font-mono text-foreground">
                {info.san.length === 0 ? (
                  <span className="text-muted-foreground">-</span>
                ) : (
                  <div className="flex flex-col gap-0.5">
                    {info.san.map((entry, i) => (
                      <span key={i} className="break-all">
                        {entry}
                      </span>
                    ))}
                  </div>
                )}
              </td>
            </tr>
            <tr className="align-top">
              <th className="w-32 border-r border-border/60 bg-muted/40 px-2 py-1 text-left font-medium text-muted-foreground">
                {t('preview.certFingerprint')}
              </th>
              <td className="break-all px-2 py-1 font-mono text-foreground">
                {fingerprint !== null ? fingerprint : <span className="text-muted-foreground">-</span>}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}