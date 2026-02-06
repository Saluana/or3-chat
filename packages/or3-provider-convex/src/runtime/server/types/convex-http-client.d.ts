import type { UserIdentityAttributes } from 'convex/server';

declare module 'convex/browser' {
    interface ConvexHttpClient {
        /**
         * Set admin auth token to allow calling internal queries, mutations, and actions
         * and acting as an identity.
         *
         * This method exists at runtime but is not exposed in Convex's public .d.ts.
         */
        setAdminAuth(
            token: string,
            actingAsIdentity?: UserIdentityAttributes
        ): void;
    }
}

