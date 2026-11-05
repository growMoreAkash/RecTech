/** Stable, machine-readable error codes. Clients switch on `code`, never on `message`. */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'INVALID_CREDENTIALS',
  'INVALID_REFRESH_TOKEN',
  'DEVICE_NOT_REGISTERED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'VERSION_CONFLICT',
  'TABLE_INVALID_TRANSITION',
  'TABLE_GUARD_FAILED',
  'NO_OPEN_SEATING',
  'ITEM_UNAVAILABLE',
  'INVALID_MODIFIERS',
  'CART_EMPTY',
  'ORDER_NOT_PENDING',
  'NOTHING_TO_BILL',
  'BILL_NOT_EDITABLE',
  'DISCOUNT_TOO_LARGE',
  'OVERPAYMENT',
  'SPLIT_INVALID',
  'PAYMENT_IN_PROGRESS',
  'PAYMENTS_UNAVAILABLE',
  'PAYMENT_VERIFICATION_FAILED',
  'RATE_LIMITED',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}
