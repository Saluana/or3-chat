/**
 * User identity queries for testing auth integration
 */
import { query } from './_generated/server';
import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';

/**
 * Get auth account by provider and provider user ID.
 * Returns the internal user ID if found.
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
 * Get the current authenticated user's identity.
 * Returns null if not authenticated, or the user's Clerk identity if logged in.
 *
 * Usage in Vue:
 *   const identity = useQuery(api.users.me);
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
