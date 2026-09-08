import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/integrations/credential-store.js', () => ({
  getAllCredentials: vi.fn(async () => ({
    google_maps: { apiKey: 'gm-live-key' },
    reddit: { clientId: 'reddit-id', clientSecret: 'reddit-secret', userAgent: 'reddit-ua' },
  })),
}));

import {
  getLeadCredential,
  getLeadCredentialSync,
  invalidateLeadCredentialCache,
  reloadLeadCredentials,
  resolveLeadApiKey,
} from '../../src/lead-finder/credentials.js';
import { getAllCredentials } from '../../src/integrations/credential-store.js';

describe('lead finder runtime credentials', () => {
  beforeEach(async () => {
    invalidateLeadCredentialCache();
    vi.clearAllMocks();
    await reloadLeadCredentials();
  });

  it('resolves runtime (admin-stored) credentials by provider', async () => {
    expect(await getLeadCredential('google_maps', 'apiKey')).toBe('gm-live-key');
    expect(getLeadCredentialSync('reddit', 'clientId')).toBe('reddit-id');
    expect(getLeadCredentialSync('reddit', 'clientSecret')).toBe('reddit-secret');
  });

  it('prefers runtime credentials over env fallback for API keys', async () => {
    invalidateLeadCredentialCache();
    await reloadLeadCredentials();

    expect(await resolveLeadApiKey('google_maps', 'ENV_FALLBACK')).toBe('gm-live-key');
  });

  it('falls back to env when no runtime credential is stored', async () => {
    vi.mocked(getAllCredentials).mockResolvedValueOnce({});
    invalidateLeadCredentialCache();
    await reloadLeadCredentials();

    expect(await resolveLeadApiKey('web', 'ENV-WEB-KEY')).toBe('ENV-WEB-KEY');
    expect(getLeadCredentialSync('linkedin', 'apiKey')).toBeUndefined();
  });

  it('returns undefined after the cache is invalidated until reload', () => {
    invalidateLeadCredentialCache();
    expect(getLeadCredentialSync('google_maps', 'apiKey')).toBeUndefined();
  });
});
