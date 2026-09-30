// src/types/module-shims.d.ts
// 第三方库类型补充：库未随包提供 TypeScript 声明时的最小结构声明。

/** pptx-react-viewer 的样式表入口（exports map 暴露，无类型声明） */
declare module 'pptx-react-viewer/styles';
declare module 'pptx-react-viewer/styles.css';

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