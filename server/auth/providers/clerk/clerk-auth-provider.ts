/**
 * Clerk auth provider implementation.
 * Extracts session information from Clerk's auth context.
 */
import type { H3Event } from 'h3';
import type { AuthProvider, ProviderSession } from '../../types';
import { CLERK_PROVIDER_ID } from '~~/shared/cloud/provider-ids';
import { clerkClient } from '@clerk/nuxt/server';

interface ClerkAuthContext {
    userId: string | null;
    sessionClaims: { exp?: number; [key: string]: unknown };
}

export const clerkAuthProvider: AuthProvider = {
    name: CLERK_PROVIDER_ID,

    async getSession(event: H3Event): Promise<ProviderSession | null> {
        // Clerk middleware populates event.context.auth as a function
        // Get auth context by calling it directly
        const auth = event.context.auth() as ClerkAuthContext;
        if (!auth.userId) {
            return null;
        }

        // Fetch full user details from Clerk
        const clerkUser = await clerkClient(event).users.getUser(auth.userId);
        const primaryEmail = clerkUser.emailAddresses.find(
            (email) => email.id === clerkUser.primaryEmailAddressId
        );

        return {
            provider: CLERK_PROVIDER_ID,
            user: {
                id: auth.userId,
                email: primaryEmail?.emailAddress ?? '',
                displayName: clerkUser.firstName || clerkUser.username || '',
            },
            expiresAt: new Date(
                ((auth.sessionClaims.exp) || 0) * 1000 ||
                    Date.now() + 3600000
            ),
            claims: auth.sessionClaims,
        };
    },
};
