import { describe, expect, it } from 'vitest';
import { parseSseStream, type StreamEvent } from '@/lib/chat';

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

async function collect(payload: string, chunkSize = 8): Promise<StreamEvent[]> {
  const chunks: string[] = [];
  for (let index = 0; index < payload.length; index += chunkSize) {
    chunks.push(payload.slice(index, index + chunkSize));
  }
  const events: StreamEvent[] = [];
  for await (const event of parseSseStream(streamFromChunks(chunks))) {
    events.push(event);
  }
  return events;
}

function sse(events: Array<Record<string, unknown>>): string {
  return events.map((event) => `data: ${JSON.stringify(event)}`).join('\n\n') + '\n\n';
}

describe('parseSseStream', () => {
  it('parses a single event split across arbitrary chunk boundaries', async () => {
    const payload = sse([{ type: 'start', conversationId: 'c1', messageId: 'm1' }]);
    const events = await collect(payload);
    expect(events).toEqual([{ type: 'start', conversationId: 'c1', messageId: 'm1' }]);
  });

  it('parses multiple events in a single chunk', async () => {
    const payload = sse([
      { type: 'start', conversationId: 'c1', messageId: 'm1' },
      { type: 'delta', content: 'hello' },
      { type: 'done', message: { id: 'm1', role: 'ASSISTANT', content: 'hello', createdAt: 'x' } },
    ]);
    const events = await collect(payload, 1024);
    expect(events.map((event) => event.type)).toEqual(['start', 'delta', 'done']);
  });

  it('yields events as soon as a full block arrives even when the JSON is mid-chunk', async () => {
    const payload = sse([
      { type: 'delta', content: 'partial' },
      { type: 'delta', content: 'second' },
    ]);
    const events = await collect(payload, 4);
    expect(events.map((event) => event.type)).toEqual(['delta', 'delta']);
  });

  it('flushes an event in the final buffer without a trailing blank line', async () => {
    const payload = `data: ${JSON.stringify({ type: 'delta', content: 'trailing' })}`;
    const events = await collect(payload, 1024);
    expect(events).toEqual([{ type: 'delta', content: 'trailing' }]);
  });

  it('ignores malformed JSON and non-data lines but keeps the stream alive', async () => {
    const payload =
      'event: keepalive\n\n' +
      'data: {not valid json}\n\n' +
      `data: ${JSON.stringify({ type: 'delta', content: 'after' })}\n\n`;
    const events = await collect(payload, 1024);
    expect(events).toEqual([{ type: 'delta', content: 'after' }]);
  });

  it('passes through tool_result connect fields and permissionDenied', async () => {
    const payload = sse([
      {
        type: 'tool_result',
        name: 'gmail_search',
        ok: false,
        output: 'token missing',
        connectProviderId: 'gmail',
        connectLabel: 'Google',
        permissionDenied: false,
      },
    ]);
    const events = await collect(payload, 1024);
    expect(events[0]).toMatchObject({
      type: 'tool_result',
      name: 'gmail_search',
      ok: false,
      connectProviderId: 'gmail',
      connectLabel: 'Google',
      permissionDenied: false,
    });
  });

  it('passes through tool_confirmation fields', async () => {
    const payload = sse([
      {
        type: 'tool_confirmation',
        id: 'act-9',
        name: 'system_delete',
        args: { path: 'C:\\tmp\\notes.txt' },
        summary: 'Delete C:\\tmp\\notes.txt (moves it to the Recycle Bin)',
      },
    ]);
    const events = await collect(payload, 1024);
    expect(events[0]).toEqual({
      type: 'tool_confirmation',
      id: 'act-9',
      name: 'system_delete',
      args: { path: 'C:\\tmp\\notes.txt' },
      summary: 'Delete C:\\tmp\\notes.txt (moves it to the Recycle Bin)',
    });
  });

  it('handles an empty stream', async () => {
    const events = await collect('', 1024);
    expect(events).toEqual([]);
  });
});
