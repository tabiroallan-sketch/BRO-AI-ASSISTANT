import { describe, expect, it } from 'vitest';
import {
  getGrantedPermissions,
  getProviderPermissionDefs,
} from '../../src/integrations/permissions.js';
import type { WebhookProviderDef } from '../../src/integrations/types.js';

const provider: WebhookProviderDef = {
  id: 'test',
  label: 'Test',
  description: 'A test provider',
  type: 'webhook',
  icon: 'external',
  oauthConfigured: true,
  capabilities: ['files:read', 'files:write'],
  permissions: [
    {
      id: 'files.read',
      label: 'Read Files',
      description: 'Read your files.',
      scope: 'files.readonly',
      capability: 'files:read',
    },
    {
      id: 'files.write',
      label: 'Write Files',
      description: 'Write your files.',
      scope: 'files.write',
      capability: 'files:write',
    },
  ],
};

describe('permission manager', () => {
  it('returns the provider permission definitions', () => {
    expect(getProviderPermissionDefs(provider).map((permission) => permission.id)).toEqual([
      'files.read',
      'files.write',
    ]);
  });

  it('marks permissions enabled when every required scope is granted', () => {
    const permissions = getGrantedPermissions(provider, 'files.write');
    const read = permissions.find((permission) => permission.id === 'files.read');
    const write = permissions.find((permission) => permission.id === 'files.write');
    expect(read?.enabled).toBe(false);
    expect(write?.enabled).toBe(true);
  });

  it('marks all permissions disabled when no scopes are granted', () => {
    const permissions = getGrantedPermissions(provider, null);
    expect(permissions.every((permission) => !permission.enabled)).toBe(true);
  });

  it('handles multi-scope permissions requiring every scope', () => {
    const multiScopeProvider: WebhookProviderDef = {
      ...provider,
      permissions: [
        {
          id: 'all.access',
          label: 'Full Access',
          description: 'Everything.',
          scope: 'a b',
          capability: 'files:read',
        },
      ],
    };
    expect(getGrantedPermissions(multiScopeProvider, 'a b')[0]?.enabled).toBe(true);
    expect(getGrantedPermissions(multiScopeProvider, 'a')[0]?.enabled).toBe(false);
  });

  it('preserves permission metadata in the granted result', () => {
    const [permission] = getGrantedPermissions(provider, 'files.write');
    expect(permission?.id).toBe('files.read');
    expect(permission?.capability).toBe('files:read');
    expect(permission?.scope).toBe('files.readonly');
  });
});
