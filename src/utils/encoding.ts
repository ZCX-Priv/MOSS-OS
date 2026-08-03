// src/utils/encoding.ts
// 统一编码处理：UTF-8 严格验证、BOM 处理、shell 输出智能解码。
// 解决 Windows 中文环境下 GBK/CP936 输出被强制按 UTF-8 解码导致的乱码，
// 以及 BOM 文件读取异常、二进制检测误判中文等问题。

import iconv from 'iconv-lite';

/**
 * 严格验证字节流是否为合法 UTF-8。
 * 拒绝：非法首字节、overlong 编码、surrogate 半区（U+D800-U+DFFF）、超出 Unicode 范围。
 * 用于 isBinaryFile 判定与 shell 输出解码前的编码探测。
 */
export function isValidUtf8(buf: Buffer): boolean {
  let i = 0;
  const len = buf.length;
  while (i < len) {
    const b0 = buf[i];
    // ASCII 单字节
    if (b0 < 0x80) {
      i++;
      continue;
    }
    // 0xC0-0xC1 是 overlong 2 字节序列的非法首字节；0x80-0xBF 是孤立续字节；>0xF4 超出 Unicode
    if (b0 < 0xC2 || b0 > 0xF4) return false;

    let need: number;       // 后续续字节数量
    let minC1 = 0x80;       // 第一个续字节的最小值（防 overlong）
    let maxC1 = 0xBF;       // 第一个续字节的最大值（防 surrogate / 超 Unicode）

    if (b0 < 0xE0) {
      // 2 字节序列：C2-DF + 80-BF
      need = 1;
    } else if (b0 < 0xF0) {
      // 3 字节序列：E0-EF + 2 续字节
      need = 2;
      if (b0 === 0xE0) {
        minC1 = 0xA0; // 防 overlong（U+0000-U+07FF 已由 2 字节覆盖）
      } else if (b0 === 0xED) {
        maxC1 = 0x9F; // 拒绝 surrogate 半区 U+D800-U+DFFF
      }
    } else {
      // 4 字节序列：F0-F4 + 3 续字节
      need = 3;
      if (b0 === 0xF0) {
        minC1 = 0x90; // 防 overlong
      } else if (b0 === 0xF4) {
        maxC1 = 0x8F; // 限制上限 U+10FFFF
      }
    }

    // 截断检测
    if (i + need >= len) return false;

    const c1 = buf[i + 1];
    if (c1 < minC1 || c1 > maxC1) return false;

    // 剩余续字节必须在 0x80-0xBF
    for (let j = 2; j <= need; j++) {
      const c = buf[i + j];
      if (c < 0x80 || c > 0xBF) return false;
    }
    i += 1 + need;
  }
  return true;
}

/** 检测字节流首部是否为 UTF-8 BOM（EF BB BF） */
export function hasUtf8Bom(buf: Buffer): boolean {
  return buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
}

/** 剥离首部 BOM 字符（\uFEFF）；无 BOM 则原样返回 */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}

/**
 * 解码 shell 子进程输出字节流。
 * 优先按 UTF-8 解码（合法时直接返回）；UTF-8 非法则回退到 GBK（Windows 中文系统默认代码页）。
 * iconv-lite 解码失败时最终回退到 UTF-8（含替换字符 U+FFFD）。
 */
export function decodeShellOutput(buf: Buffer): string {
  if (buf.length === 0) return '';
  if (isValidUtf8(buf)) return buf.toString('utf8');
  try {
    return iconv.decode(buf, 'gbk');
  } catch {
    return buf.toString('utf8');
  }
}
