import { createError } from 'h3';
import { getSyncGatewayAdapter } from './registry';

export function getActiveSyncGatewayAdapterOrThrow() {
    const config = useRuntimeConfig();
    const providerId = config.sync.provider;
    if (!providerId) {
        throw createError({
            statusCode: 500,
            statusMessage: 'Sync provider not configured',
        });
    }
    const adapter = getSyncGatewayAdapter(providerId);
    if (!adapter) {
        throw createError({
            statusCode: 500,
            statusMessage: `Sync adapter not registered for ${providerId}`,
        });
    }
    return adapter;
}
