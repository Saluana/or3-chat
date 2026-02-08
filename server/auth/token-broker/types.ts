/**
 * @module server/auth/token-broker/types.ts
 *
 * Purpose:
 * Defines the interface for minting provider-specific tokens. This decouples
 * gateway authentication from specific auth provider implementations (Clerk, etc.).
 *
 * Use Case:
 * When a server adapter needs to authenticate with a backend provider (e.g., Convex),
 * it requests a provider token through this interface rather than directly importing
 * Clerk or other auth SDKs.
 *
 * Example Flow:
 * 1. Sync endpoint receives authenticated request
 * 2. Endpoint needs to call Convex backend with user credentials
 * 3. Endpoint requests a "convex" template token via ProviderTokenBroker
 * 4. Broker (Clerk implementation) mints the appropriate JWT
 * 5. Endpoint uses the token to authenticate with Convex
 */
import type { H3Event } from 'h3';

/**
 * Purpose:
 * Request structure for provider token minting.
 *
 * Fields:
 * - `providerId`: Target provider identifier (e.g., 'convex', 'supabase')
 * - `template`: Optional template name for provider-specific token claims
 */
export interface ProviderTokenRequest {
    providerId: string;
    template?: string;
}

/**
 * Purpose:
 * Interface for minting provider-specific authentication tokens.
 *
 * Responsibilities:
 * - Generate JWT or similar tokens for backend provider authentication
 * - Handle provider-specific token templates and claims
 * - Respect token expiration and security constraints
 *
 * Constraints:
 * - Must only mint tokens for authenticated requests
 * - Should use short-lived tokens when possible
 * - Must not expose implementation details to callers
 */
export interface ProviderTokenBroker {
    /**
     * Purpose:
     * Mints a provider-specific token for the authenticated user.
     *
     * Behavior:
     * - Extracts user identity from the H3Event context
     * - Generates a token appropriate for the target provider
     * - Returns null if user is not authenticated or token cannot be minted
     *
     * @param event - The Nitro request event (contains auth context)
     * @param req - Token request specifying provider and optional template
     * @returns A signed token string, or null if unavailable
     *
     * @example
     * ```ts
     * const broker = getProviderTokenBroker('clerk');
     * const token = await broker.getProviderToken(event, {
     *   providerId: 'convex',
     *   template: 'convex'
     * });
     * if (token) {
     *   convexClient.setAdminAuth(token);
     * }
     * ```
     */
    getProviderToken(
        event: H3Event,
        req: ProviderTokenRequest
    ): Promise<string | null>;
}
