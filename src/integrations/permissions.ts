import type { PermissionDef, PermissionState, ProviderDef } from './types.js';

function splitScopes(value: string | null): Set<string> {
  return new Set((value ?? '').split(/\s+/).filter(Boolean));
}

export function getProviderPermissionDefs(provider: ProviderDef): PermissionDef[] {
  return provider.permissions;
}

/**
 * Derives the user-visible permission state for a connected integration from
 * the granted scope string returned by the provider. A permission is enabled
 * when every scope it requires is present in the granted set.
 */
export function getGrantedPermissions(
  provider: ProviderDef,
  grantedScopes: string | null,
): PermissionState[] {
  const scopes = splitScopes(grantedScopes);
  return provider.permissions.map((permission) => ({
    ...permission,
    enabled: permission.scope
      .split(/\s+/)
      .filter(Boolean)
      .every((scope) => scopes.has(scope)),
  }));
}
