import { describe, expect, it, vi } from 'vitest';
import { getLiveProviderStatuses } from '../../src/lead-finder/provider-status.js';
import '../../src/lead-finder/index.js';

describe('lead finder provider live status', () => {
  it('returns a health result for every registered provider, never throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200 }) as Response),
    );

    const results = await getLiveProviderStatuses();

    expect(Array.isArray(results)).toBe(true);
    const providerIds = results.map((result) => result.providerId);
    for (const id of ['google_maps', 'linkedin', 'indeed', 'reddit', 'web']) {
      expect(providerIds).toContain(id);
    }
    for (const result of results) {
      expect(result.providerId).toBeTruthy();
      expect(result.label).toBeTruthy();
      expect(['connected', 'not_configured', 'error', 'degraded']).toContain(result.status);
      if (result.message !== undefined) {
        expect(typeof result.message).toBe('string');
      }
    }

    const reddit = results.find((result) => result.providerId === 'reddit');
    expect(reddit?.status).toBe('connected');

    vi.unstubAllGlobals();
  });
});
