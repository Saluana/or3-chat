/**
 * GET /api/auth/session
 * Returns the current session context or null if not authenticated.
 */
import { defineEventHandler } from 'h3';
import { resolveSessionContext } from '../../auth/session';
import { isSsrAuthEnabled } from '../../utils/auth/is-ssr-auth-enabled';

export default defineEventHandler(async (event) => {
    // If SSR auth is disabled, always return null session
    if (!isSsrAuthEnabled(event)) {
        return { session: null };
    }

    const session = await resolveSessionContext(event);
    return {
        session: session.authenticated ? session : null,
    };
});
