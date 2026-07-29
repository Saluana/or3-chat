import type { H3Event } from 'h3';
import { createError } from 'h3';

export interface ConnectServerConfig {
    enabled: boolean;
    publicURL: string;
    encryptionKey: string;
    maxComputers: number;
}

export function getConnectServerConfig(event?: H3Event): ConnectServerConfig {
    const runtime = useRuntimeConfig(event) as {
        connect?: Partial<ConnectServerConfig>;
    };
    const config = runtime.connect;
    if (config?.enabled !== true) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }
    const result: ConnectServerConfig = {
        enabled: true,
        publicURL: config.publicURL?.trim() ?? '',
        encryptionKey: config.encryptionKey?.trim() ?? '',
        maxComputers: Math.max(1, Math.floor(config.maxComputers ?? 3)),
    };
    if (!result.publicURL || !result.encryptionKey) {
        throw createError({
            statusCode: 503,
            statusMessage: 'Remote connections are temporarily unavailable.',
        });
    }
    return result;
}
