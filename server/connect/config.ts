import type { H3Event } from 'h3';
import { createError } from 'h3';
import { CloudflareTunnelProvisioner } from './cloudflare';

export interface ConnectServerConfig {
    enabled: boolean;
    publicURL: string;
    encryptionKey: string;
    maxComputers: number;
    cloudflare: {
        accountId: string;
        zoneId: string;
        apiToken: string;
        hostnameSuffix: string;
    };
}

export function getConnectServerConfig(event?: H3Event): ConnectServerConfig {
    const runtime = useRuntimeConfig(event) as {
        connect?: Partial<ConnectServerConfig> & {
            cloudflare?: Partial<ConnectServerConfig['cloudflare']>;
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
        maxComputers: Math.max(1, Math.floor(config.maxComputers ?? 3)),
        cloudflare: {
            accountId: config.cloudflare?.accountId?.trim() ?? '',
            zoneId: config.cloudflare?.zoneId?.trim() ?? '',
            apiToken: config.cloudflare?.apiToken?.trim() ?? '',
            hostnameSuffix:
                config.cloudflare?.hostnameSuffix?.trim() ?? '',
        },
    };
    if (
        !result.publicURL ||
        !result.encryptionKey ||
        !result.cloudflare.accountId ||
        !result.cloudflare.zoneId ||
        !result.cloudflare.apiToken ||
        !result.cloudflare.hostnameSuffix
    ) {
        throw createError({
            statusCode: 503,
            statusMessage: 'Remote connections are temporarily unavailable.',
        });
    }
    return result;
}

export function getTunnelProvisioner(
    config: ConnectServerConfig
): CloudflareTunnelProvisioner {
    return new CloudflareTunnelProvisioner(config.cloudflare);
}
