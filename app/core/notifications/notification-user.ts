import type { SessionContext } from '~/core/hooks/hook-types';

export const FALLBACK_NOTIFICATION_USER_ID = 'local-user';

export function resolveNotificationUserId(
    session?: SessionContext | null
): string {
    if (session?.authenticated && session.user?.id) {
        return session.user.id;
    }
    return FALLBACK_NOTIFICATION_USER_ID;
}
