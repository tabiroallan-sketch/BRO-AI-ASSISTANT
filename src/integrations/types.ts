export type ProviderAuthType = 'oauth' | 'webhook' | 'token';

export type ConnectionStatus =
  'connected' | 'needs_refresh' | 'expired' | 'revoked' | 'not_connected' | 'error';

/**
 * The live-health classification shown in Connection Health. More granular
 * than ConnectionStatus: it tells the user WHY a connection is unhealthy.
 */
export type HealthIssue =
  | 'connected'
  | 'disconnected'
  | 'expired'
  | 'rate_limited'
  | 'invalid_credentials'
  | 'missing_scope'
  | 'revoked'
  | 'network'
  | 'error';

export type QuotaInfo = {
  /** Units consumed (requests, API calls, credits) in the current window. */
  used: number | null;
  /** Window ceiling, when the provider reports one. */
  limit: number | null;
  /** Approximate requests left, when the provider reports one. */
  remaining: number | null;
  /** ISO timestamp of the quota window reset, when known. */
  resetAt: string | null;
};

/**
 * A capability is a stable, provider-agnostic action identifier that BRO tools
 * rely on (e.g. 'gmail:read', 'calendar:write'). It decouples tool code from
 * any single provider and lets the AI awareness layer discover what a user can
 * do without hardcoding provider names.
 */
export type ProviderCapability = string;

export type PermissionDef = {
  id: string;
  label: string;
  description: string;
  /** Space-separated OAuth scope (or scopes) required to grant this permission. */
  scope: string;
  capability: ProviderCapability;
};

export type PermissionState = PermissionDef & { enabled: boolean };

export type HealthProbe = {
  ok: boolean;
  accountName?: string | null;
  message?: string | null;
  /**
   * Optional failure classification. Returned by providers that already know
   * the failure mode (e.g. a probe catching a ProviderError). The monitor
   * falls back to classifying from the HTTP status.
   */
  code?: string | null;
  /** Rate-limit / quota snapshot observed during the probe. */
  quota?: QuotaInfo | null;
  /** Provider API status label, e.g. 'operational', 'degraded', 'down'. */
  apiStatus?: string | null;
};

export type HealthResult = {
  ok: boolean;
  status: ConnectionStatus;
  issue?: HealthIssue | null;
  code?: string | null;
  latencyMs: number | null;
  accountName: string | null;
  message: string | null;
  quota?: QuotaInfo | null;
  apiStatus?: string | null;
  checkedAt: string;
};

export type ConnectionTestResult = {
  ok: boolean;
  accountName: string | null;
  message: string | null;
  latencyMs: number | null;
};

type BaseProviderDef = {
  id: string;
  label: string;
  description: string;
  icon: string;
  oauthConfigured: boolean;
  capabilities: ProviderCapability[];
  permissions: PermissionDef[];
  /**
   * Lightweight connectivity probe. Receives the (decrypted) access token and
   * the integration metadata. Defaults to the provider's `accountName` probe
   * for OAuth providers when not supplied.
   */
  healthCheck?: (token: string, metadata: Record<string, unknown>) => Promise<HealthProbe>;
};

export type OAuthProviderDef = BaseProviderDef & {
  type: 'oauth';
  scopes: string[];
  supportsRefresh: boolean;
  /**
   * Use Proof Key for Code Exchange. Defaults to true when unspecified; the
   * OAuth engine skips PKCE only for providers that opt out explicitly.
   */
  pkce?: boolean;
  authorizationUrl: string;
  tokenUrl: string;
  authorizationParams(
    state: string,
    redirectUri: string,
    opts?: { codeChallenge?: string; scopes?: string[] },
  ): URLSearchParams;
  tokenParams(code: string, redirectUri: string, opts?: { codeVerifier?: string }): URLSearchParams;
  refreshParams(refreshToken: string): URLSearchParams;
  accountName(accessToken: string): Promise<string | null>;
  tokenResponseAccessToken(body: Record<string, unknown>): string | null;
  tokenResponseRefreshToken(body: Record<string, unknown>): string | null;
  tokenResponseExpiresIn(body: Record<string, unknown>): number;
  tokenResponseScope(body: Record<string, unknown>): string | null;
  /**
   * Best-effort provider-side token revocation, called on disconnect when
   * present. Failures are swallowed: local removal always proceeds.
   */
  revoke?: (accessToken: string) => Promise<void>;
};

export type WebhookProviderDef = BaseProviderDef & {
  type: 'webhook';
};

export type TokenField = { name: string; label: string; placeholder: string };

export type TokenProviderDef = BaseProviderDef & {
  type: 'token';
  fields: TokenField[];
  /**
   * Derives the account label from the submitted field values. Defaults to
   * "<label> connection" when omitted, so per-provider naming (e.g. WhatsApp
   * phone numbers) can be expressed without special-casing the save route.
   */
  accountNameFromFields?: (values: Record<string, string>) => string | null;
};

export type ProviderDef = OAuthProviderDef | WebhookProviderDef | TokenProviderDef;
