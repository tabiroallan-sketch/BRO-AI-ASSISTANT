import { describe, expect, it } from 'vitest';
import { toWireMessages, type AiChatMessage } from '../src/lib/ai.js';

describe('toWireMessages', () => {
  it('leaves plain system and user messages untouched', () => {
    const messages: AiChatMessage[] = [
      { role: 'system', content: 'You are BRO' },
      { role: 'user', content: 'hi' },
    ];

    expect(toWireMessages(messages)).toEqual([
      { role: 'system', content: 'You are BRO' },
      { role: 'user', content: 'hi' },
    ]);
  });

  it('maps assistant tool calls to the function wire format with extra_content', () => {
    const messages: AiChatMessage[] = [
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            name: 'calculate',
            arguments: '{"expression":"6*7"}',
            extraContent: { google: { thought_signature: 'sig-123' } },
          },
          { id: 'call_2', name: 'echo', arguments: '{"text":"hi"}' },
        ],
      },
    ];

    const wire = toWireMessages(messages);
    expect(wire).toEqual([
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'calculate', arguments: '{"expression":"6*7"}' },
            extra_content: { google: { thought_signature: 'sig-123' } },
          },
          {
            id: 'call_2',
            type: 'function',
            function: { name: 'echo', arguments: '{"text":"hi"}' },
          },
        ],
      },
    ]);
  });

  it('maps tool result messages to the tool role', () => {
    const messages: AiChatMessage[] = [{ role: 'tool', tool_call_id: 'call_1', content: '42' }];

    expect(toWireMessages(messages)).toEqual([
      { role: 'tool', tool_call_id: 'call_1', content: '42' },
    ]);
  });
});
