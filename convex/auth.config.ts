/**
 * Convex Auth Configuration
 *
 * This configures Convex to accept JWT tokens from Clerk.
 * The domain should match your Clerk issuer URL.
 */

// Read Clerk issuer from environment variable with validation
const CLERK_ISSUER = process.env.CLERK_ISSUER_URL;

if (!CLERK_ISSUER || !CLERK_ISSUER.startsWith('https://')) {
    throw new Error(
        'CLERK_ISSUER_URL must be set to a valid HTTPS URL. ' +
        'Get this from your Clerk JWT template\'s Issuer field.'
    );
}

export default {
    providers: [
        {
            // The domain from your Clerk JWT template's Issuer field
            // (without the protocol)
            domain: CLERK_ISSUER,
            applicationID: 'convex',
        },
    ],
};
