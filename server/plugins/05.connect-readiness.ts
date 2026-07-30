import { useRuntimeConfig } from '#imports';
import { defineNitroPlugin } from 'nitropack/runtime';
import {
    resolveConnectCloudflareReadiness,
    type ConnectCloudflareReadiness,
} from '../../shared/cloud/wizard/cloudflare-attestation';

interface ConnectReadinessRuntimeConfig {
    readonly connect?: {
        readonly enabled?: boolean;
        readonly requestedEnabled?: boolean;
        readonly relayProvider?: string;
        readonly cloudflareValidationAttestation?: string;
        readonly cloudflare?: {
            readonly accountId?: string;
            readonly zoneId?: string;
            readonly apiToken?: string;
            readonly hostnameSuffix?: string;
        };
    };
}

function envValue(
    env: NodeJS.ProcessEnv,
    key: string,
    fallback: string | undefined
): string {
    return env[key] ?? fallback ?? '';
}

export function applyConnectStartupReadiness(
    runtime: ConnectReadinessRuntimeConfig,
    options: {
        strict?: boolean;
        now?: number;
        env?: NodeJS.ProcessEnv;
    } = {}
): ConnectCloudflareReadiness {
    const env = options.env ?? process.env;
    const connect = runtime.connect;
    const requestedEnabled =
        connect?.requestedEnabled ?? connect?.enabled === true;
    const cloudflare = connect?.cloudflare;
    const readiness = resolveConnectCloudflareReadiness({
        requestedEnabled,
        strict:
            options.strict ??
            (env.NODE_ENV === 'production' ||
                env.OR3_STRICT_CONFIG === 'true'),
        relayProvider: connect?.relayProvider ?? '',
        attestation: envValue(
            env,
            'OR3_CONNECT_CLOUDFLARE_VALIDATION_ATTESTATION',
            connect?.cloudflareValidationAttestation
        ),
        config: {
            accountId: envValue(
                env,
                'OR3_CONNECT_CLOUDFLARE_ACCOUNT_ID',
                cloudflare?.accountId
            ),
            zoneId: envValue(
                env,
                'OR3_CONNECT_CLOUDFLARE_ZONE_ID',
                cloudflare?.zoneId
            ),
            apiToken: envValue(
                env,
                'OR3_CONNECT_CLOUDFLARE_API_TOKEN',
                cloudflare?.apiToken
            ),
            hostnameSuffix: envValue(
                env,
                'OR3_CONNECT_HOSTNAME_SUFFIX',
                cloudflare?.hostnameSuffix
            ),
        },
        now: options.now,
    });

    return readiness;
}

export default defineNitroPlugin(() => {
    const readiness = applyConnectStartupReadiness(
        useRuntimeConfig() as ConnectReadinessRuntimeConfig
    );
    if (readiness.status === 'degraded') {
        console.warn(
            `[or3-connect] ${readiness.message} OR3 Chat remains available, but remote Connect is disabled.`
        );
    } else if (readiness.status === 'unverified' && readiness.message) {
        console.warn(`[or3-connect] ${readiness.message}`);
    }
});
