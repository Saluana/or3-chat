import { z } from 'zod';

/**
 * Utility for parsing errors from $fetch and other sources
 * 
 * Replaces unsafe type casting with runtime validation using Zod.
 * 
 * @example
 * ```typescript
 * try {
 *   await $fetch('/api/endpoint');
 * } catch (error: unknown) {
 *   const message = parseErrorMessage(error, 'Operation failed');
 *   console.error(message);
 * }
 * ```
 */

const FetchErrorSchema = z.object({
    data: z.object({
        statusMessage: z.string().optional()
    }).optional()
});

const StandardErrorSchema = z.object({
    message: z.string()
});

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
 * Check if error message contains a specific substring (case-insensitive)
 */
export function errorContains(error: unknown, substring: string): boolean {
    const message = parseErrorMessage(error, '');
    return message.toLowerCase().includes(substring.toLowerCase());
}
