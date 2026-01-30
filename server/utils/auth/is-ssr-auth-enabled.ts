/**
 * SSR auth enabled check.
 * Use this to gate SSR-only auth functionality.
 */
import type { H3Event } from 'h3';
import { useRuntimeConfig } from '#imports';

/**
 * Check if SSR auth is enabled.
 * This is determined by the runtime config auth.enabled flag.
 *
 * @param _event - H3 event (optional, for future per-request overrides)
 * @returns true if SSR auth is enabled
 */
export function isSsrAuthEnabled(_event?: H3Event): boolean {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
    const config = (useRuntimeConfig() || {}) as any;
    return config.auth?.enabled === true;
}
