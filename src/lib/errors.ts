export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'UPSTREAM_RATE_LIMITED'
  | 'UPSTREAM_UNAVAILABLE'
  | 'NOT_AVAILABLE_ON_PLAN'
  | 'NOT_CONFIGURED'
  | 'UNAUTHORIZED'
  | 'INTERNAL';

export interface ErrorDetail {
  path: string;
  message: string;
}

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: 400 | 401 | 403 | 404 | 429 | 500 | 502 | 503,
    message: string,
    readonly details?: ErrorDetail[],
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class ValidationError extends AppError {
  constructor(details: ErrorDetail[]) {
    super('VALIDATION_ERROR', 400, 'Some parameters are invalid.', details);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found.') {
    super('NOT_FOUND', 404, message);
  }
}

/** Our own outgoing budget (or the provider) says no more calls right now. */
export class UpstreamRateLimitedError extends AppError {
  constructor(retryAfterSeconds: number, provider: string) {
    super('UPSTREAM_RATE_LIMITED', 503, `The ${provider} request budget is used up. Try again shortly.`, undefined, retryAfterSeconds);
  }
}

export class UpstreamError extends AppError {
  constructor(message: string) {
    super('UPSTREAM_UNAVAILABLE', 502, message);
  }
}

export class PlanRestrictedError extends AppError {
  constructor(message: string) {
    super('NOT_AVAILABLE_ON_PLAN', 403, message);
  }
}

export class NotConfiguredError extends AppError {
  constructor(message: string) {
    super('NOT_CONFIGURED', 500, message);
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
