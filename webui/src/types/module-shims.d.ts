// src/types/module-shims.d.ts
// 第三方库类型补充：库未随包提供 TypeScript 声明时的最小结构声明。
// 护栏：任何第三方样式表一律不得全局 import（历史事故：PPT 编辑器库的 styles 是
// 全文档级 Tailwind preflight + :root 主题变量，注入后污染整站）。若确实需要，
// 必须走 ?inline + 选择器加前缀的作用域化方案。

declare module 'utif' {
  interface UtifIFD {
    width: number;
    height: number;
  }
  interface UtifModule {
    /** 解析 TIFF，返回全部 IFD（图像文件目录） */
    decode(buffer: ArrayBuffer | Uint8Array): UtifIFD[];
    /** 解码指定 IFD 的图像数据（就地写入 ifd） */
    decodeImage(buffer: ArrayBuffer | Uint8Array, ifd: UtifIFD): void;
    /** 转 RGBA8 像素数组 */
    toRGBA8(ifd: UtifIFD): Uint8Array;
  }
  const UTIF: UtifModule;
  export default UTIF;
}