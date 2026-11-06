import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ApiErrorBody, ErrorCode } from '@dinesense/shared';
import type { Request, Response } from 'express';
import { TenantViolationError } from '../prisma/tenant';
import { AppError } from './app-error';
import { issuesToDetails } from './zod';

const STATUS_CODES: Partial<Record<number, ErrorCode>> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'RATE_LIMITED',
};

@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('ErrorFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<Request & { id?: string }>();
    const { status, body } = this.toBody(exception);
    body.error.requestId = typeof req.id === 'string' ? req.id : undefined;
    if (status >= 500) this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    res.status(status).json(body);
  }

  private toBody(e: unknown): { status: number; body: ApiErrorBody } {
    const make = (status: number, code: ErrorCode, message: string, details?: unknown) => ({
      status,
      body: { error: { code, message, ...(details === undefined ? {} : { details }) } },
    });

    if (e instanceof AppError) return make(e.status, e.code, e.message, e.details);
    // Duck-typed: a ZodError thrown outside ZodPipe (e.g. a service-level parse) may come from another zod copy.
    if (e instanceof Error && e.name === 'ZodError' && Array.isArray((e as { issues?: unknown }).issues)) {
      const issues = (e as unknown as { issues: Parameters<typeof issuesToDetails>[0] }).issues;
      return make(400, 'VALIDATION_FAILED', 'Request validation failed', issuesToDetails(issues));
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === 'P2025') return make(404, 'NOT_FOUND', 'Resource not found');
      if (e.code === 'P2002') return make(409, 'CONFLICT', 'A record with these values already exists');
    }
    if (e instanceof TenantViolationError) return make(403, 'FORBIDDEN', 'Cross-tenant write rejected');
    if (e instanceof HttpException) {
      const status = e.getStatus();
      return make(status, STATUS_CODES[status] ?? 'INTERNAL', e.message);
    }
    return make(HttpStatus.INTERNAL_SERVER_ERROR, 'INTERNAL', 'Something went wrong');
  }
}
