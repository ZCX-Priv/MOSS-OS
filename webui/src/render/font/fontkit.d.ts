// render/font/fontkit.d.ts
// fontkit@2.0.4 未随包提供 TypeScript 类型（package.json 无 types 字段）。
// 这里按实际使用面（create / Font / FontCollection / Glyph.path.toSVG）声明最小且精确的类型，
// 避免全项目 any。字段与 src/TTFFont、src/glyph/Glyph、src/base 的实际实现一一对应。
declare module 'fontkit' {
  /** 字形轮廓路径（可导出为 SVG path 数据，用于 canvas 绘制） */
  export interface FontkitPath {
    toSVG(): string;
  }

  export interface FontkitGlyph {
    advanceWidth: number;
    path: FontkitPath;
  }

  export interface FontkitFont {
    postscriptName: string | null;
    fullName: string | null;
    familyName: string | null;
    subfamilyName: string | null;
    version: string | null;
    copyright: string | null;
    unitsPerEm: number;
    ascent: number;
    descent: number;
    capHeight: number;
    xHeight: number;
    numGlyphs: number;
    glyphForCodePoint(codePoint: number): FontkitGlyph;
  }

  /** TrueType/OpenType 集合（.ttc/.otc） */
  export interface FontkitCollection {
    type: string;
    fonts: FontkitFont[];
    getFont(name: string): FontkitFont | null;
  }

  export type FontkitContainer = FontkitFont | FontkitCollection;

  /** 解析字体二进制；postscriptName 用于集合内取指定字体 */
  export function create(buffer: Uint8Array, postscriptName?: string): FontkitContainer;
  export function registerFormat(format: unknown): void;
  export function setDefaultLanguage(lang?: string): void;
  export const logErrors: boolean;
}