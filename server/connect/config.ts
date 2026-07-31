import type { H3Event } from 'h3';
import { createError } from 'h3';

export interface ConnectServerConfig {
    enabled: boolean;
    publicURL: string;
    encryptionKey: string;
    maxComputers: number;
    provider: string;
}

export function parseConnectMaxComputers(value: unknown): number {
    const normalized =
        typeof value === 'string' ? value.trim() : value;
    if (normalized === '') {
        throw new Error('OR3_CONNECT_MAX_COMPUTERS must be an integer between 1 and 100.');
    }
    const parsed =
        typeof normalized === 'number' ? normalized : Number(normalized);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100) {
        throw new Error('OR3_CONNECT_MAX_COMPUTERS must be an integer between 1 and 100.');
    }
    return parsed;
}

export function getConnectServerConfig(event?: H3Event): ConnectServerConfig {
    const runtime = useRuntimeConfig(event) as {
        connect?: Omit<Partial<ConnectServerConfig>, 'maxComputers'> & {
            maxComputers?: unknown;
        };
    };
    const config = runtime.connect;
    if (config?.enabled !== true) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }
    const result: ConnectServerConfig = {
        enabled: true,
        publicURL: config.publicURL?.trim() ?? '',
        encryptionKey: config.encryptionKey?.trim() ?? '',
        maxComputers: parseConnectMaxComputers(config.maxComputers ?? 3),
        provider:
            typeof config.provider === 'string'
                ? config.provider.trim()
                : '',
    };
    if (!result.publicURL || !result.encryptionKey) {
        throw createError({
            statusCode: 503,
            statusMessage: 'Remote connections are temporarily unavailable.',
        });
    }
    return result;
}
