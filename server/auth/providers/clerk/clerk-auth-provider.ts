/**
 * Clerk auth provider implementation.
 * Extracts session information from Clerk's auth context.
 */
import type { H3Event } from 'h3';
import type { AuthProvider, ProviderSession } from '../../types';

export const clerkAuthProvider: AuthProvider = {
    name: 'clerk',

    async getSession(event: H3Event): Promise<ProviderSession | null> {
        // Clerk middleware populates event.context.auth
        const auth = event.context.auth();
        if (!auth.userId) return null;

        return {
            provider: 'clerk',
            user: {
                id: auth.userId,
                // Email and displayName can be fetched via clerkClient().users.getUser()
                // if needed; keeping minimal for now
            },
            expiresAt: new Date(
                ((auth.sessionClaims.exp as number) || 0) * 1000 ||
                    Date.now() + 3600000
            ),
            claims: auth.sessionClaims as Record<string, unknown>,
        };
    },
};
