/**
 * @module app/db/util
 *
 * Purpose:
 * Shared utility helpers for DB-related logic.
 *
 * Responsibilities:
 * - Provide consistent schema parsing
 * - Generate timestamps, clocks, and ids
 *
 * Non-responsibilities:
 * - Business logic or persistence operations
 */
import type { ZodTypeAny, infer as ZodInfer } from 'zod';
import type { Or3DB } from './client';

/**
 * Purpose:
 * Parse data with a Zod schema and throw on validation failure.
 *
 * Behavior:
 * Returns the parsed value when validation succeeds, otherwise throws.
 *
 * Constraints:
 * - Throws generic errors with Zod messages.
 *
 * Non-Goals:
 * - Does not return partial validation results.
 */
export function parseOrThrow<TSchema extends ZodTypeAny>(
    schema: TSchema,
    data: unknown
): ZodInfer<TSchema> {
    const res = schema.safeParse(data);
    if (!res.success) throw new Error(res.error.message);
    return res.data as ZodInfer<TSchema>;
}

/**
 * Purpose:
 * Provide the current Unix timestamp in seconds.
 *
 * Behavior:
 * Rounds down the current time to seconds.
 *
 * Constraints:
 * - Uses the local clock.
 *
 * Non-Goals:
 * - Does not provide monotonic time guarantees.
 */
export const nowSec = (): number => Math.floor(Date.now() / 1000);

/**
 * Purpose:
 * Increment a record clock for last-write-wins resolution.
 *
 * Behavior:
 * Adds one to the provided clock, defaulting to zero.
 *
 * Constraints:
 * - Pure function with no side effects.
 *
 * Non-Goals:
 * - Does not handle HLC values.
 */
export const nextClock = (clock?: number): number => (clock ?? 0) + 1;

/**
 * Purpose:
 * Generate a unique identifier string.
 *
 * Behavior:
 * Uses Web Crypto UUID v4 when available and falls back to a timestamp-based id.
 *
 * Constraints:
 * - Fallback ids are not cryptographically secure.
 *
 * Non-Goals:
 * - Does not guarantee global uniqueness across devices.
 */
export function newId(): string {
    // Prefer Web Crypto if available
    if (
        typeof crypto !== 'undefined' &&
        typeof crypto.randomUUID === 'function'
    ) {
        return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

type WriteTxTableNamesOptions = {
    include?: string[];
    includePendingOps?: boolean;
    includeTombstones?: boolean;
};

/**
 * Build transaction table scopes that keep sync capture atomic when possible.
 * - Always includes primary table(s)
 * - Includes optional extra tables only when present in current DB schema
 * - Includes `pending_ops` by default when available
 * - Includes `tombstones` when explicitly requested and available
 */
export function getWriteTxTableNames(
    db: Pick<Or3DB, 'tables'> | { tables?: Array<{ name: string }> },
    primary: string | string[],
    options: WriteTxTableNamesOptions = {}
): string[] {
    const tableList = Array.isArray(db.tables) ? db.tables : [];
    const existing = new Set(tableList.map((table) => table.name));
    const names = new Set<string>(
        Array.isArray(primary) ? primary : [primary]
    );

    for (const tableName of options.include ?? []) {
        if (existing.has(tableName)) {
            names.add(tableName);
        }
    }

    if ((options.includePendingOps ?? true) && existing.has('pending_ops')) {
        names.add('pending_ops');
    }

    if (options.includeTombstones && existing.has('tombstones')) {
        names.add('tombstones');
    }

    return [...names];
}
