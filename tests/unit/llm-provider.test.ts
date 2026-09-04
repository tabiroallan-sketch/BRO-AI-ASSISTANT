import { describe, expect, it } from 'vitest';
import OpenAI from 'openai';
import {
  BaseProvider,
  type BaseProviderOptions,
  type LLMModelInfo,
  type ProviderDescriptor,
  type ProviderLifecycleEvent,
} from '../../src/llm/index.js';

type FakeToolCallDelta = {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
};

type FakeStreamChunk = {
  choices?: Array<{ delta?: { content?: string | null; tool_calls?: FakeToolCallDelta[] } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
};

type FakeCompleteChunk = {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  model?: string;
};

type FakeClientOpts = {
  stream?: FakeStreamChunk[] | (() => AsyncIterable<FakeStreamChunk>);
  complete?: FakeCompleteChunk | (() => FakeCompleteChunk);
  streamError?: unknown;
  completeError?: unknown;
};

function makeFakeClient(opts: FakeClientOpts): { chat: unknown } {
  return {
    chat: {
      completions: {
        create: async (params: {
          stream?: boolean;
        }): Promise<AsyncIterable<FakeStreamChunk> | FakeCompleteChunk> => {
          if (params.stream) {
            if (opts.streamError) {
              throw opts.streamError;
            }
            const iterable =
              typeof opts.stream === 'function' ? opts.stream() : (opts.stream ?? []);
            return {
              async *[Symbol.asyncIterator](): AsyncGenerator<FakeStreamChunk> {
                for await (const chunk of iterable) {
                  yield chunk;
                }
              },
            };
          }
          if (opts.completeError) {
            throw opts.completeError;
          }
          const result = typeof opts.complete === 'function' ? opts.complete() : opts.complete;
          return result ?? { choices: [{ message: { content: 'ok' } }], model: 'fake-model' };
        },
      },
    },
  };
}

const descriptor: ProviderDescriptor = {
  id: 'fake',
  label: 'Fake',
  description: 'Fake provider',
  defaultModel: 'fake-model',
  requiresApiKey: true,
  envVar: 'FAKE_API_KEY',
  defaultBaseUrl: 'https://fake.example.com/v1',
};

class FakeProvider extends BaseProvider {
  private fake: { chat: unknown };

  constructor(fake: { chat: unknown }, options?: BaseProviderOptions) {
    super(options);
    this.fake = fake;
  }

  readonly descriptor: ProviderDescriptor = descriptor;

  protected override createClient(): OpenAI {
    return this.fake as unknown as OpenAI;
  }

  async listModels(): Promise<LLMModelInfo[]> {
    return [{ id: 'fake-model', contextWindow: 4096, capabilities: ['chat', 'tools'] }];
  }
}

class FakeProviderNoDefault extends BaseProvider {
  readonly descriptor: ProviderDescriptor = { ...descriptor, defaultModel: undefined };

  protected override createClient(): OpenAI {
    return makeFakeClient({}) as unknown as OpenAI;
  }

  async listModels(): Promise<LLMModelInfo[]> {
    return [];
  }
}

const contentStream = (): FakeStreamChunk[] => [
  { choices: [{ delta: { content: 'Hello' } }] },
  { choices: [{ delta: { content: ' world' } }] },
  { usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } },
];

async function collect<T>(generator: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of generator) {
    out.push(item);
  }
  return out;
}

