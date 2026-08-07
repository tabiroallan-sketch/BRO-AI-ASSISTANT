import { describe, expect, it } from 'vitest';
import {
  buildContextBlock,
  buildHistoryWindow,
  buildSummaryInput,
  classifyIntent,
  clearPendingTask,
  extractFollowupCandidates,
  formatContextBlock,
  formatMemories,
  formatTaskReminder,
  needsClarification,
  normalizeSummary,
  parseConversationState,
  rankMemories,
  recordPendingTask,
  scoreMemory,
  serializeConversationState,
  shouldContinueTask,
  shouldSummarize,
  type ConversationState,
  type HistoryEntry,
} from '../src/conversation-engine/index.js';

describe('intent', () => {
  it('classifies greetings as chitchat', () => {
    expect(classifyIntent('hi')).toBe('chitchat');
    expect(classifyIntent('Good morning!')).toBe('chitchat');
    expect(classifyIntent('thanks')).toBe('chitchat');
  });

  it('classifies imperative requests as tasks', () => {
    expect(classifyIntent('write a summary of the meeting')).toBe('task');
    expect(classifyIntent('remind me to buy milk tomorrow')).toBe('task');
  });

  it('classifies questions as questions', () => {
    expect(classifyIntent('what is the capital of France?')).toBe('question');
    expect(classifyIntent('How do I set up docker?')).toBe('question');
  });

  it('classifies continuation prompts', () => {
    expect(classifyIntent('continue')).toBe('continuation');
    expect(classifyIntent('keep going please')).toBe('continuation');
  });

  it('classifies terse clarification after an assistant question', () => {
    expect(classifyIntent('what?')).toBe('clarification');
    expect(classifyIntent('wait, say that again')).toBe('clarification');
  });

  it('classifies connector-led followups as followup', () => {
    expect(classifyIntent('what about the second one?')).toBe('followup');
    expect(classifyIntent('how about now?')).toBe('followup');
  });

  it('treats a terse reply to an assistant question as clarification', () => {
    expect(classifyIntent('yes', 'Would you like the short or long version?')).toBe(
      'clarification',
    );
  });
});

describe('memory-recall', () => {
  const memory = (key: string, value: string, category: string | null = null) => ({
    key,
    value,
    category,
  });

  it('scores direct matches higher than unrelated facts', () => {
    const name = scoreMemory(memory('name', 'Alice'), 'what is my name?', '');
    const weather = scoreMemory(memory('favoriteColor', 'blue'), 'what is my name?', '');
    expect(name).toBeGreaterThan(weather);
  });

  it('boosts matches on the memory category', () => {
    const categorized = scoreMemory(
      memory('scheduler', 'daily standup', 'work'),
      'tell me about my work',
      '',
    );
    const unrelated = scoreMemory(
      memory('scheduler', 'daily standup', 'hobbies'),
      'tell me about my work',
      '',
    );
    expect(categorized).toBeGreaterThan(unrelated);
  });

  it('ranks by relevance then recency', () => {
    const facts = [
      { key: 'pet', value: 'a dog named Rex', category: null, updatedAt: new Date(1) },
      { key: 'city', value: 'lives in Paris', category: null, updatedAt: new Date(2) },
      { key: 'name', value: 'Alice', category: null, updatedAt: new Date(3) },
    ];
    const ranked = rankMemories(facts, 'where do I live?', '', 8);
    expect(ranked[0]!.key).toBe('city');
  });

  it('caps results at topK', () => {
    const facts = Array.from({ length: 20 }, (_, index) => ({
      key: `k${index}`,
      value: `v${index}`,
      category: null,
      updatedAt: new Date(index),
    }));
    expect(rankMemories(facts, 'nothing relevant here', '', 5)).toHaveLength(5);
  });

  it('formats memories as bullet lines', () => {
    expect(formatMemories([memory('name', 'Alice'), memory('city', 'Paris')])).toBe(
      '- name: Alice\n- city: Paris',
    );
  });
});

describe('clarify', () => {
  it('flags vague task requests', () => {
    expect(needsClarification('fix it', 'task', false)).toBe(true);
    expect(needsClarification('make that better', 'question', false)).toBe(true);
  });

  it('does not flag concrete requests or confirmations', () => {
    expect(needsClarification('yes', 'task', true)).toBe(false);
    expect(needsClarification('rename the file to report.pdf', 'task', false)).toBe(false);
    expect(needsClarification('no', 'chitchat', false)).toBe(false);
  });

  it('does not flag vague pronouns when context exists', () => {
    expect(needsClarification('it needs fixing', 'task', true)).toBe(false);
  });

  it('extracts suggested follow-ups from explicit markers', () => {
    const reply =
      'Here is the plan.\n- Next: how much will this cost?\n- Try: is it worth upgrading?';
    expect(extractFollowupCandidates(reply)).toEqual([
      'how much will this cost?',
      'is it worth upgrading?',
    ]);
  });

  it('falls back to trailing questions', () => {
    const reply = 'The answer is yes. Want me to schedule it? And should I email you?';
    expect(extractFollowupCandidates(reply, 2)).toEqual([
      'Want me to schedule it?',
      'And should I email you?',
    ]);
  });

  it('returns nothing for short replies', () => {
    expect(extractFollowupCandidates('ok')).toEqual([]);
  });

  it('deduplicates candidates', () => {
    const reply = 'Try: same question?\nTry: same question?';
    expect(extractFollowupCandidates(reply)).toEqual(['same question?']);
  });
});

