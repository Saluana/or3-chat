/**
 * @module server/auth/token-broker/resolve.ts
 *
 * Purpose:
 * Resolve provider tokens via the configured ProviderTokenBroker.
 */
import type { H3Event } from 'h3';
import { useRuntimeConfig } from '#imports';
import { CLERK_PROVIDER_ID } from '~~/shared/cloud/provider-ids';
import type { ProviderTokenRequest } from './types';
import { getProviderTokenBroker } from './registry';

export async function resolveProviderToken(
    event: H3Event,
    request: ProviderTokenRequest
): Promise<string | null> {
    const config = useRuntimeConfig(event);
    const brokerId = config.auth?.provider ?? CLERK_PROVIDER_ID;
    const broker = getProviderTokenBroker(brokerId);
    if (!broker) {
        return null;
    }
    return broker.getProviderToken(event, request);
}
