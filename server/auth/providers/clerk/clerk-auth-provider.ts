/**
 * Clerk auth provider implementation.
 * Extracts session information from Clerk's auth context.
 */
import type { H3Event } from 'h3';
import type { AuthProvider, ProviderSession } from '../../types';
import { CLERK_PROVIDER_ID } from '~~/shared/cloud/provider-ids';

interface ClerkAuthContext {
    userId: string | null;
    sessionClaims: { exp?: number; [key: string]: unknown };
}

export const clerkAuthProvider: AuthProvider = {
    name: CLERK_PROVIDER_ID,

    async getSession(event: H3Event): Promise<ProviderSession | null> {
        // Clerk middleware populates event.context.auth
        const auth = event.context.auth() as ClerkAuthContext;
        if (!auth.userId) return null;

        return {
            provider: CLERK_PROVIDER_ID,
            user: {
                id: auth.userId,
                // Email and displayName can be fetched via clerkClient().users.getUser()
                // if needed; keeping minimal for now
            },
            expiresAt: new Date(
                ((auth.sessionClaims.exp) || 0) * 1000 ||
                    Date.now() + 3600000
            ),
            claims: auth.sessionClaims,
        };
    },
};
