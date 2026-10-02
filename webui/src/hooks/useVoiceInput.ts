// webui/src/hooks/useVoiceInput.ts
// 语音输入 hook：麦克风采集（AudioWorklet，16kHz 单声道）→ WS 二进制音频 →
// 后端流式识别 → partial/final 回调（供编辑器实时上屏）。
//
// 本地推理：音频经本机 WS 发往后端 sherpa-onnx 识别，全程不出本机、不调云 API。

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/http';
import { wsClient } from '../api/ws';
import type { VoiceModelStatus, VoiceStatus } from '../types/api';

/** AudioWorklet 处理器源码（内联 Blob URL 加载，避免额外静态资源与构建配置） */
const CAPTURE_WORKLET_SOURCE = `
class VoiceCaptureProcessor extends AudioWorkletProcessor {
  constructor() { super(); this.chunks = []; this.length = 0; }
  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const ch = input[0];
    this.chunks.push(ch.slice());
    this.length += ch.length;
    if (this.length >= 1024) {
      const out = new Float32Array(this.length);
      let off = 0;
      for (const c of this.chunks) { out.set(c, off); off += c.length; }
      this.port.postMessage(out, [out.buffer]);
      this.chunks = [];
      this.length = 0;
    }
    return true;
  }
}
registerProcessor('voice-capture', VoiceCaptureProcessor);
`;

/** 采集采样率：与后端识别统一 16kHz */
const TARGET_SAMPLE_RATE = 16000;

export interface UseVoiceStatusResult {
  status: VoiceStatus | null;
  refresh: () => Promise<void>;
}

/** 语音能力状态（总开关/运行时/默认模型）：TaskInput 据此决定是否显示麦克风按钮 */
export function useVoiceStatus(): UseVoiceStatusResult {
  const [status, setStatus] = useState<VoiceStatus | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.getVoiceStatus());
    } catch {
      // 后端未就绪：保持 null（按钮按「未开启」处理）
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { status, refresh };
}

export interface UseVoiceModelsResult {
  models: VoiceModelStatus[];
  refresh: () => Promise<void>;
}

