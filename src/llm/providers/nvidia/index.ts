import { BaseProvider, type BaseProviderOptions } from '../base.js';
import type { LLMModelInfo, ProviderDescriptor } from '../../types/index.js';

/**
 * Curated catalog of chat-capable models served by the NVIDIA NIM hosted API
 * (https://integrate.api.nvidia.com). IDs use the `vendor/name` scheme that the
 * endpoint expects in `model`.
 */
export const NVIDIA_MODELS: LLMModelInfo[] = [
  {
    id: 'meta/llama-3.3-70b-instruct',
    name: 'Llama 3.3 70B Instruct',
    contextWindow: 131072,
    capabilities: ['chat', 'tools'],
    description: 'General-purpose instruction model with strong tool-use and reasoning.',
  },
  {
    id: 'nvidia/llama-3.1-nemotron-ultra-253b-v1',
    name: 'Nemotron Ultra 253B',
    contextWindow: 262144,
    capabilities: ['chat', 'tools'],
    description: 'NVIDIA flagship 253B model for the most demanding conversations.',
  },
  {
    id: 'nvidia/llama-3.1-nemotron-70b-instruct',
    name: 'Nemotron 70B Instruct',
    contextWindow: 131072,
    capabilities: ['chat', 'tools'],
    description: 'NVIDIA-tuned 70B model balancing quality, speed and cost.',
  },
  {
    id: 'nvidia/llama-3.1-nemotron-nano-8b-v1',
    name: 'Nemotron Nano 8B',
    contextWindow: 131072,
    capabilities: ['chat', 'tools'],
    description: 'Fast, low-cost 8B model for high-throughput chat.',
  },
  {
    id: 'meta/llama-3.1-405b-instruct',
    name: 'Llama 3.1 405B Instruct',
    contextWindow: 131072,
    capabilities: ['chat', 'tools'],
    description: 'Largest Llama 3.1 variant with frontier-level quality.',
  },
  {
    id: 'meta/llama-3.1-8b-instruct',
    name: 'Llama 3.1 8B Instruct',
    contextWindow: 131072,
    capabilities: ['chat', 'tools'],
    description: 'Lightweight 8B model for cost-sensitive workloads.',
  },
  {
    id: 'deepseek-ai/deepseek-r1',
    name: 'DeepSeek R1',
    contextWindow: 163840,
    capabilities: ['chat', 'reasoning'],
    description: 'Reasoning model that shows chain-of-thought before answering.',
  },
  {
    id: 'qwen/qwen2.5-72b-instruct',
    name: 'Qwen 2.5 72B Instruct',
    contextWindow: 131072,
    capabilities: ['chat', 'tools'],
    description: 'Strong multilingual general-purpose model.',
  },
  {
    id: 'qwen/qwen2.5-coder-32b-instruct',
    name: 'Qwen 2.5 Coder 32B',
    contextWindow: 131072,
    capabilities: ['chat', 'tools'],
    description: 'Coding-focused model with strong code generation.',
  },
  {
    id: 'google/gemma-2-27b-it',
    name: 'Gemma 2 27B Instruct',
    contextWindow: 8192,
    capabilities: ['chat'],
    description: 'Google Gemma 2 instruction-tuned model.',
  },
];

export const NVIDIA_DEFAULT_MODEL = 'meta/llama-3.3-70b-instruct';

/**
 * NVIDIA NIM hosted API provider. OpenAI-compatible, so it reuses the shared
 * BaseProvider engine; only the descriptor, settings and model catalog differ.
 */
export class NvidiaProvider extends BaseProvider {
  readonly descriptor: ProviderDescriptor = {
    id: 'nvidia',
    label: 'NVIDIA',
    description: 'NVIDIA NIM hosted models served from integrate.api.nvidia.com.',
    requiresApiKey: true,
    envVar: 'NVIDIA_API_KEY',
    defaultBaseUrl: 'https://integrate.api.nvidia.com/v1',
    defaultModel: NVIDIA_DEFAULT_MODEL,
  };

  constructor(options: BaseProviderOptions = {}) {
    super(options);
  }

  async listModels(): Promise<LLMModelInfo[]> {
    return NVIDIA_MODELS;
  }
}
