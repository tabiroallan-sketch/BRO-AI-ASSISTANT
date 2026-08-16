import { describe, expect, it } from 'vitest';
import {
  classifyCandidate,
  deduplicateCandidates,
  discoverOpportunities,
  getSourceAdapter,
  listSourceAdapters,
} from '../../src/sales/sources/index.js';
import {
  normalizeUserSubmitted,
  type UserSubmittedInput,
} from '../../src/sales/sources/user-submitted.js';
import type { OpportunityCandidate } from '../../src/sales/sources/types.js';

function makeCandidate(overrides: Partial<OpportunityCandidate>): OpportunityCandidate {
  return {
    title: 'Build a landing page',
    source: 'web-search',
    sourceReliability: 'LOW',
    ...overrides,
  };
}

describe('source adapter registry', () => {
  it('registers the default adapters', () => {
    const ids = listSourceAdapters().map((adapter) => adapter.id);
    expect(ids).toContain('user-submitted');
    expect(ids).toContain('web-search');
    expect(ids).toContain('company-career');
  });

  it('returns an adapter by id', () => {
    expect(getSourceAdapter('web-search')?.label).toBe('Web search');
    expect(getSourceAdapter('does-not-exist')).toBeUndefined();
  });
});

describe('deduplication', () => {
  it('drops candidates sharing the same sourceUrl', () => {
    const candidates = [
      makeCandidate({ sourceUrl: 'https://example.com/jobs/1' }),
      makeCandidate({ sourceUrl: 'https://example.com/jobs/1' }),
      makeCandidate({ sourceUrl: 'https://example.com/jobs/2' }),
    ];
    expect(deduplicateCandidates(candidates)).toHaveLength(2);
  });

  it('keeps candidates without a sourceUrl when company+title differ', () => {
    const candidates = [
      makeCandidate({ company: 'Acme', title: 'React dev' }),
      makeCandidate({ company: 'Acme', title: 'Next.js dev' }),
      makeCandidate({ company: 'Acme', title: 'React dev' }),
    ];
    expect(deduplicateCandidates(candidates)).toHaveLength(2);
  });
});

describe('candidate classification', () => {
  it('classifies job postings', () => {
    const result = classifyCandidate(
      makeCandidate({ title: 'We are hiring a Full Stack Developer', rawContent: 'Join our team' }),
    );
    expect(result.type).toBe('JOB');
  });

  it('classifies RFPs and outsourcing', () => {
    const result = classifyCandidate(
      makeCandidate({ description: 'Request for proposal for a new CRM system' }),
    );
    expect(result.type).toBe('OUTSOURCING');
  });

  it('classifies direct client requests', () => {
    const result = classifyCandidate(
      makeCandidate({ description: 'Looking for a developer to build a website for my bakery' }),
    );
    expect(result.type).toBe('POTENTIAL_CLIENT');
  });

  it('defaults unknown content to potential client', () => {
    const result = classifyCandidate(makeCandidate({ description: 'Annual report 2026' }));
    expect(result.type).toBe('POTENTIAL_CLIENT');
  });
});

describe('user-submitted normalization', () => {
  it('normalizes structured input into a high-reliability candidate', () => {
    const input: UserSubmittedInput = {
      title: '  Website redesign  ',
      company: ' Acme ',
      requiredSkills: [' react ', '', 'nodejs '],
      remote: true,
      compensation: '$5k',
    };
    const candidate = normalizeUserSubmitted(input);
    expect(candidate.title).toBe('Website redesign');
    expect(candidate.company).toBe('Acme');
    expect(candidate.requiredSkills).toEqual(['react', 'nodejs']);
    expect(candidate.remote).toBe(true);
    expect(candidate.source).toBe('user-submitted');
    expect(candidate.sourceReliability).toBe('HIGH');
  });
});

describe('discoverOpportunities', () => {
  it('reports unknown source adapters without throwing', async () => {
    const result = await discoverOpportunities({
      query: 'freelance react developer',
      sources: ['does-not-exist'],
    });
    expect(result.candidates).toEqual([]);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]?.source).toBe('does-not-exist');
  });

  it('applies the limit to merged candidates', async () => {
    const candidates: OpportunityCandidate[] = Array.from({ length: 10 }, (_, index) =>
      makeCandidate({ sourceUrl: `https://example.com/jobs/${index}` }),
    );
    const limited = deduplicateCandidates(candidates).slice(0, 5);
    expect(limited).toHaveLength(5);
  });
});
