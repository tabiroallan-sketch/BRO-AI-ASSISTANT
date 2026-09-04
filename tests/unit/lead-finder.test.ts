import { describe, expect, it } from 'vitest';
import { deduplicateLeads, normalizeLead } from '../../src/lead-finder/normalize.js';
import { scoreLead } from '../../src/lead-finder/enrichment.js';
import type { RawLead } from '../../src/lead-finder/types.js';

function rawLead(overrides: Partial<RawLead> = {}): RawLead {
  return {
    companyName: 'Acme Dental',
    source: 'google_maps',
    hiringSignals: [],
    intentSignals: [],
    painPoints: [],
    automationOpportunities: [],
    ...overrides,
  };
}

describe('lead finder normalize', () => {
  it('normalizes company names by removing suffixes and lowercasing', () => {
    const fromMaps = rawLead({ companyName: 'Acme Dental LLC', source: 'google_maps' });
    const fromWeb = rawLead({ companyName: 'acme dental', source: 'web' });

    const deduped = deduplicateLeads([fromMaps, fromWeb]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].sources).toContain('google_maps');
    expect(deduped[0].sources).toContain('web');
  });

  it('keeps distinct companies separate', () => {
    const deduped = deduplicateLeads([
      rawLead({ companyName: 'Acme Dental' }),
      rawLead({ companyName: 'Bright Smiles Clinic' }),
    ]);
    expect(deduped).toHaveLength(2);
  });

  it('maps normalized key to a non-empty string', () => {
    const normalized = normalizeLead(rawLead({ companyName: 'Acme Dental LLC' }));
    expect(normalized.normalizedCompanyName.length).toBeGreaterThan(0);
  });
});

describe('lead finder scoring', () => {
  it('returns a score within the 0-100 range', () => {
    const result = scoreLead(rawLead({ companyName: 'Acme Dental' }));
    expect(result.total).toBeGreaterThanOrEqual(0);
    expect(result.total).toBeLessThanOrEqual(100);
  });

  it('scores a fully-signaled lead higher than a bare lead', () => {
    const bare = scoreLead(rawLead({ companyName: 'Acme Dental' }));
    const rich = scoreLead(
      rawLead({
        companyName: 'Acme Dental',
        website: 'https://acme.com',
        phone: '555-0100',
        email: 'hello@acme.com',
        city: 'Austin',
        state: 'TX',
        country: 'US',
        rating: 4.8,
        reviewCount: 120,
        hiringSignals: ['Hiring React Developers'],
        intentSignals: ['Looking for automation'],
        automationOpportunities: ['Patient scheduling'],
        painPoints: ['Long wait times'],
      }),
    );
    expect(rich.total).toBeGreaterThan(bare.total);
  });
});
