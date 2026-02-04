import type { H3Event } from 'h3';

export interface ProviderTokenRequest {
    providerId: string;
    template?: string;
}

export interface ProviderTokenBroker {
    getProviderToken(
        event: H3Event,
        req: ProviderTokenRequest
    ): Promise<string | null>;
}