/** 本地模型目录 + 安装状态（设置页用；下载中自动轮询刷新进度） */
export function useVoiceModels(): UseVoiceModelsResult {
  const [models, setModels] = useState<VoiceModelStatus[]>([]);

  const refresh = useCallback(async () => {
    try {
      const resp = await api.listVoiceModels();
      setModels(resp.models);
    } catch {
      // 忽略
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 存在下载中的模型时轮询进度
  const downloading = models.some((m) => m.state === 'downloading');
  useEffect(() => {
    if (!downloading) return;
    const timer = setInterval(() => void refresh(), 800);
    return () => clearInterval(timer);
  }, [downloading, refresh]);

  return { models, refresh };
}

export interface UseVoiceInputOptions {
  /** 中间态文本（可被覆盖） */
  onPartial: (text: string) => void;
  /** 确定文本 */
  onFinal: (text: string) => void;
  /** 错误提示 */
  onError?: (message: string) => void;
}

export interface UseVoiceInputResult {
  /** 正在录音（按钮显示波形） */
  recording: boolean;
  /** 会话建立中（模型加载等） */
  busy: boolean;
  /** 实时音量 0..1（波形动画数据源） */
  level: number;
  toggle: () => void;
  stop: () => void;
}

/** 语音输入：点击开始/再次点击停止，识别文本实时上屏 */
export function useVoiceInput(options: UseVoiceInputOptions): UseVoiceInputResult {
  const { onPartial, onFinal, onError } = options;
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [level, setLevel] = useState(0);

  // 回调/reffs（避免因回调变化重建采集链路）
  const onPartialRef = useRef(onPartial);
  const onFinalRef = useRef(onFinal);
  const onErrorRef = useRef(onError);
  onPartialRef.current = onPartial;
  onFinalRef.current = onFinal;
  onErrorRef.current = onError;

  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  /** 是否已开始（用于忽略重复 toggle） */
  const startingRef = useRef(false);
  /** 后端会话是否就绪（voice.ready）：就绪前音频先缓冲，避免丢失开头 */
  const readyRef = useRef(false);
  /** 就绪前缓冲的音频帧 */
  const pendingFramesRef = useRef<ArrayBuffer[]>([]);

  /** WS 语音事件订阅 */
  useEffect(() => {
    const off = wsClient.onMessage((msg) => {
      const type = (msg as { type?: string }).type;
      if (!type || !type.startsWith('voice.')) return;
      const payload = (msg as { payload?: { text?: string; error?: string } }).payload;
      switch (type) {
        case 'voice.partial':
          if (payload?.text) onPartialRef.current(payload.text);
          break;
        case 'voice.final':
          if (payload?.text) onFinalRef.current(payload.text);
          break;
        case 'voice.ready': {
          setBusy(false);
          readyRef.current = true;
          // 冲刷就绪前缓冲的音频帧（保证开头语音不丢）
          const pending = pendingFramesRef.current;
          pendingFramesRef.current = [];
          for (const buf of pending) wsClient.sendBinary(buf);
          break;
        }
        case 'voice.error':
          setBusy(false);
          onErrorRef.current?.(payload?.error ?? 'VOICE_ERROR');
          break;
        case 'voice.stopped':
          break;
        default:
          break;
      }
    });
    return off;
  }, []);

  /** 释放采集资源（幂等） */
  const teardown = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    try {
      workletRef.current?.disconnect();
      analyserRef.current?.disconnect();
      sourceRef.current?.disconnect();
    } catch {
      // 忽略
    }
    workletRef.current = null;
    analyserRef.current = null;
    sourceRef.current = null;
    readyRef.current = false;
    pendingFramesRef.current = [];
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const ctx = ctxRef.current;
    ctxRef.current = null;
    if (ctx) void ctx.close().catch(() => undefined);
    setLevel(0);
  }, []);

  const stop = useCallback(() => {
    if (!recording) return;
    wsClient.send({ type: 'voice.stop' });
    teardown();
    setRecording(false);
    setBusy(false);
  }, [recording, teardown]);

  const start = useCallback(async () => {
    if (startingRef.current || recording) return;
    startingRef.current = true;
    setBusy(true);
    try {
      if (!wsClient.isOpen()) {
        throw new Error('WS_NOT_CONNECTED');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
          sampleRate: TARGET_SAMPLE_RATE,
        },
      });
      streamRef.current = stream;

      const ctx = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
      ctxRef.current = ctx;
      if (ctx.state === 'suspended') await ctx.resume();

      const blob = new Blob([CAPTURE_WORKLET_SOURCE], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      await ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);

      const source = ctx.createMediaStreamSource(stream);
      sourceRef.current = source;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyserRef.current = analyser;

      const worklet = new AudioWorkletNode(ctx, 'voice-capture');
      workletRef.current = worklet;
      worklet.port.onmessage = (event: MessageEvent<Float32Array>) => {
        const samples = event.data;
        if (!samples || samples.length === 0) return;
        const i16 = new Int16Array(samples.length);
        for (let i = 0; i < samples.length; i++) {
          const s = Math.max(-1, Math.min(1, samples[i]));
          i16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        if (!readyRef.current) {
          // 后端会话尚未就绪（模型加载中）：先缓冲，voice.ready 后统一补发
          pendingFramesRef.current.push(i16.buffer);
          if (pendingFramesRef.current.length > 300) pendingFramesRef.current.shift();
          return;
        }
        wsClient.sendBinary(i16.buffer);
      };

      source.connect(analyser);
      source.connect(worklet);
      // worklet 不产出音频，连接 destination 仅用于驱动 process 回调
      worklet.connect(ctx.destination);

      // 音量驱动波形
      const data = new Uint8Array(analyser.fftSize);
      let lastUpdate = 0;
      const tick = (now: number) => {
        const a = analyserRef.current;
        if (!a) return;
        a.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        // 节流到约 20fps：避免每帧 setState 触发整块输入区重渲染
        if (now - lastUpdate >= 50) {
          lastUpdate = now;
          setLevel(Math.min(1, Math.sqrt(sum / data.length) * 3));
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);

      readyRef.current = false;
      pendingFramesRef.current = [];
      wsClient.send({ type: 'voice.start' });
      setRecording(true);
      // busy 由 voice.ready 清除
    } catch (err) {
      teardown();
      setBusy(false);
      onErrorRef.current?.(err instanceof Error ? err.message : String(err));
    } finally {
      startingRef.current = false;
    }
  }, [recording, teardown]);

  const toggle = useCallback(() => {
    if (recording) stop();
    else void start();
  }, [recording, start, stop]);

  // 组件卸载：确保释放麦克风
  useEffect(() => () => teardown(), [teardown]);

  return { recording, busy, level, toggle, stop };
}