describe('BaseProvider', () => {
  it('isConfigured depends on the API key for key-required providers', () => {
    const provider = new FakeProvider(makeFakeClient({}));
    expect(provider.isConfigured()).toBe(false);
    expect(provider.isConfigured({ apiKey: 'abc' })).toBe(true);
  });

  it('streams content and usage events in order', async () => {
    const provider = new FakeProvider(makeFakeClient({ stream: contentStream() }), {
      maxRetries: 1,
    });
    await provider.initialize({ apiKey: 'abc' });

    const events: string[] = [];
    let totalTokens: number | undefined;
    for await (const event of provider.streamChat({
      messages: [{ role: 'user', content: 'hi' }],
    })) {
      if (event.type === 'content') {
        events.push(event.content);
      }
      if (event.type === 'usage') {
        totalTokens = event.usage.totalTokens;
      }
    }
    expect(events).toEqual(['Hello', ' world']);
    expect(totalTokens).toBe(7);
    expect(provider.getUsage()).toEqual({
      promptTokens: 5,
      completionTokens: 2,
      totalTokens: 7,
    });
  });

  it('accumulates tool calls and yields them at the end', async () => {
    const stream = (): AsyncIterable<FakeStreamChunk> =>
      (async function* (): AsyncGenerator<FakeStreamChunk> {
        yield {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: 'call_1', function: { name: 'calculate', arguments: '{"a"' } },
                ],
              },
            },
          ],
        };
        yield {
          choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ':1}' } }] } }],
        };
      })();

    const provider = new FakeProvider(makeFakeClient({ stream }), { maxRetries: 1 });
    await provider.initialize({ apiKey: 'abc' });

    let toolCalls: unknown;
    for await (const event of provider.streamChat({
      messages: [{ role: 'user', content: 'calc' }],
    })) {
      if (event.type === 'tool_calls') {
        toolCalls = event.toolCalls;
      }
    }
    expect(toolCalls).toEqual([{ id: 'call_1', name: 'calculate', arguments: '{"a":1}' }]);
  });

  it('retries transient 429 failures on the stream create call', async () => {
    let attempts = 0;
    const fake = {
      chat: {
        completions: {
          create: async (params: {
            stream?: boolean;
          }): Promise<AsyncIterable<FakeStreamChunk> | FakeCompleteChunk> => {
            if (!params.stream) {
              throw new Error('unexpected non-streaming call');
            }
            attempts += 1;
            if (attempts === 1) {
              throw Object.assign(new Error('429'), { status: 429 });
            }
            return {
              async *[Symbol.asyncIterator](): AsyncGenerator<FakeStreamChunk> {
                for (const chunk of contentStream()) {
                  yield chunk;
                }
              },
            };
          },
        },
      },
    };
    const provider = new FakeProvider(fake, { maxRetries: 3, retryInitialDelayMs: 2 });
    await provider.initialize({ apiKey: 'abc' });

    const events = await collect(
      provider.streamChat({ messages: [{ role: 'user', content: 'hi' }] }),
    );
    expect(attempts).toBe(2);
    expect(events.some((event) => event.type === 'content')).toBe(true);
  });

  it('completes a non-streaming request with content, model and usage', async () => {
    const provider = new FakeProvider(
      makeFakeClient({
        complete: {
          choices: [{ message: { content: 'The answer is 42.' } }],
          usage: { prompt_tokens: 4, completion_tokens: 5, total_tokens: 9 },
          model: 'fake-model',
        },
      }),
      { maxRetries: 1 },
    );
    await provider.initialize({ apiKey: 'abc' });

    const result = await provider.completeChat({
      messages: [{ role: 'user', content: 'what is the answer?' }],
    });
    expect(result.content).toBe('The answer is 42.');
    expect(result.model).toBe('fake-model');
    expect(result.usage?.totalTokens).toBe(9);
  });

  it('maps completeChat tool calls', async () => {
    const provider = new FakeProvider(
      makeFakeClient({
        complete: {
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: { name: 'calculate', arguments: '{"expression":"6*7"}' },
                  },
                ],
              },
            },
          ],
          model: 'fake-model',
        },
      }),
      { maxRetries: 1 },
    );
    await provider.initialize({ apiKey: 'abc' });

    const result = await provider.completeChat({
      messages: [{ role: 'user', content: 'calc' }],
    });
    expect(result.content).toBe('');
    expect(result.toolCalls).toEqual([
      { id: 'call_1', name: 'calculate', arguments: '{"expression":"6*7"}' },
    ]);
  });

  it('testConnection reports success with latency and model', async () => {
    const provider = new FakeProvider(
      makeFakeClient({
        complete: { choices: [{ message: { content: 'OK' } }], model: 'fake-model' },
      }),
      { maxRetries: 1 },
    );
    const result = await provider.testConnection({ apiKey: 'abc' });
    expect(result.ok).toBe(true);
    expect(result.status).toBe('connected');
    expect(result.model).toBe('fake-model');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('testConnection reports auth_failed for a 401', async () => {
    const provider = new FakeProvider(
      makeFakeClient({
        completeError: Object.assign(new Error('bad key'), { status: 401 }),
      }),
      { maxRetries: 1 },
    );
    const result = await provider.testConnection({ apiKey: 'bad' });
    expect(result.ok).toBe(false);
    expect(result.status).toBe('auth_failed');
    expect(result.message.length).toBeGreaterThan(0);
  });

  it('testConnection reports disconnected when not configured', async () => {
    const provider = new FakeProvider(makeFakeClient({}));
    const result = await provider.testConnection();
    expect(result.ok).toBe(false);
    expect(result.status).toBe('disconnected');
  });

  it('fails when the model cannot be resolved', async () => {
    const provider = new FakeProviderNoDefault();
    await provider.initialize({ apiKey: 'abc' });
    await expect(
      provider.streamChat({ messages: [{ role: 'user', content: 'hi' }] }).next(),
    ).rejects.toMatchObject({ code: 'not_configured' });
  });

  it('aborts an in-flight stream via cancel()', async () => {
    const stream = (): AsyncIterable<FakeStreamChunk> =>
      (async function* (): AsyncGenerator<FakeStreamChunk> {
        yield { choices: [{ delta: { content: 'first' } }] };
        yield { choices: [{ delta: { content: 'second' } }] };
      })();
    const provider = new FakeProvider(makeFakeClient({ stream }), { maxRetries: 1 });
    await provider.initialize({ apiKey: 'abc' });

    const iterator = provider.streamChat({ messages: [{ role: 'user', content: 'hi' }] });
    const first = await iterator.next();
    expect(first.value).toEqual({ type: 'content', content: 'first' });
    provider.cancel();
    await expect(iterator.next()).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('aborts via an external AbortSignal', async () => {
    const stream = (): AsyncIterable<FakeStreamChunk> =>
      (async function* (): AsyncGenerator<FakeStreamChunk> {
        yield { choices: [{ delta: { content: 'first' } }] };
        yield { choices: [{ delta: { content: 'second' } }] };
      })();
    const provider = new FakeProvider(makeFakeClient({ stream }), { maxRetries: 1 });
    await provider.initialize({ apiKey: 'abc' });

    const controller = new AbortController();
    const iterator = provider.streamChat(
      { messages: [{ role: 'user', content: 'hi' }] },
      { signal: controller.signal },
    );
    const first = await iterator.next();
    expect(first.value).toEqual({ type: 'content', content: 'first' });
    controller.abort();
    await expect(iterator.next()).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('emits lifecycle hooks for requests', async () => {
    const events: ProviderLifecycleEvent[] = [];
    const provider = new FakeProvider(
      makeFakeClient({
        complete: {
          choices: [{ message: { content: 'OK' } }],
          usage: { total_tokens: 3 },
          model: 'fake-model',
        },
      }),
      {
        maxRetries: 1,
        hooks: {
          onEvent: (event: ProviderLifecycleEvent): void => {
            events.push(event);
          },
        },
      },
    );
    await provider.initialize({ apiKey: 'abc' });
    await provider.completeChat({ messages: [{ role: 'user', content: 'hi' }] });

    const types = events.map((event) => event.type);
    expect(types).toContain('beforeRequest');
    expect(types).toContain('afterRequest');
    expect(types).toContain('usage');
  });

  it('emits an error hook when the provider fails', async () => {
    const events: ProviderLifecycleEvent[] = [];
    const provider = new FakeProvider(
      makeFakeClient({
        completeError: Object.assign(new Error('nope'), { status: 500 }),
      }),
      {
        maxRetries: 1,
        hooks: {
          onEvent: (event: ProviderLifecycleEvent): void => {
            events.push(event);
          },
        },
      },
    );
    await provider.initialize({ apiKey: 'abc' });
    await expect(
      provider.completeChat({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toMatchObject({ code: 'network' });
    expect(events.some((event) => event.type === 'error')).toBe(true);
  });

  it('dispose cancels in-flight work and clears usage', async () => {
    const stream = (): AsyncIterable<FakeStreamChunk> =>
      (async function* (): AsyncGenerator<FakeStreamChunk> {
        yield { choices: [{ delta: { content: 'first' } }] };
        yield { choices: [{ delta: { content: 'second' } }] };
      })();
    const provider = new FakeProvider(makeFakeClient({ stream }), { maxRetries: 1 });
    await provider.initialize({ apiKey: 'abc' });
    const iterator = provider.streamChat({ messages: [{ role: 'user', content: 'hi' }] });
    await iterator.next();
    provider.dispose();
    await expect(iterator.next()).rejects.toMatchObject({ code: 'cancelled' });
    expect(provider.getUsage()).toBeNull();
  });
});
