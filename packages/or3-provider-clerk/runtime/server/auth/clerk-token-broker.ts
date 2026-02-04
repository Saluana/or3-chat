import type { H3Event } from 'h3';
import type { ProviderTokenBroker, ProviderTokenRequest } from '~~/server/auth/token-broker/types';

interface ClerkAuthContext {
    getToken: (options?: { template?: string }) => Promise<string | null>;
}

function isClerkAuthContext(value: unknown): value is ClerkAuthContext {
    return (
        typeof value === 'object' &&
        value !== null &&
        'getToken' in value &&
        typeof (value as Record<string, unknown>).getToken === 'function'
    );
}

export const clerkTokenBroker: ProviderTokenBroker = {
    async getProviderToken(event: H3Event, req: ProviderTokenRequest): Promise<string | null> {
        const authResult: unknown = event.context.auth?.();
        if (!authResult) {
            return null;
        }

        if (!isClerkAuthContext(authResult)) {
            console.error('[auth-token-broker] Invalid auth context: getToken missing');
            return null;
        }

        try {
            const token = await authResult.getToken({ template: req.template });
            if (!token || token.trim().length === 0) {
                return null;
            }
            return token;
        } catch (error) {
            console.error('[auth-token-broker] Failed to mint token:', {
                providerId: req.providerId,
                template: req.template,
                error: error instanceof Error ? error.message : String(error),
            });
            return null;
        }
    },
};
