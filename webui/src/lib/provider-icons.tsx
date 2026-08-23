// UI/src/lib/provider-icons.tsx
// AI 供应商品牌图标映射（@lobehub/icons 精选清单，按需 import 控制 bundle）。
// - icon key 持久化在 provider.icon（如 'openai'）；空/未命中 = 默认 lucide Server 图标
// - 仅使用默认 Mono 变体（跟随 currentColor，自动适配明暗主题）

import type { ComponentType } from 'react';
import {
  OpenAI,
  Anthropic,
  Claude,
  Google,
  Gemini,
  DeepSeek,
  Qwen,
  Kimi,
  Moonshot,
  Zhipu,
  ChatGLM,
  Doubao,
  ByteDance,
  Minimax,
  Mistral,
  Meta,
  XAI,
  Grok,
  Groq,
  Together,
  Fireworks,
  Perplexity,
  Cohere,
  OpenRouter,
  Ollama,
  SiliconCloud,
  Azure,
  Aws,
  Bedrock,
  HuggingFace,
  AlibabaCloud,
  Volcengine,
  ZeroOne,
  Nvidia,
  Github,
  LmStudio,
  Baidu,
  Tencent,
  Hunyuan,
  SenseNova,
  Stepfun,
  Midjourney,
  Stability,
  Cloudflare,
  Vercel,
  DeepInfra,
  Novita,
  Nebius,
  GiteeAI,
} from '@lobehub/icons';

/** 图标清单条目：key 持久化用，name 供选择器显示与搜索 */
export interface ProviderIconEntry {
  key: string;
  name: string;
  Icon: ComponentType<{ size?: number; className?: string }>;
}

/** 精选供应商图标清单（选择器数据源；名字与 @lobehub/icons 实际导出核对过） */
export const PROVIDER_ICON_LIST: ProviderIconEntry[] = [
  { key: 'openai', name: 'OpenAI', Icon: OpenAI },
  { key: 'anthropic', name: 'Anthropic', Icon: Anthropic },
  { key: 'claude', name: 'Claude', Icon: Claude },
  { key: 'google', name: 'Google', Icon: Google },
  { key: 'gemini', name: 'Gemini', Icon: Gemini },
  { key: 'deepseek', name: 'DeepSeek', Icon: DeepSeek },
  { key: 'qwen', name: 'Qwen', Icon: Qwen },
  { key: 'kimi', name: 'Kimi', Icon: Kimi },
  { key: 'moonshot', name: 'Moonshot', Icon: Moonshot },
  { key: 'zhipu', name: 'Zhipu', Icon: Zhipu },
  { key: 'chatglm', name: 'ChatGLM', Icon: ChatGLM },
  { key: 'doubao', name: 'Doubao', Icon: Doubao },
  { key: 'bytedance', name: 'ByteDance', Icon: ByteDance },
  { key: 'minimax', name: 'Minimax', Icon: Minimax },
  { key: 'mistral', name: 'Mistral', Icon: Mistral },
  { key: 'meta', name: 'Meta', Icon: Meta },
  { key: 'xai', name: 'xAI', Icon: XAI },
  { key: 'grok', name: 'Grok', Icon: Grok },
  { key: 'groq', name: 'Groq', Icon: Groq },
  { key: 'together', name: 'Together', Icon: Together },
  { key: 'fireworks', name: 'Fireworks', Icon: Fireworks },
  { key: 'perplexity', name: 'Perplexity', Icon: Perplexity },
  { key: 'cohere', name: 'Cohere', Icon: Cohere },
  { key: 'openrouter', name: 'OpenRouter', Icon: OpenRouter },
  { key: 'ollama', name: 'Ollama', Icon: Ollama },
  { key: 'siliconcloud', name: 'SiliconCloud', Icon: SiliconCloud },
  { key: 'azure', name: 'Azure', Icon: Azure },
  { key: 'aws', name: 'AWS', Icon: Aws },
  { key: 'bedrock', name: 'Bedrock', Icon: Bedrock },
  { key: 'huggingface', name: 'HuggingFace', Icon: HuggingFace },
  { key: 'alibabacloud', name: 'AlibabaCloud', Icon: AlibabaCloud },
  { key: 'volcengine', name: 'Volcengine', Icon: Volcengine },
  { key: 'zeroone', name: '01.AI', Icon: ZeroOne },
  { key: 'nvidia', name: 'Nvidia', Icon: Nvidia },
  { key: 'github', name: 'GitHub', Icon: Github },
  { key: 'lmstudio', name: 'LmStudio', Icon: LmStudio },
  { key: 'baidu', name: 'Baidu', Icon: Baidu },
  { key: 'tencent', name: 'Tencent', Icon: Tencent },
  { key: 'hunyuan', name: 'Hunyuan', Icon: Hunyuan },
  { key: 'sensenova', name: 'SenseNova', Icon: SenseNova },
  { key: 'stepfun', name: 'Stepfun', Icon: Stepfun },
  { key: 'midjourney', name: 'Midjourney', Icon: Midjourney },
  { key: 'stability', name: 'Stability', Icon: Stability },
  { key: 'cloudflare', name: 'Cloudflare', Icon: Cloudflare },
  { key: 'vercel', name: 'Vercel', Icon: Vercel },
  { key: 'deepinfra', name: 'DeepInfra', Icon: DeepInfra },
  { key: 'novita', name: 'Novita', Icon: Novita },
  { key: 'nebius', name: 'Nebius', Icon: Nebius },
  { key: 'giteeai', name: 'GiteeAI', Icon: GiteeAI },
];

const ICON_MAP = new Map(PROVIDER_ICON_LIST.map((e) => [e.key, e.Icon]));

/**
 * 按 key 取供应商图标组件；未命中返回 null（调用方 fallback lucide Server）。
 */
export function getProviderIcon(key?: string): ComponentType<{ size?: number; className?: string }> | null {
  if (!key) return null;
  return ICON_MAP.get(key) ?? null;
}
