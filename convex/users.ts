/**
 * @module convex/users
 *
 * Purpose:
 * Small identity and account lookup utilities used by the client and test
 * harness to validate auth integration.
 *
 * Behavior:
 * - `me` returns the caller's auth identity (or `null`)
 * - `getAuthAccountByProvider` returns the internal user mapping for a provider
 *
 * Constraints:
 * - Convex identity claims come from the configured auth provider (Clerk by
 *   default in OR3 Cloud).
 *
 * Non-Goals:
 * - Full user profile APIs.
 * - Workspace authorization checks (handled in workspace/sync modules).
 */
import { query } from './_generated/server';
import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';

/**
 * `users.getAuthAccountByProvider` (query)
 *
 * Purpose:
 * Looks up an auth account mapping by `(provider, provider_user_id)`.
 *
 * Authorization:
 * This query does not validate the caller's identity and should be treated as
 * an internal/testing surface. Do not expose it to untrusted clients.
 *
 * Behavior:
 * - Returns `null` when no mapping exists
 * - Returns the internal `user_id` (Convex Id<'users'>) when found
 */
export const getAuthAccountByProvider = query({
    args: {
        provider: v.string(),
        provider_user_id: v.string(),
    },
    handler: async (ctx, args) => {
        const authAccount = await ctx.db
            .query('auth_accounts')
            .withIndex('by_provider', (q) =>
                q.eq('provider', args.provider).eq('provider_user_id', args.provider_user_id)
            )
            .first();

        if (!authAccount) {
            return null;
        }

        return {
            user_id: authAccount.user_id as Id<'users'>,
            provider: authAccount.provider,
            provider_user_id: authAccount.provider_user_id,
        };
    },
});

/**
 * `users.getAuthAccountByUserId` (query)
 *
 * Purpose:
 * Looks up the provider mapping for an internal user id.
 *
 * Authorization:
 * Internal/testing surface. Do not expose to untrusted clients.
 */
export const getAuthAccountByUserId = query({
    args: {
        provider: v.string(),
        user_id: v.id('users'),
    },
    handler: async (ctx, args) => {
        const authAccount = await ctx.db
            .query('auth_accounts')
            .withIndex('by_user_provider', (q) =>
                q.eq('user_id', args.user_id).eq('provider', args.provider)
            )
            .first();
        if (!authAccount) {
            return null;
        }

        return {
            user_id: authAccount.user_id as Id<'users'>,
            provider: authAccount.provider,
            provider_user_id: authAccount.provider_user_id,
        };
    },
});

/**
 * `users.me` (query)
 *
 * Purpose:
 * Returns the current caller's auth identity as provided by Convex auth.
 *
 * Behavior:
 * - Returns `null` when the caller is not authenticated
 * - Returns a subset of identity fields useful for UI/session wiring
 *
 * @example
 * ```ts
 * const identity = useQuery(api.users.me);
 * if (identity) {
 *   console.log('Signed in as', identity.email);
 * }
 * ```
 */
export const me = query({
    args: {},
    handler: async (ctx) => {
        const identity = await ctx.auth.getUserIdentity();

        if (!identity) {
            return null;
        }

        // Return relevant user info from Clerk JWT claims
        return {
            // Clerk's subject ID (user ID)
            tokenIdentifier: identity.tokenIdentifier,
            // User's email
            email: identity.email,
            // User's display name
            name: identity.name,
            // Profile picture URL
            pictureUrl: identity.pictureUrl,
            // Email verification status
            emailVerified: identity.emailVerified,
        };
    },
});
