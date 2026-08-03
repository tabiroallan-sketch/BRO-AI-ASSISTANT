vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = 'http://test.local/api/v1';
});

const store = new Map<string, string>();

globalThis.localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => {
    store.set(key, value);
  },
  removeItem: (key: string) => {
    store.delete(key);
  },
} as unknown as Storage;

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  parseSseStream,
  renameConversation,
  streamChat,
  type StreamEvent,
} from '@/lib/chat';
import { setTokens } from '@/lib/token-store';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function sseResponse(...events: StreamEvent[]): Response {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

describe('conversation client', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    setTokens('access-token', 'refresh-token');
  });

  it('lists conversations with the bearer token', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        conversations: [
          { id: 'c1', title: 'Hello', messageCount: 2, createdAt: '', updatedAt: '' },
        ],
      }),
    );

    const result = await listConversations();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://test.local/api/v1/conversations');
    expect(init.headers).toMatchObject({ authorization: 'Bearer access-token' });
    expect(result).toHaveLength(1);
  });

  it('creates a conversation', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ conversation: { id: 'c2' } }));

    const result = await createConversation('New chat');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ title: 'New chat' });
    expect(result.id).toBe('c2');
  });

  it('renames and deletes a conversation', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ conversation: { id: 'c1', title: 'Renamed' } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const renamed = await renameConversation('c1', 'Renamed');
    expect(renamed.title).toBe('Renamed');

    await deleteConversation('c1');

    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'DELETE' });
  });

  it('gets a conversation with its messages', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        conversation: {
          id: 'c1',
          messages: [{ id: 'm1', role: 'USER', content: 'hi', createdAt: '' }],
        },
      }),
    );

    const result = await getConversation('c1');

    expect(result.messages[0].content).toBe('hi');
  });
});

describe('SSE parser', () => {
  function streamOf(text: string): ReadableStream<Uint8Array> {
    return new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
    });
  }

  it('parses events across chunk boundaries', async () => {
    const events: StreamEvent[] = [];
    const first = `data: ${JSON.stringify({ type: 'start', conversationId: 'c1', messageId: 'm1' })}\n\n`;
    const second = `data: ${JSON.stringify({ type: 'delta', content: 'Hello' })}\n\ndata: ${JSON.stringify({ type: 'delta', content: ' world' })}\n\n`;

    const reader = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(first));
        controller.enqueue(new TextEncoder().encode(second));
        controller.close();
      },
    });

    for await (const event of parseSseStream(reader)) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'start', conversationId: 'c1', messageId: 'm1' },
      { type: 'delta', content: 'Hello' },
      { type: 'delta', content: ' world' },
    ]);
  });

  it('ignores non-data and malformed lines', async () => {
    const events: StreamEvent[] = [];
    const body = `data: ${JSON.stringify({ type: 'start', conversationId: 'c1', messageId: 'm1' })}\n\n:comment\n\ndata: not-json\n\ndata: ${JSON.stringify({ type: 'done', message: { id: 'a1', role: 'ASSISTANT', content: 'ok', createdAt: '' } })}\n\n`;

    for await (const event of parseSseStream(streamOf(body))) {
      events.push(event);
    }

    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('start');
    expect(events[1].type).toBe('done');
  });

  it('handles a trailing event without a final blank line', async () => {
    const events: StreamEvent[] = [];
    const body = `data: ${JSON.stringify({ type: 'delta', content: 'tail' })}\n\ndata: ${JSON.stringify({ type: 'error', message: 'boom' })}`;

    for await (const event of parseSseStream(streamOf(body))) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'delta', content: 'tail' },
      { type: 'error', message: 'boom' },
    ]);
  });

  it('parses tool activity events', async () => {
    const events: StreamEvent[] = [];
    const body = `data: ${JSON.stringify({
      type: 'tool_start',
      name: 'calculate',
      args: { expression: '6*7' },
    })}\n\ndata: ${JSON.stringify({
      type: 'tool_result',
      name: 'calculate',
      ok: true,
      output: '42',
    })}\n\n`;

    for await (const event of parseSseStream(streamOf(body))) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'tool_start', name: 'calculate', args: { expression: '6*7' } },
      { type: 'tool_result', name: 'calculate', ok: true, output: '42' },
    ]);
  });
});

describe('streamChat', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    setTokens('access-token', 'refresh-token');
  });

  it('posts the message and yields parsed events', async () => {
    fetchMock.mockResolvedValue(
      sseResponse(
        { type: 'start', conversationId: 'c1', messageId: 'm1' },
        { type: 'delta', content: 'Hi' },
        { type: 'done', message: { id: 'a1', role: 'ASSISTANT', content: 'Hi', createdAt: '' } },
      ),
    );

    const events: StreamEvent[] = [];
    const stream = await streamChat('hello', 'c1');
    for await (const event of stream) {
      events.push(event);
    }

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://test.local/api/v1/chat');
    expect(JSON.parse(init.body as string)).toEqual({ message: 'hello', conversationId: 'c1' });
    expect(events.map((event) => event.type)).toEqual(['start', 'delta', 'done']);
  });

  it('yields tool events between the start and final delta', async () => {
    fetchMock.mockResolvedValue(
      sseResponse(
        { type: 'start', conversationId: 'c1', messageId: 'm1' },
        { type: 'tool_start', name: 'calculate', args: { expression: '6*7' } },
        { type: 'tool_result', name: 'calculate', ok: true, output: '42' },
        { type: 'delta', content: '42' },
        { type: 'done', message: { id: 'a1', role: 'ASSISTANT', content: '42', createdAt: '' } },
      ),
    );

    const events: StreamEvent[] = [];
    const stream = await streamChat('what is 6*7');
    for await (const event of stream) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual([
      'start',
      'tool_start',
      'tool_result',
      'delta',
      'done',
    ]);
  });

  it('omits conversationId for a new conversation', async () => {
    fetchMock.mockResolvedValue(
      sseResponse({ type: 'start', conversationId: 'c2', messageId: 'm2' }),
    );

    const stream = await streamChat('hello');
    await Array.fromAsync(stream);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ message: 'hello' });
  });

  it('throws an ApiError with the server message on failure', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { message: 'AI is not configured' } }, 503));

    await expect(streamChat('hello')).rejects.toMatchObject({
      status: 503,
      message: 'AI is not configured',
    });
  });
});
