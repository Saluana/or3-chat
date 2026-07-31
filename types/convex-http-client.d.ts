import type { UserIdentityAttributes } from 'convex/server';

declare module 'convex/browser' {
    interface ConvexHttpClient {
        setAdminAuth(
            token: string,
            actingAsIdentity?: UserIdentityAttributes
        ): void;
    }
}
