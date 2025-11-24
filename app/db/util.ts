import type { ZodTypeAny, infer as ZodInfer } from 'zod';

/**
 * Parse data with Zod schema, throwing on validation failure.
 * @returns Validated data matching schema type
 */
export function parseOrThrow<TSchema extends ZodTypeAny>(
    schema: TSchema,
    data: unknown
): ZodInfer<TSchema> {
    const res = schema.safeParse(data);
    if (!res.success) throw new Error(res.error.message);
    return res.data as ZodInfer<TSchema>;
}

/** Returns current Unix timestamp in seconds */
export const nowSec = (): number => Math.floor(Date.now() / 1000);

/**
 * Generate a unique identifier string.
 * Prefers Web Crypto API (UUID v4) when available, falls back to timestamp-based ID.
 */
export function newId(): string {
    // Prefer Web Crypto if available
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}
