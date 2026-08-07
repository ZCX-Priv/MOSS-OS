// UI/src/api/ws.ts
// WebSocket 客户端：自动重连。迁移自 webui/src/api/ws.ts，无业务改动。

import type { WSMessage } from '../types/api';

type MessageHandler = (msg: WSMessage) => void;
type StatusHandler = (status: 'connecting' | 'open' | 'closed' | 'error') => void;

export class WSClient {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private shouldReconnect = true;
  private messageHandlers = new Set<MessageHandler>();
  private statusHandlers = new Set<StatusHandler>();
  private pendingMessages: WSMessage[] = [];

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
      // 发送积压消息
      while (this.pendingMessages.length > 0) {
        const msg = this.pendingMessages.shift()!;
        this.ws?.send(JSON.stringify(msg));
      }
    };

    this.ws.onmessage = (event) => {
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
      this.notifyStatus('closed');
      if (this.shouldReconnect) {
        this.scheduleReconnect();
      }
    };
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.ws?.close();
    this.ws = null;
  }

  send(msg: WSMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
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

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn('WS max reconnect attempts reached');
      return;
    }
    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectDelay * this.reconnectAttempts, 30000);
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
