// src/modules/server/voice-session-host.ts
// WS 语音会话宿主：为每条连接维护一个语音识别会话，驱动解码与结果回推。
//
// 协议（客户端 ↔ 服务端）：
//   客户端 → 服务端：
//     {"type":"voice.start","modelId?":"..."}  开始录音（创建会话）
//     二进制帧（PCM int16 LE @16kHz 单声道）    音频流
//     {"type":"voice.stop"}                     结束录音（冲刷最终结果）
//   服务端 → 客户端：
//     {"type":"voice.ready"}                    会话就绪
//     {"type":"voice.partial","text":"..."}     中间态文本（可被覆盖）
//     {"type":"voice.final","text":"..."}       确定文本
//     {"type":"voice.stopped"}                  会话已结束
//     {"type":"voice.error","error":"..."}      错误

import type { Logger, ServiceRegistry } from '../../core/types';
import { ServiceNames } from '../../core/types';
import type { VoiceService, VoiceSession } from '../voice';

/** poll 单次 tick 的最大产出条数（防御性上限） */
const MAX_POLLS_PER_TICK = 8;
/** 解码驱动间隔（毫秒）：流式引擎据此节流 decode */
const TICK_INTERVAL_MS = 100;

interface VoiceEntry {
  session: VoiceSession;
  timer: ReturnType<typeof setInterval>;
  send: (msg: unknown) => void;
}

export class VoiceSessionHost {
  private readonly entries = new Map<string, VoiceEntry>();

  constructor(
    private readonly services: ServiceRegistry,
    private readonly logger: Logger,
  ) {}

  /** 开始会话（幂等：重复 start 先结束旧会话） */
  async start(connId: string, send: (msg: unknown) => void, modelId?: string): Promise<void> {
    await this.stop(connId);

    const service = this.services.tryResolve<VoiceService>(ServiceNames.VOICE_SERVICE);
    if (!service) {
      send({ type: 'voice.error', payload: { error: 'VOICE_UNAVAILABLE' } });
      return;
    }
    if (!service.getStatus().enabled) {
      send({ type: 'voice.error', payload: { error: 'VOICE_DISABLED' } });
      return;
    }

    try {
      const session = await service.createSession(modelId);
      const timer = setInterval(() => this.tick(connId), TICK_INTERVAL_MS);
      this.entries.set(connId, { session, timer, send });
      send({ type: 'voice.ready' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn('voice session start failed', { error: message });
      send({ type: 'voice.error', payload: { error: message } });
    }
  }

  /** 接收二进制音频帧（PCM int16 LE → float32） */
  acceptBinary(connId: string, buf: Buffer): void {
    const entry = this.entries.get(connId);
    if (!entry) return;
    const count = Math.floor(buf.byteLength / 2);
    if (count === 0) return;
    const samples = new Float32Array(count);
    for (let i = 0; i < count; i++) samples[i] = buf.readInt16LE(i * 2) / 32768;
    entry.session.acceptSamples(samples);
  }

  /** 结束会话并冲刷最终结果 */
  async stop(connId: string): Promise<void> {
    const entry = this.entries.get(connId);
    if (!entry) return;
    this.entries.delete(connId);
    clearInterval(entry.timer);
    try {
      const final = await entry.session.finish();
      if (final) entry.send({ type: 'voice.final', payload: { text: final.text } });
    } catch (err) {
      this.logger.warn('voice session finish failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    entry.session.close();
    entry.send({ type: 'voice.stopped' });
  }

  /** 连接断开：静默清理（不发消息） */
  dispose(connId: string): void {
    const entry = this.entries.get(connId);
    if (!entry) return;
    this.entries.delete(connId);
    clearInterval(entry.timer);
    entry.session.close();
  }

  /** 单次驱动：取会话产出并回推（partial 覆盖 / final 确定） */
  private tick(connId: string): void {
    const entry = this.entries.get(connId);
    if (!entry) return;
    for (let i = 0; i < MAX_POLLS_PER_TICK; i++) {
      const result = entry.session.poll();
      if (!result) break;
      entry.send({
        type: result.isFinal ? 'voice.final' : 'voice.partial',
        payload: { text: result.text },
      });
    }
  }
}