import { describe, expect, it } from 'vitest';
import {
  buildMemoryIndex,
  buildMemoryTimeline,
  decayScore,
  defaultMemoryMeta,
  formatMemoryDigestInput,
  groupMemoriesByCategory,
  memoryEventDate,
  mergeExtraction,
  normalizeDraft,
  parseDigestJson,
  parseExtractionJson,
  parseMemoryMetadata,
  parseMemoryRecord,
  reinforce,
  rankMemoriesByQuery,
  rankMemoriesForChat,
  rankMemoriesByVitality,
  searchMemoryIndex,
  serializeMemoryMetadata,
  type MemoryMeta,
  type MemoryRecord,
} from '../src/memory-engine/index.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function meta(overrides: Partial<MemoryMeta> = {}): MemoryMeta {
  return { kind: 'other', importance: 5, tags: [], relatedIds: [], accessCount: 0, ...overrides };
}

function record(
  id: string,
  key: string,
  value: string,
  overrides: Partial<MemoryRecord> = {},
): MemoryRecord {
  return {
    id,
    key,
    value,
    category: null,
    meta: meta(),
    createdAt: new Date(1),
    updatedAt: new Date(1),
    ...overrides,
  };
}

describe('metadata', () => {
  it('produces defaults for empty or non-object metadata', () => {
    expect(parseMemoryMetadata(null)).toEqual(defaultMemoryMeta());
    expect(parseMemoryMetadata('{}')).toEqual(defaultMemoryMeta());
    expect(parseMemoryMetadata({})).toEqual(defaultMemoryMeta());
  });

  it('parses and serializes rich metadata', () => {
    const input = {
      v: 1,
      kind: 'project',
      importance: 8,
      tags: ['bro', 'stage-8'],
      relatedIds: ['abc', 'def'],
      lastAccessedAt: '2026-08-01T00:00:00.000Z',
      accessCount: 3,
    };
    expect(parseMemoryMetadata(input)).toEqual({
      kind: 'project',
      importance: 8,
      tags: ['bro', 'stage-8'],
      relatedIds: ['abc', 'def'],
      lastAccessedAt: '2026-08-01T00:00:00.000Z',
      accessCount: 3,
    });
    expect(serializeMemoryMetadata(parseMemoryMetadata(input))).toMatchObject({
      v: 1,
      kind: 'project',
      importance: 8,
    });
  });

  it('clamps importance and dedupes tags', () => {
    const parsed = parseMemoryMetadata({
      kind: 'nonsense',
      importance: 42,
      tags: ['a', 'a', '', 'b', 'b'],
      accessCount: -4,
    });
    expect(parsed.kind).toBe('other');
    expect(parsed.importance).toBe(10);
    expect(parsed.tags).toEqual(['a', 'b']);
    expect(parsed.accessCount).toBe(0);
  });

  it('converts a row into a memory record', () => {
    const parsed = parseMemoryRecord({
      id: 'm1',
      key: 'name',
      value: 'Alice',
      category: 'personal',
      metadata: { kind: 'preference', importance: 7 },
      createdAt: new Date(1),
      updatedAt: new Date(2),
    });
    expect(parsed.meta.kind).toBe('preference');
    expect(parsed.meta.importance).toBe(7);
    expect(parsed.updatedAt).toEqual(new Date(2));
  });
});

describe('vector', () => {
  it('ranks the semantically relevant memory first', () => {
    const records = [
      record('a', 'name', 'Alice', { category: 'personal' }),
      record('b', 'project', 'shipping the stage-8 long term memory engine', { category: 'work' }),
      record('c', 'pet', 'a dog named Rex', { category: 'personal' }),
    ];
    const index = buildMemoryIndex(records);
    const hits = searchMemoryIndex(index, 'what are you building for long term memory?', 3);
    expect(hits[0]!.id).toBe('b');
  });

  it('tolerates typos through character n-grams', () => {
    const records = [
      record('a', 'favoriteColor', 'blue', { category: 'personal' }),
      record('b', 'meeting', 'standup with the backend team', { category: 'work' }),
    ];
    const index = buildMemoryIndex(records);
    const hits = searchMemoryIndex(index, 'favorit colour', 2);
    expect(hits[0]!.id).toBe('a');
  });

  it('returns scores in the 0..1 range', () => {
    const records = [record('a', 'name', 'Alice')];
    const index = buildMemoryIndex(records);
    const hits = searchMemoryIndex(index, 'alice', 1);
    expect(hits[0]!.score).toBeGreaterThanOrEqual(0);
    expect(hits[0]!.score).toBeLessThanOrEqual(1);
  });
});

