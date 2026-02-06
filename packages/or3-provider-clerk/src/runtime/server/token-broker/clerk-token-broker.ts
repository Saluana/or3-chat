/**
 * @module server/auth/token-broker/impls/clerk-token-broker.ts
 *
 * Purpose:
 * Clerk-based ProviderTokenBroker implementation. This is a TEMPORARY location.
 * This implementation will move to the or3-provider-clerk package in Phase 2.
 *
 * Notes:
 * - Does not import Clerk SDKs directly.
 * - Relies on `event.context.auth()` shape provided by @clerk/nuxt middleware.
 */
import type { H3Event } from 'h3';
import type {
    ProviderTokenBroker,
    ProviderTokenRequest,
} from '~~/server/auth/token-broker/types';

type ClerkAuthContext = {
    getToken: (options?: { template?: string }) => Promise<string | null>;
};

function isClerkAuthContext(value: unknown): value is ClerkAuthContext {
    return (
        typeof value === 'object' &&
        value !== null &&
        'getToken' in value &&
        typeof (value as Record<string, unknown>).getToken === 'function'
    );
}

/**
 * Clerk-backed ProviderTokenBroker implementation.
 */
export class ClerkTokenBroker implements ProviderTokenBroker {
    async getProviderToken(
        event: H3Event,
        req: ProviderTokenRequest
    ): Promise<string | null> {
        const authFactory = event.context.auth;
        if (typeof authFactory !== 'function') {
            return null;
        }
        const authResult: unknown = authFactory();
        if (!authResult) {
            return null;
        }

        if (!isClerkAuthContext(authResult)) {
            console.error('[token-broker:clerk] Invalid auth context shape');
            return null;
        }

        try {
            const token = await authResult.getToken({ template: req.template });
            if (!token || token.trim().length === 0) {
                console.warn('[token-broker:clerk] Empty token returned');
                return null;
            }
            return token;
        } catch (error) {
            console.error('[token-broker:clerk] Failed to mint provider token:', {
                template: req.template,
                providerId: req.providerId,
                error: error instanceof Error ? error.message : String(error),
            });
            return null;
        }
    }
}

export function createClerkTokenBroker(): ProviderTokenBroker {
    return new ClerkTokenBroker();
}