describe('task', () => {
  const base: ConversationState = { engineVersion: 1, summaryMessageCount: 0 };

  it('records an unfinished task', () => {
    const next = recordPendingTask(base, 'build the release notes');
    expect(next.pendingTask).toBe('build the release notes');
    expect(next.pendingTaskAt).toEqual(expect.any(String));
  });

  it('clears the pending task on completion', () => {
    const withTask = { ...base, pendingTask: 'finish the report', pendingTaskAt: 'x' };
    expect(clearPendingTask(withTask, 3, false).pendingTask).toBeUndefined();
  });

  it('keeps the pending task on a continuation', () => {
    const withTask = { ...base, pendingTask: 'finish the report', pendingTaskAt: 'x' };
    expect(clearPendingTask(withTask, 3, true).pendingTask).toBe('finish the report');
  });

  it('detects when a continuation should keep the reminder', () => {
    const withTask = { ...base, pendingTask: 'finish the report', pendingTaskAt: 'x' };
    expect(shouldContinueTask(withTask, true)).toBe(true);
    expect(shouldContinueTask(withTask, false)).toBe(false);
  });

  it('formats a task reminder block', () => {
    const withTask = { ...base, pendingTask: 'finish the report', pendingTaskAt: 'x' };
    expect(formatTaskReminder(withTask)).toContain('finish the report');
    expect(formatTaskReminder(base)).toBeUndefined();
  });
});

describe('summary', () => {
  const entry = (role: HistoryEntry['role'], content: string): HistoryEntry => ({
    role,
    content,
  });

  const many = (count: number): HistoryEntry[] =>
    Array.from({ length: count }, (_, index) => entry('USER', `message ${index}`));

  it('summarizes once the threshold is reached', () => {
    const state: ConversationState = { engineVersion: 1, summaryMessageCount: 0 };
    expect(shouldSummarize(state, 19)).toBe(false);
    expect(shouldSummarize(state, 20)).toBe(true);
  });

  it('re-summarizes only after a step of new messages', () => {
    const state: ConversationState = { engineVersion: 1, summaryMessageCount: 20 };
    expect(shouldSummarize(state, 25)).toBe(false);
    expect(shouldSummarize(state, 30)).toBe(true);
  });

  it('builds a window of the most recent messages plus the summary', () => {
    const history = many(50);
    const state: ConversationState = {
      engineVersion: 1,
      summaryMessageCount: 20,
      summary: 'Earlier context',
    };
    const { recent, summary } = buildHistoryWindow(history, state);
    expect(recent).toHaveLength(30);
    expect(recent[0]!.content).toBe('message 20');
    expect(summary).toBe('Earlier context');
  });

  it('builds a summary input from the un-summarized tail', () => {
    const history = [entry('USER', 'a'), entry('ASSISTANT', 'b'), entry('USER', 'c')];
    const state: ConversationState = { engineVersion: 1, summaryMessageCount: 2 };
    expect(buildSummaryInput(history, state)).toBe('USER: c');
  });

  it('truncates very long summary inputs', () => {
    const state: ConversationState = { engineVersion: 1, summaryMessageCount: 0 };
    const long = Array.from({ length: 100 }, () => entry('USER', 'x'.repeat(1000)));
    const input = buildSummaryInput(long, state, 500);
    expect(input.length).toBe(500);
  });

  it('appends to a previous summary', () => {
    expect(normalizeSummary('new bit', 'old bit')).toBe('old bit\nnew bit');
    expect(normalizeSummary('', 'old bit')).toBe('old bit');
  });
});

describe('context', () => {
  it('formats the context block with summary, memories, reminder and intent', () => {
    const block = buildContextBlock(
      [],
      {
        engineVersion: 1,
        summaryMessageCount: 0,
        summary: 'S1',
        pendingTask: 'T1',
        pendingTaskAt: 'now',
      },
      [{ key: 'name', value: 'Alice', category: null }],
      'task',
    );
    const text = formatContextBlock(block);
    expect(text).toContain('S1');
    expect(text).toContain('- name: Alice');
    expect(text).toContain('T1');
    expect(text).toContain("Intent of the user's latest message: task.");
  });

  it('includes the clarification instruction when supplied', () => {
    const block = buildContextBlock(
      [],
      { engineVersion: 1, summaryMessageCount: 0 },
      [],
      'question',
      'Ask a clarifying question.',
    );
    expect(formatContextBlock(block)).toContain('Ask a clarifying question.');
  });
});

describe('state', () => {
  it('round-trips a full conversation state', () => {
    const state: ConversationState = {
      engineVersion: 1,
      summaryMessageCount: 5,
      summary: 'summary text',
      pendingTask: 'task text',
      pendingTaskAt: '2026-01-01T00:00:00.000Z',
      suggestions: ['one?', 'two?'],
    };
    expect(parseConversationState(serializeConversationState(state))).toEqual(state);
  });

  it('tolerates null, garbage and non-object metadata', () => {
    expect(parseConversationState(null)).toEqual({ engineVersion: 1, summaryMessageCount: 0 });
    expect(parseConversationState('not json')).toEqual({
      engineVersion: 1,
      summaryMessageCount: 0,
    });
    expect(parseConversationState(42)).toEqual({ engineVersion: 1, summaryMessageCount: 0 });
  });

  it('ignores malformed fields but keeps valid ones', () => {
    const state = parseConversationState({
      summary: 'ok',
      summaryMessageCount: 'nope',
      suggestions: ['fine', 5],
    });
    expect(state.summary).toBe('ok');
    expect(state.summaryMessageCount).toBe(0);
    expect(state.suggestions).toBeUndefined();
  });

  it('parses a legacy JSON-string form', () => {
    const state = parseConversationState(
      JSON.stringify({ summary: 'old style', summaryMessageCount: 3 }),
    );
    expect(state.summary).toBe('old style');
    expect(state.summaryMessageCount).toBe(3);
  });
});
