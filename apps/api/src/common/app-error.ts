import { HttpStatus } from '@nestjs/common';
import type { ErrorCode } from '@dinesense/shared';

/** Domain error with a stable code. The global filter renders it as `{ error: { code, message, details } }`. */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: HttpStatus,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }

  static notFound(what = 'Resource') {
    return new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, `${what} not found`);
  }
  static forbidden(message = 'You do not have permission to do this') {
    return new AppError('FORBIDDEN', HttpStatus.FORBIDDEN, message);
  }
  static unauthenticated(message = 'Authentication required') {
    return new AppError('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED, message);
  }
}