describe('decay', () => {
  const now = new Date('2026-08-07T00:00:00.000Z');

  it('scores fresh memories higher than old ones', () => {
    const fresh = meta({ importance: 5, lastAccessedAt: '2026-08-06T00:00:00.000Z' });
    const old = meta({ importance: 5, lastAccessedAt: '2026-01-01T00:00:00.000Z' });
    expect(decayScore(fresh, now, new Date(0))).toBeGreaterThan(decayScore(old, now, new Date(0)));
  });

  it('never exceeds importance and is bounded by 1..10', () => {
    const fresh = meta({ importance: 10, lastAccessedAt: now.toISOString() });
    expect(decayScore(fresh, now, new Date(0))).toBeLessThanOrEqual(10);
  });

  it('reinforce refreshes lastAccessedAt and counts accesses', () => {
    const before = meta({ importance: 6, accessCount: 2 });
    const after = reinforce(before, now);
    expect(after.accessCount).toBe(3);
    expect(after.lastAccessedAt).toBe(now.toISOString());
    expect(after.importance).toBe(6);
  });
});

describe('search ranking', () => {
  const now = new Date('2026-08-07T00:00:00.000Z');
  const tenDaysAgo = new Date(now.getTime() - 10 * DAY_MS);
  const records = [
    record('a', 'name', 'Alice', {
      category: 'personal',
      updatedAt: tenDaysAgo,
      meta: meta({ importance: 9, accessCount: 4, lastAccessedAt: now.toISOString() }),
    }),
    record('b', 'city', 'lives in Paris', {
      category: 'personal',
      updatedAt: tenDaysAgo,
      meta: meta({ importance: 5 }),
    }),
    record('c', 'work', 'backend engineer at Acme', {
      category: 'work',
      updatedAt: tenDaysAgo,
      meta: meta({ importance: 7 }),
    }),
  ];

  it('ranks semantic matches first for a query', () => {
    const ranked = rankMemoriesByQuery(records, 'where does she live?', now, 3);
    expect(ranked[0]!.id).toBe('b');
  });

  it('favors important fresh memories when the query is irrelevant', () => {
    const ranked = rankMemoriesByQuery(records, 'xyzzy plugh', now, 3);
    expect(ranked[0]!.id).toBe('a');
  });

  it('rankMemoriesForChat rewards history overlap', () => {
    const ranked = rankMemoriesForChat(
      records,
      'do I have a job?',
      'talking about backend work at Acme',
      now,
      3,
    );
    expect(ranked[0]!.id).toBe('c');
  });

  it('falls back to vitality ranking without a query', () => {
    const ranked = rankMemoriesForChat(records, '', '', now, 3);
    expect(ranked[0]!.id).toBe('a');
  });

  it('rankMemoriesByVitality sorts by importance and freshness', () => {
    const ranked = rankMemoriesByVitality(records, now, 3);
    expect(ranked[0]!.id).toBe('a');
  });

  it('caps results at topK', () => {
    const many = Array.from({ length: 20 }, (_, index) =>
      record(`k${index}`, `key${index}`, `value ${index}`),
    );
    expect(rankMemoriesByQuery(many, 'value', now, 5)).toHaveLength(5);
  });
});

describe('timeline', () => {
  const now = new Date();

  it('buckets memories into recency groups', () => {
    const records = [
      record('a', 'today', 'fresh', {
        updatedAt: new Date(now.getTime() - 5 * 60 * 1000),
        meta: meta({ lastAccessedAt: now.toISOString() }),
      }),
      record('b', 'old', 'ancient', { updatedAt: new Date(now.getTime() - 400 * DAY_MS) }),
      record('c', 'week', 'weekish', { updatedAt: new Date(now.getTime() - 3 * DAY_MS) }),
      record('d', 'month', 'monthish', { updatedAt: new Date(now.getTime() - 20 * DAY_MS) }),
    ];
    const groups = buildMemoryTimeline(records);
    const labels = groups.map((group) => group.label);
    expect(labels[0]).toBe('Today');
    expect(labels).toContain('Last 7 days');
    expect(labels).toContain('Last 30 days');
    const today = groups.find((group) => group.label === 'Today');
    expect(today?.items.map((item) => item.record.key)).toEqual(['today']);
  });

  it('reports accessed vs updated activity', () => {
    const updated = record('a', 'updated', 'changed', {
      updatedAt: new Date(now.getTime() - 1000),
    });
    const accessed = record('b', 'accessed', 'recalled', {
      updatedAt: new Date(now.getTime() - 1000),
      meta: meta({ lastAccessedAt: now.toISOString() }),
    });
    const groups = buildMemoryTimeline([updated, accessed]);
    const items = groups.flatMap((group) => group.items);
    expect(items.find((item) => item.record.key === 'accessed')?.activity).toBe('accessed');
    expect(items.find((item) => item.record.key === 'updated')?.activity).toBe('updated');
  });

  it('memoryEventDate prefers lastAccessedAt over updatedAt', () => {
    const nowDate = new Date();
    const seen = record('a', 'seen', 'x', {
      updatedAt: new Date(nowDate.getTime() - 100 * DAY_MS),
      meta: meta({ lastAccessedAt: nowDate.toISOString() }),
    });
    expect(memoryEventDate(seen).getTime()).toBeCloseTo(nowDate.getTime(), -3);
  });
});

