export type ProviderErrorCode =
  | 'TOKEN_EXPIRED'
  | 'TOKEN_MISSING'
  | 'RATE_LIMITED'
  | 'INVALID_CREDENTIALS'
  | 'MISSING_SCOPE'
  | 'PERMISSION_DENIED'
  | 'NOT_CONFIGURED'
  | 'NETWORK'
  | 'RESPONSE';

export type ProviderErrorOptions = {
  code: ProviderErrorCode;
  providerId: string;
  status?: number | null;
  retryable?: boolean;
  cause?: unknown;
};

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly providerId: string;
  readonly status: number | null;
  readonly retryable: boolean;

  constructor(message: string, options: ProviderErrorOptions) {
    super(message);
    this.name = 'ProviderError';
    this.code = options.code;
    this.providerId = options.providerId;
    this.status = options.status ?? null;
    this.retryable = options.retryable ?? retryableByDefault(options.code);
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

function retryableByDefault(code: ProviderErrorCode): boolean {
  return (
    code === 'RATE_LIMITED' || code === 'NETWORK' || code === 'RESPONSE' || code === 'TOKEN_EXPIRED'
  );
}

export function isProviderError(error: unknown): error is ProviderError {
  return error instanceof ProviderError;
}

export function notConnectedError(label: string): string {
  return `The user has not connected ${label}. Ask them to connect it from Settings → Integrations, then try again.`;
}

export function permissionDeniedError(providerLabel: string, permissionLabel: string): string {
  return `${providerLabel} permission "${permissionLabel}" is disabled. Enable it from Settings → Permission Center, then try again.`;
}

/**
 * Maps a provider HTTP status (or transport failure) to a typed ProviderError.
 * Shared by the health checker, credential refresh path, and tool layers so
 * every provider failure is classified identically.
 */
export function providerErrorFromHttp(
  providerId: string,
  label: string,
  status: number | null,
  message?: string,
  cause?: unknown,
): ProviderError {
  const fallback = message ?? `Provider request failed${status ? ` with status ${status}` : ''}`;
  let code: ProviderErrorCode;
  switch (status) {
    case 401:
      code = 'INVALID_CREDENTIALS';
      break;
    case 403:
      code = 'MISSING_SCOPE';
      break;
    case 429:
      code = 'RATE_LIMITED';
      break;
    case null:
    case undefined:
      code = 'NETWORK';
      break;
    default:
      code = status >= 500 ? 'RESPONSE' : 'RESPONSE';
  }
  const retryable =
    status === null || status === undefined || status === 429 || (status ?? 0) >= 500;
  return new ProviderError(`${label}: ${fallback}`, {
    code,
    providerId,
    status,
    retryable,
    cause,
  });
}

/**
 * Renders a provider failure as a short, model-readable message. Tool outputs
 * and the AI awareness layer use this so BRO can tell the user what went wrong
 * (e.g. "permission missing") instead of echoing a raw HTTP status.
 */
export function toUserMessage(error: unknown): string {
  if (error instanceof ProviderError) {
    switch (error.code) {
      case 'TOKEN_MISSING':
      case 'TOKEN_EXPIRED':
        return error.message;
      case 'RATE_LIMITED':
        return `The provider is rate limiting requests right now. Please wait a moment and try again.`;
      case 'MISSING_SCOPE':
        return `BRO is missing a permission for this provider. Reconnect it and grant the requested scopes.`;
      case 'PERMISSION_DENIED':
        return error.message;
      case 'INVALID_CREDENTIALS':
        return `The connected account credentials are invalid. Reconnect the provider from Settings → Integrations.`;
      case 'NOT_CONFIGURED':
        return `This provider is not configured.`;
      case 'NETWORK':
        return `Could not reach the provider. Check the network and try again.`;
      case 'RESPONSE':
        return `The provider returned an unexpected response. Please try again.`;
      default:
        return error.message;
    }
  }
  return error instanceof Error ? error.message : String(error);
}
