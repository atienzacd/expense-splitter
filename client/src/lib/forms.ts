import type { z } from "zod";

/** One message per field, keyed by field name. */
export type FieldErrors<T> = Partial<Record<keyof T & string, string>>;

export type Validation<T> = { ok: true; data: T } | { ok: false; errors: FieldErrors<T> };

/** Checks form values against a Zod schema, keeping the first message for each field. */
export function validate<S extends z.ZodType>(schema: S, values: unknown): Validation<z.output<S>> {
  const result = schema.safeParse(values);
  if (result.success) return { ok: true, data: result.data };

  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const field = String(issue.path[0] ?? "");
    errors[field] ??= issue.message;
  }
  return { ok: false, errors: errors as FieldErrors<z.output<S>> };
}
