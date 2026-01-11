/**
 * Convex Auth Configuration
 *
 * This configures Convex to accept JWT tokens from Clerk.
 * The domain should match your Clerk issuer URL.
 */
export default {
    providers: [
        {
            // The domain from your Clerk JWT template's Issuer field
            // (without the protocol)
            domain: 'https://ace-parakeet-7.clerk.accounts.dev',
            applicationID: 'convex',
        },
    ],
};
