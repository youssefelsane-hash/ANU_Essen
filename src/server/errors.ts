export type ErrorCode =
  | 'VALIDATION'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID_TRANSITION'
  | 'STORE_CLOSED'
  | 'STORE_PAUSED'
  | 'PAYMENT_METHOD_DISABLED'
  | 'MIN_ORDER'
  | 'PROMO_INVALID'
  | 'PRICING'
  | 'IDEMPOTENCY_MISMATCH'
  | 'RATE_LIMITED'
  | 'PAYLOAD_TOO_LARGE'
  | 'INTERNAL';

const STATUS: Record<ErrorCode, number> = {
  VALIDATION: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INVALID_TRANSITION: 409,
  STORE_CLOSED: 409,
  STORE_PAUSED: 409,
  PAYMENT_METHOD_DISABLED: 409,
  MIN_ORDER: 422,
  PROMO_INVALID: 422,
  PRICING: 422,
  IDEMPOTENCY_MISMATCH: 422,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  INTERNAL: 500,
};

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message?: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message ?? code);
    this.name = 'AppError';
  }
  get status() {
    return STATUS[this.code];
  }
}
