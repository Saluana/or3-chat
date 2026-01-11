/**
 * User identity queries for testing auth integration
 */
import { query } from './_generated/server';

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
