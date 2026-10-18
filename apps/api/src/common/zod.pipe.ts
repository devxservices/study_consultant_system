import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { ZodType, ZodTypeDef } from 'zod';

/**
 * Validates a body/query against a Zod schema from @crm/shared, so the API and
 * the browser enforce exactly the same rules and the same error wording.
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  // Any input shape: a schema may coerce or transform what arrives ("true" -> true).
  constructor(private readonly schema: ZodType<T, ZodTypeDef, any>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    // Field-keyed errors so the form can highlight the offending input.
    const fieldErrors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '_';
      fieldErrors[key] ??= issue.message;
    }
    throw new BadRequestException({
      message: 'Please check the highlighted fields.',
      fieldErrors,
      error: 'ValidationError',
    });
  }
}

export const zodPipe = <T>(schema: ZodType<T, ZodTypeDef, any>) => new ZodValidationPipe(schema);
