import { createError } from 'h3';
import { getStorageGatewayAdapter } from './registry';

export function getActiveStorageGatewayAdapterOrThrow() {
    const config = useRuntimeConfig();
    const providerId = config.storage.provider;
    if (!providerId) {
        throw createError({
            statusCode: 500,
            statusMessage: 'Storage provider not configured',
        });
    }
    const adapter = getStorageGatewayAdapter(providerId);
    if (!adapter) {
        throw createError({
            statusCode: 500,
            statusMessage: `Storage adapter not registered for ${providerId}`,
        });
    }
    return adapter;
}
