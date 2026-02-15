/**
 * @module app/core/notifications/notification-user
 *
 * Purpose:
 * Resolves the user ID used for scoping notifications. In authenticated
 * cloud sessions the real user ID is used; in local-only mode a
 * deterministic fallback is applied so notifications still work.
 *
 * Constraints:
 * - Fallback ID is constant (`'local-user'`) so all local notifications
 *   share one namespace regardless of browser profile.
 *
 * @see core/hooks/hook-types.ts for SessionContext shape
 */
import type { SessionContext } from '~/core/hooks/hook-types';

/**
 * Purpose:
 * Deterministic user ID used when the app is not authenticated.
 * Keeps notifications functional in local-only mode.
 */
export const FALLBACK_NOTIFICATION_USER_ID = 'local-user';

/**
 * Purpose:
 * Resolve the user ID used to scope notifications.
 *
 * Behavior:
 * - Uses the authenticated session user ID when available
 * - Falls back to `FALLBACK_NOTIFICATION_USER_ID` in local-only mode
 */
export function resolveNotificationUserId(
    session?: SessionContext | null
): string {
    if (session?.authenticated && session.user?.id) {
        return session.user.id;
    }
    return FALLBACK_NOTIFICATION_USER_ID;
}
