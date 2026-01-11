/**
 * SSR auth enabled check.
 * Use this to gate SSR-only auth functionality.
 */
import type { H3Event } from 'h3';

/**
 * Check if SSR auth is enabled.
 * This is determined by the runtime config auth.enabled flag.
 *
 * @param _event - H3 event (optional, for future per-request overrides)
 * @returns true if SSR auth is enabled
 */
export function isSsrAuthEnabled(_event?: H3Event): boolean {
    const config = useRuntimeConfig();
    return config.auth?.enabled === true;
}
