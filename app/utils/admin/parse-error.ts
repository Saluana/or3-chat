/**
 * @module app/utils/admin/parse-error
 *
 * Purpose:
 * Extracts human-readable error messages from `$fetch` or unknown errors
 * using runtime validation.
 *
 * Behavior:
 * - Tries Nuxt/H3 fetch error shape first
 * - Falls back to standard Error-like objects
 * - Uses a caller-provided fallback message
 */

import { z } from 'zod';

const FetchErrorSchema = z.object({
    data: z.object({
        statusMessage: z.string().optional()
    }).optional()
});

const StandardErrorSchema = z.object({
    message: z.string()
});

/**
 * `parseErrorMessage`
 *
 * Purpose:
 * Returns the most useful message available from an unknown error.
 */
export function parseErrorMessage(error: unknown, fallback = 'An error occurred'): string {
    // Try parsing as fetch error (Nuxt/H3 format)
    const fetchError = FetchErrorSchema.safeParse(error);
    if (fetchError.success && fetchError.data.data?.statusMessage) {
        return fetchError.data.data.statusMessage;
    }
    
    // Try parsing as standard Error object
    const stdError = StandardErrorSchema.safeParse(error);
    if (stdError.success) {
        return stdError.data.message;
    }
    
    // Fallback
    return fallback;
}

/**
 * `errorContains`
 *
 * Purpose:
 * Checks if the parsed error message includes a substring (case-insensitive).
 */
export function errorContains(error: unknown, substring: string): boolean {
    const message = parseErrorMessage(error, '');
    return message.toLowerCase().includes(substring.toLowerCase());
}
