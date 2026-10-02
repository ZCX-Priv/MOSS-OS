// src/modules/voice/sherpa-onnx-node.d.ts
// sherpa-onnx-node 无自带类型声明（CJS + JSDoc），此处按实际导出（addon.js 的类）补充最小类型。
// 只声明本模块实际使用的成员，避免过度耦合上游内部字段。

declare module 'sherpa-onnx-node' {
  export interface Waveform {
    samples: Float32Array;
    sampleRate: number;
  }

  export interface TransducerModelConfig {
    encoder?: string;
    decoder?: string;
    joiner?: string;
  }

  export interface FeatureConfig {
    sampleRate?: number;
    featureDim?: number;
  }

  export interface OnlineModelConfig {
    transducer?: TransducerModelConfig;
    paraformer?: { encoder?: string; decoder?: string };
    zipformer2Ctc?: { model?: string };
    tokens?: string;
    numThreads?: number;
    provider?: string;
    debug?: boolean | number;
    modelType?: string;
  }

  export interface OfflineModelConfig {
    transducer?: TransducerModelConfig;
    paraformer?: { model?: string };
    whisper?: {
      encoder?: string;
      decoder?: string;
      language?: string;
      task?: string;
      tailPaddings?: number;
    };
    senseVoice?: {
      model?: string;
      language?: string;
      useInverseTextNormalization?: number;
    };
    tokens?: string;
    numThreads?: number;
    provider?: string;
    debug?: boolean | number;
    modelType?: string;
  }

  export interface OnlineRecognizerConfig {
    featConfig?: FeatureConfig;
    modelConfig?: OnlineModelConfig;
    decodingMethod?: string;
    maxActivePaths?: number;
    enableEndpoint?: boolean | number;
    rule1MinTrailingSilence?: number;
    rule2MinTrailingSilence?: number;
    rule3MinUtteranceLength?: number;
  }

  export interface OfflineRecognizerConfig {
    featConfig?: FeatureConfig;
    modelConfig?: OfflineModelConfig;
  }

  export interface RecognizerResult {
    text: string;
    tokens?: string[];
    timestamps?: number[];
  }

  export class OnlineStream {
    acceptWaveform(obj: Waveform): void;
    inputFinished(): void;
  }

  export class OnlineRecognizer {
    constructor(config: OnlineRecognizerConfig);
    createStream(): OnlineStream;
    isReady(stream: OnlineStream): boolean;
    decode(stream: OnlineStream): void;
    isEndpoint(stream: OnlineStream): boolean;
    reset(stream: OnlineStream): void;
    getResult(stream: OnlineStream): RecognizerResult;
  }

  export class OfflineStream {
    acceptWaveform(obj: Waveform): void;
  }

  export class OfflineRecognizer {
    constructor(config: OfflineRecognizerConfig);
    static createAsync(config: OfflineRecognizerConfig): Promise<OfflineRecognizer>;
    createStream(hotwords?: string): OfflineStream;
    decode(stream: OfflineStream): void;
    decodeAsync(stream: OfflineStream): Promise<RecognizerResult>;
    getResult(stream: OfflineStream): RecognizerResult;
  }

  export function readWave(filename: string): Waveform;
  export const version: string;
  export const onnxruntimeVersion: string;
}