describe('extraction', () => {
  it('parses the standard memories array shape', () => {
    const drafts = parseExtractionJson(
      '{"memories":[{"key":"name","value":"Alice","kind":"preference","importance":8},{"key":"project","value":"stage 8","category":"work"}]}',
    );
    expect(drafts).toHaveLength(2);
    expect(drafts![0]).toMatchObject({
      key: 'name',
      value: 'Alice',
      kind: 'preference',
      importance: 8,
    });
  });

  it('accepts the add array shape', () => {
    const drafts = parseExtractionJson('{"add":[{"key":"city","value":"Paris"}]}');
    expect(drafts).toHaveLength(1);
    expect(drafts![0]!.key).toBe('city');
  });

  it('returns undefined for invalid or non-JSON output', () => {
    expect(parseExtractionJson('not json')).toBeUndefined();
    expect(parseExtractionJson('{"foo":1}')).toBeUndefined();
  });

  it('normalizes drafts, dropping invalid entries', () => {
    expect(normalizeDraft({ key: '', value: 'x' })).toBeUndefined();
    expect(normalizeDraft({ key: 'k', value: '' })).toBeUndefined();
    const draft = normalizeDraft({
      key: '  key  ',
      value: '  value  ',
      importance: 42,
      kind: 'meeting',
      tags: ['a', 'a', ''],
      category: 'work',
    });
    expect(draft).toEqual({
      key: 'key',
      value: 'value',
      importance: 10,
      kind: 'meeting',
      tags: ['a'],
      category: 'work',
    });
  });

  it('merges new keys into add and changed keys into update', () => {
    const existing = [
      record('m1', 'name', 'Alice'),
      record('m2', 'city', 'Paris', { meta: meta({ kind: 'preference', importance: 4 }) }),
    ];
    const extraction = mergeExtraction(
      [
        { key: 'name', value: 'Alex', importance: 9 },
        { key: 'project', value: 'stage 8' },
        { key: 'city', value: 'Paris', kind: 'preference', importance: 4 },
      ],
      existing,
    );
    expect(extraction.add).toHaveLength(1);
    expect(extraction.add[0]!.key).toBe('project');
    expect(extraction.update).toHaveLength(1);
    expect(extraction.update[0]!.id).toBe('m1');
    expect(extraction.update[0]!.value).toBe('Alex');
    expect(extraction.update[0]!.importance).toBe(9);
  });

  it('matches existing keys case-insensitively', () => {
    const existing = [record('m1', 'Name', 'Alice')];
    const extraction = mergeExtraction([{ key: 'name', value: 'Alex' }], existing);
    expect(extraction.add).toEqual([]);
    expect(extraction.update).toHaveLength(1);
  });
});

describe('digest helpers', () => {
  it('groups memories by category with importance ordering', () => {
    const records = [
      record('a', 'one', 'v1', { category: 'work', meta: meta({ importance: 3 }) }),
      record('b', 'two', 'v2', { category: 'work', meta: meta({ importance: 8 }) }),
      record('c', 'three', 'v3', { category: null }),
    ];
    const groups = groupMemoriesByCategory(records);
    expect(groups).toHaveLength(2);
    const work = groups.find((group) => group.category === 'work');
    expect(work?.records.map((record) => record.key)).toEqual(['two', 'one']);
    expect(groups[groups.length - 1]!.category).toBe('uncategorized');
  });

  it('formats a compact digest input', () => {
    const records = [
      record('a', 'name', 'Alice', {
        category: 'personal',
        meta: meta({ kind: 'preference', importance: 8 }),
      }),
    ];
    const input = formatMemoryDigestInput(records);
    expect(input).toContain('## personal');
    expect(input).toContain('name: Alice (preference, importance 8)');
  });

  it('parses digest JSON and falls back to raw text', () => {
    expect(parseDigestJson('{"summary":"a kind user"}')).toBe('a kind user');
    expect(parseDigestJson('```json\n{"digest":"digested"}\n```')).toBe('digested');
    expect(parseDigestJson('plain text')).toBe('plain text');
  });
});
