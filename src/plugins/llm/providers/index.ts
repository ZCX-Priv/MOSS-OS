// src/plugins/llm/providers/index.ts
// Provider 注册表。

import type { LLMProvider, ProviderFormat } from '../types';
import { OpenAIChatProvider } from './openai-chat';
import { OpenAIResponsesProvider } from './openai-responses';
import { AnthropicProvider } from './anthropic';
import { GeminiProvider } from './gemini';

const registry = new Map<ProviderFormat, LLMProvider>();

export function getProvider(format: ProviderFormat): LLMProvider {
  const cached = registry.get(format);
  if (cached) return cached;

  let provider: LLMProvider;
  switch (format) {
    case 'openai-chat':
      provider = new OpenAIChatProvider();
      break;
    case 'openai-responses':
      provider = new OpenAIResponsesProvider();
      break;
    case 'anthropic':
      provider = new AnthropicProvider();
      break;
    case 'gemini':
      provider = new GeminiProvider();
      break;
    default:
      throw new Error(`Unknown provider format: ${format satisfies never}`);
  }
  registry.set(format, provider);
  return provider;
}

export { OpenAIChatProvider, OpenAIResponsesProvider, AnthropicProvider, GeminiProvider };
