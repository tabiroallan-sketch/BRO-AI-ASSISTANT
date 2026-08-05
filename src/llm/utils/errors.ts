export type LLMErrorCode =
  | 'not_configured'
  | 'auth_failed'
  | 'rate_limited'
  | 'timeout'
  | 'network'
  | 'model_unavailable'
  | 'invalid_request'
  | 'stream_interrupted'
  | 'cancelled'
  | 'unknown';

export type LLMErrorParams = {
  code: LLMErrorCode;
  providerId: string;
  message: string;
  status?: number;
  retryable?: boolean;
  cause?: unknown;
};

export class LLMError extends Error {
  readonly code: LLMErrorCode;
  readonly providerId: string;
  readonly status?: number;
  readonly retryable: boolean;
  override readonly cause?: unknown;

  constructor(params: LLMErrorParams) {
    super(params.message);
    this.name = 'LLMError';
    this.code = params.code;
    this.providerId = params.providerId;
    this.status = params.status;
    this.cause = params.cause;
    this.retryable = params.retryable ?? isRetryableCode(params.code);
  }
}

export function isRetryableCode(code: LLMErrorCode): boolean {
  switch (code) {
    case 'rate_limited':
    case 'timeout':
    case 'network':
    case 'stream_interrupted':
      return true;
    default:
      return false;
  }
}

export function isRateLimited(error: unknown): boolean {
  return error instanceof LLMError && error.code === 'rate_limited';
}

export function isAuthError(error: unknown): boolean {
  return error instanceof LLMError && error.code === 'auth_failed';
}

export function isCancelled(error: unknown): boolean {
  return error instanceof LLMError && error.code === 'cancelled';
}

export function isRetryableError(error: unknown): boolean {
  return error instanceof LLMError && error.retryable;
}

export function isTransientError(error: unknown): boolean {
  if (isRetryableError(error)) {
    return true;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  const candidate = error as Error & { status?: unknown };
  const status = typeof candidate.status === 'number' ? candidate.status : undefined;
  if (status === 429 || (status !== undefined && status >= 500 && status < 600)) {
    return true;
  }
  const name = candidate.name ?? '';
  return (
    name === 'TimeoutError' ||
    name === 'FetchError' ||
    name === 'NetworkError' ||
    name.includes('Timeout')
  );
}

type ClassifyInput = {
  providerId: string;
  status?: number;
  message?: string;
  cause?: unknown;
};

export function classifyHttpError(input: ClassifyInput): LLMError {
  const { providerId, status, message, cause } = input;
  switch (status) {
    case 400:
      return new LLMError({
        code: 'invalid_request',
        providerId,
        status,
        message: message ?? 'The provider rejected the request.',
        cause,
      });
    case 401:
    case 403:
      return new LLMError({
        code: 'auth_failed',
        providerId,
        status,
        message: message ?? 'The provider rejected the API key.',
        cause,
      });
    case 404:
      return new LLMError({
        code: 'model_unavailable',
        providerId,
        status,
        message: message ?? 'The requested model is unavailable.',
        cause,
      });
    case 408:
    case 409:
    case 422:
      return new LLMError({
        code: 'timeout',
        providerId,
        status,
        message: message ?? 'The provider request failed.',
        cause,
      });
    case 429:
      return new LLMError({
        code: 'rate_limited',
        providerId,
        status,
        message: message ?? 'The provider is rate-limiting requests.',
        cause,
      });
    default:
      if (status !== undefined && status >= 500 && status < 600) {
        return new LLMError({
          code: 'network',
          providerId,
          status,
          message: message ?? 'The provider reported a server error.',
          cause,
        });
      }
      return new LLMError({
        code: 'unknown',
        providerId,
        status,
        message: message ?? 'An unknown provider error occurred.',
        cause,
      });
  }
}

export function cancelledError(providerId: string, message = 'Request cancelled.'): LLMError {
  return new LLMError({ code: 'cancelled', providerId, message });
}
