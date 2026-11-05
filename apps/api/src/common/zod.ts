import { applyDecorators, HttpStatus, type PipeTransform } from '@nestjs/common';
import { ApiBody, ApiQuery } from '@nestjs/swagger';
import type { ZodTypeAny, z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { AppError } from './app-error';

/** Shape of validation issues in the error body: `details: [{ path, message }]`. */
export const issuesToDetails = (issues: { path: (string | number)[]; message: string }[]) =>
  issues.map((i) => ({ path: i.path.join('.'), message: i.message }));

/**
 * Validates and transforms a request part with a zod schema → 400 VALIDATION_FAILED.
 * Uses safeParse (not `instanceof ZodError`) so it is immune to duplicate zod copies (ESM/CJS).
 */
export class ZodPipe<S extends ZodTypeAny> implements PipeTransform<unknown, z.infer<S>> {
  constructor(private readonly schema: S) {}
  transform(value: unknown): z.infer<S> {
    const result = (this.schema as ZodTypeAny).safeParse(value);
    if (result.success) return result.data as z.infer<S>;
    throw new AppError(
      'VALIDATION_FAILED',
      HttpStatus.BAD_REQUEST,
      'Request validation failed',
      issuesToDetails(result.error.issues),
    );
  }
}

// zodToJsonSchema's generic signature trips TS2589 ("excessively deep") on large schemas; widen it once here.
const toJsonSchema = zodToJsonSchema as unknown as (schema: unknown, opts: object) => Record<string, unknown>;
const toOpenApi = (schema: ZodTypeAny) => toJsonSchema(schema, { target: 'openApi3', $refStrategy: 'none' });

/** Documents a zod body schema in OpenAPI. Pair with `@Body(new ZodPipe(schema))`. */
export const ApiZodBody = (schema: ZodTypeAny) => ApiBody({ schema: toOpenApi(schema) });

/** Documents zod query params (object schema) in OpenAPI. */
export function ApiZodQuery(schema: ZodTypeAny) {
  const json = toOpenApi(schema) as { properties?: Record<string, object>; required?: string[] };
  return applyDecorators(
    ...Object.entries(json.properties ?? {}).map(([name, s]) =>
      ApiQuery({ name, required: json.required?.includes(name) ?? false, schema: s }),
    ),
  );
}
