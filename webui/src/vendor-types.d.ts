// 第三方模块的类型补充声明（这些包未提供或未导出类型入口）。
// 目的：在严格模式下避免「隐式 any」，同时不引入额外 @types 依赖。

declare module 'sql.js' {
  export interface SqlJsConfig {
    locateFile?: (file: string) => string;
  }
  /** 默认导出：初始化函数，返回 SQL 模块（Database 构造函数） */
  const initSqlJs: (config?: SqlJsConfig) => Promise<unknown>;
  export default initSqlJs;
}

declare module '@cornerstonejs/codec-openjpeg/decodewasmjs' {
  /** 默认导出：Emscripten 工厂函数，接收 moduleArg（含 locateFile）并返回库对象 */
  const factory: unknown;
  export default factory;
}