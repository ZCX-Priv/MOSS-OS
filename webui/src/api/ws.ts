// UI/src/api/ws.ts
// WebSocket 客户端：自动重连。迁移自 webui/src/api/ws.ts，无业务改动。

import type { WSMessage } from '../types/api';

type MessageHandler = (msg: WSMessage) => void;
type StatusHandler = (status: 'connecting' | 'open' | 'closed' | 'error') => void;

export class WSClient {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectAttempts = 0;
  private reconnectDelay = 1000;
  private shouldReconnect = true;
  private messageHandlers = new Set<MessageHandler>();
  private statusHandlers = new Set<StatusHandler>();
  private pendingMessages: WSMessage[] = [];
  /** 心跳定时器 */
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastPong = 0;
  /** 心跳间隔与超时（毫秒） */
  private static readonly HEARTBEAT_INTERVAL = 15_000;
  private static readonly HEARTBEAT_TIMEOUT = 30_000;
  /** 断连期间积压消息上限，超出丢弃最旧 */
  private static readonly MAX_PENDING = 500;

  constructor(url?: string) {
    // 默认使用当前页面同源的 ws:// 或 wss://
    if (url) {
      this.url = url;
    } else {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      this.url = `${proto}//${window.location.host}/ws`;
    }
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    this.notifyStatus('connecting');

    try {
      this.ws = new WebSocket(this.url);
    } catch (err) {
      this.notifyStatus('error');
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.notifyStatus('open');
      this.startHeartbeat();
      // 发送积压消息
      while (this.pendingMessages.length > 0) {
        const msg = this.pendingMessages.shift()!;
        this.ws?.send(JSON.stringify(msg));
      }
    };

    this.ws.onmessage = (event) => {
      // 任何到达的数据都视为连接存活，重置心跳
      this.lastPong = Date.now();
      try {
        const msg = JSON.parse(event.data) as WSMessage;
        for (const h of this.messageHandlers) {
          try {
            h(msg);
          } catch (err) {
            console.error('WS message handler error:', err);
          }
        }
      } catch {
        // 非 JSON 消息忽略
      }
    };

    this.ws.onerror = () => {
      this.notifyStatus('error');
    };

    this.ws.onclose = () => {
      this.stopHeartbeat();
      this.notifyStatus('closed');
      if (this.shouldReconnect) {
        this.scheduleReconnect();
      }
    };
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.stopHeartbeat();
    this.ws?.close();
    this.ws = null;
  }

  send(msg: WSMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      if (this.pendingMessages.length >= WSClient.MAX_PENDING) {
        // 丢弃最旧，避免弱网下无限积压
        this.pendingMessages.shift();
      }
      this.pendingMessages.push(msg);
      this.connect();
    }
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onStatus(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  /** 心跳：周期性发 ping，超过超时未收到任何数据则判定连接僵死并主动断开触发重连 */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.lastPong = Date.now();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ type: 'ping' }));
        } catch {
          // 发送失败视为断开
        }
        if (Date.now() - this.lastPong > WSClient.HEARTBEAT_TIMEOUT) {
          // 僵死连接：主动关闭以触发 onclose → 重连
          this.ws.close();
        }
      }
    }, WSClient.HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    // 指数退避 + 抖动，封顶 30s；不设固定次数上限，弱网下持续重连
    this.reconnectAttempts++;
    const base = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 30000);
    const delay = base + Math.random() * 500;
    setTimeout(() => {
      if (this.shouldReconnect) this.connect();
    }, delay);
  }

  private notifyStatus(status: 'connecting' | 'open' | 'closed' | 'error'): void {
    for (const h of this.statusHandlers) {
      try {
        h(status);
      } catch {
        // 静默
      }
    }
  }
}

export const wsClient = new WSClient();
