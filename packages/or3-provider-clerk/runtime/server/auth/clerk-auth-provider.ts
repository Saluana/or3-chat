import type { H3Event } from 'h3';
import type { AuthProvider, ProviderSession } from '~~/server/auth/types';
import { CLERK_PROVIDER_ID } from '~~/shared/cloud/provider-ids';
import { clerkClient } from '@clerk/nuxt/server';

interface ClerkAuthContext {
    userId: string | null;
    sessionClaims: { exp?: number; [key: string]: unknown };
}

export const clerkAuthProvider: AuthProvider = {
    name: CLERK_PROVIDER_ID,

    async getSession(event: H3Event): Promise<ProviderSession | null> {
        const authFn = event.context.auth as (() => unknown) | undefined;
        if (typeof authFn !== 'function') {
            if (import.meta.dev) {
                throw new Error('Clerk auth context missing. Ensure Clerk middleware is configured.');
            }
            return null;
        }

        const auth = authFn() as ClerkAuthContext;
        if (!auth.userId) {
            return null;
        }

        if (typeof auth.sessionClaims.exp !== 'number' || auth.sessionClaims.exp <= 0) {
            if (import.meta.dev) {
                throw new Error('Invalid or missing session expiry claim');
            }
            return null;
        }

        const clerkUser = await clerkClient(event).users.getUser(auth.userId);
        const primaryEmail = clerkUser.emailAddresses.find(
            (email) => email.id === clerkUser.primaryEmailAddressId
        );

        if (!primaryEmail?.emailAddress) {
            throw new Error('User has no verified primary email address');
        }

        return {
            provider: CLERK_PROVIDER_ID,
            user: {
                id: auth.userId,
                email: primaryEmail.emailAddress,
                displayName: clerkUser.firstName || clerkUser.username || primaryEmail.emailAddress,
            },
            expiresAt: new Date(auth.sessionClaims.exp * 1000),
            claims: auth.sessionClaims,
        };
    },
};
