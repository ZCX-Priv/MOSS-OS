// src/types/word-extractor.d.ts
// word-extractor@1.0.4（CJS 包，module.exports = WordExtractor 构造函数）未提供
// TypeScript 类型声明，tsc 报 TS7016。此处补全 ambient 模块声明。
// 类型签名依据官方 README（morungos/node-word-extractor），export = 匹配其
// `module.exports = WordExtractor` 的 CJS 导出形态（动态 import 经 .default 互操作）。

declare module 'word-extractor' {
  /** extract() 解析成功后的文档视图，各方法均正确处理 UNICODE 字符 */
  interface Document {
    /** 正文文本 */
    getBody(): string;
    /** 脚注文本 */
    getFootnotes(): string;
    /** 尾注文本 */
    getEndnotes(): string;
    /** 页眉页脚文本（includeFooters 默认 true，一并返回） */
    getHeaders(options?: { includeFooters?: boolean }): string;
    /** 仅页脚文本（v1.0.1+） */
    getFooters(): string;
    /** 批注（评论气泡）文本 */
    getAnnotations(): string;
    /** 文本框内容（includeBody/includeHeadersAndFooters 默认 true） */
    getTextboxes(options?: {
      includeBody?: boolean;
      includeHeadersAndFooters?: boolean;
    }): string;
  }

  class WordExtractor {
    /** 从文件路径或 Buffer 解析 Word 文档（.doc OLE 与 .docx 均支持） */
    extract(input: string | Buffer): Promise<Document>;
  }

  export = WordExtractor;
}
