// src/plugins/server/types.ts
// Server 插件类型定义。

import type { Server } from 'node:http';

/** HTTP 请求上下文（Bun.serve fetch handler 内构造） */
export interface HttpRequest {
  method: string;
  url: string;
  /** URL 解析后的 pathname */
  path: string;
  /** URL 查询参数（已解析为对象） */
  query: Record<string, string>;
  /** 请求头 */
  headers: Record<string, string>;
  /** 请求体（已 parse，若 content-type 是 JSON） */
  body: unknown;
  /** 原始 body 文本 */
  rawBody: string;
}

export interface HttpResponse {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
}

/** 路由处理器（params 为路径参数 :id 等） */
export type RouteHandler = (
  req: HttpRequest,
  params?: Record<string, string>,
) => Promise<HttpResponse> | HttpResponse;

/** 已注册路由 */
export interface Route {
  method: string;
  /** 路径模式，支持 :param 占位符 */
  pattern: string;
  handler: RouteHandler;
  /** 是否需要鉴权 */
  auth: boolean;
}

/** Server 插件注册到服务注册表的服务实例 */
export interface ServerInstance {
  /** Bun.serve 返回的实例 */
  readonly raw: Server | unknown;
  readonly host: string;
  readonly port: number;
  readonly baseUrl: string;
  /** 注册额外路由（供其他插件扩展） */
  addRoute(route: Route): void;
  /** 广播 WS 消息到所有连接 */
  broadcastWS(message: unknown): void;
  /** 给指定 session 的 WS 连接发送消息 */
  sendToSession(sessionId: string, message: unknown): void;
  /** 注册 WS 消息处理器 */
  onWSMessage(handler: WSMessageHandler): void;
  /** 停止服务器 */
  stop(): Promise<void>;
}

/** WS 消息处理器 */
export type WSMessageHandler = (msg: WSMessage) => void | Promise<void>;

/** WS 消息统一格式 */
export interface WSMessage {
  type: string;
  sessionId?: string;
  payload: unknown;
}

/** WS 连接信息 */
export interface WSConnection {
  id: string;
  sessionId?: string;
  send(message: unknown): void;
  close(): void;
}
