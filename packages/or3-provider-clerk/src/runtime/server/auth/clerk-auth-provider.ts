/**
 * @module server/auth/providers/clerk/clerk-auth-provider.ts
 *
 * Purpose:
 * Clerk-specific implementation of the SSR `AuthProvider`. This module bridges
 * Clerk's session management into the OR3 internal session model.
 *
 * Behavior:
 * 1. Retrieves the session context from the request (populated by Clerk's Nitro middleware).
 * 2. Validates the JWT expiration claim.
 * 3. Enriches the session by fetching full user details (email, name) via Clerk's Backend SDK.
 * 4. Normalizes the data into a standard `ProviderSession`.
 *
 * Constraints:
 * - Depends on correctly configured Clerk public/secret keys.
 * - Requires Clerk's SSR middleware to be active in the Nitro pipeline.
 * - Throws in development if Clerk context is missing to aid debugging.
 */
import type { H3Event } from 'h3';
import type { AuthProvider, ProviderSession } from '~~/server/auth/types';
import { CLERK_PROVIDER_ID } from '~~/shared/cloud/provider-ids';
import { clerkClient } from '@clerk/nuxt/server';

/**
 * Purpose:
 * Internal interface representing the structure of Clerk's auth context
 * as exposed by the `@clerk/nuxt` server integration.
 */
interface ClerkAuthContext {
    userId: string | null;
    sessionClaims: { exp?: number; [key: string]: unknown };
}

/**
 * Purpose:
 * Singleton implementation of the Clerk auth provider.
 */
export const clerkAuthProvider: AuthProvider = {
    name: CLERK_PROVIDER_ID,

    /**
     * Purpose:
     * Resolves a session from Clerk's server-side context.
     *
     * Behavior:
     * - Calls the lazy `auth()` function provided by Clerk's middleware.
     * - Fetches full user profile details to populate identity fields.
     *
     * @param event - The Nitro request event.
     * @returns Normalized provider session or `null` if unauthenticated.
     */
    async getSession(event: H3Event): Promise<ProviderSession | null> {
        // Clerk middleware populates event.context.auth as a function
        const authFn = event.context.auth as (() => unknown) | undefined;
        if (typeof authFn !== 'function') {
            if (import.meta.dev) {
                throw new Error('Clerk auth context missing. Ensure Clerk middleware is configured.');
            }
            return null;
        }

        // Get auth context by calling it directly
        const auth = authFn() as ClerkAuthContext;
        if (!auth.userId) {
            return null;
        }

        // Validate session expiry claim
        if (typeof auth.sessionClaims.exp !== 'number' || auth.sessionClaims.exp <= 0) {
            if (import.meta.dev) {
                throw new Error('Invalid or missing session expiry claim');
            }
            return null;
        }

        // Fetch full user details from Clerk
        const clerkUser = await clerkClient(event).users.getUser(auth.userId);
        const primaryEmail = clerkUser.emailAddresses.find(
            (email) => email.id === clerkUser.primaryEmailAddressId
        );

        // Require valid primary email
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
