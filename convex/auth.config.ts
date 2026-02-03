/**
 * @module convex/auth.config
 *
 * Purpose:
 * Configures Convex authentication to accept JWTs issued by Clerk.
 *
 * Behavior:
 * - Reads `CLERK_ISSUER_URL` from the environment at module load time
 * - Fails fast if the issuer is missing or not HTTPS
 *
 * Constraints:
 * - This file is evaluated in the Convex runtime. Environment variables must be
 *   configured in the Convex deployment.
 * - `CLERK_ISSUER_URL` must match the Issuer configured in the Clerk JWT
 *   template used by OR3 Cloud.
 *
 * Non-Goals:
 * - Supporting multiple auth providers simultaneously.
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
            // Issuer URL from your Clerk JWT template (must be HTTPS).
            domain: CLERK_ISSUER,
            applicationID: 'convex',
        },
    ],
};
