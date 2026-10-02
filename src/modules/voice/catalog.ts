// src/modules/voice/catalog.ts
// 内置本地语音模型目录（主流模型，tar.bz2 归档，来自 sherpa-onnx 官方 releases）。
// 归档解压后由 service 动态扫描文件名（不硬编码 epoch/chunk 后缀），因此新增模型
// 只需在此追加一条元数据即可。

import type { VoiceModelDef } from './types';

/** sherpa-onnx 官方模型下载根路径（GitHub Releases） */
export const SHERPA_MODELS_BASE =
  'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models';

/** 内置模型清单：三类引擎各取一个主流模型 */
export const VOICE_MODEL_CATALOG: VoiceModelDef[] = [
  {
    id: 'zipformer-zh',
    engine: 'zipformer',
    mode: 'streaming',
    name: 'Zipformer 中文流式',
    description: '流式 transducer，边说边出字，中文识别延迟最低（推荐）',
    url: `${SHERPA_MODELS_BASE}/sherpa-onnx-streaming-zipformer-zh-int8-2025-06-30.tar.bz2`,
    sizeBytes: 132634597,
    rootDir: 'sherpa-onnx-streaming-zipformer-zh-int8-2025-06-30',
    languages: ['zh'],
    recommended: true,
  },
  {
    id: 'sensevoice-multi',
    engine: 'sensevoice',
    mode: 'offline',
    name: 'SenseVoice 多语言',
    description: '非流式 CTC，中/英/日/韩/粤语，单段解码极快，自动标点',
    url: `${SHERPA_MODELS_BASE}/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2`,
    sizeBytes: 163002883,
    rootDir: 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17',
    languages: ['zh', 'en', 'ja', 'ko', 'yue'],
  },
  {
    id: 'whisper-base',
    engine: 'whisper',
    mode: 'offline',
    name: 'Whisper Base 多语言',
    description: '非流式 encoder-decoder，多语言通用，中文表现稳健',
    url: `${SHERPA_MODELS_BASE}/sherpa-onnx-whisper-base.tar.bz2`,
    sizeBytes: 207557382,
    rootDir: 'sherpa-onnx-whisper-base',
    languages: ['multi'],
  },
];

/** 按 id 查模型定义 */
export function findModelDef(id: string): VoiceModelDef | undefined {
  return VOICE_MODEL_CATALOG.find((m) => m.id === id);
}

/** 默认模型 id（首个推荐项） */
export function defaultModelId(): string {
  return VOICE_MODEL_CATALOG.find((m) => m.recommended)?.id ?? VOICE_MODEL_CATALOG[0]?.id ?? '';
}