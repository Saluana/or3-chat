/**
 * @module server/api/health.get
 *
 * Purpose:
 * Health check endpoint for load balancers and orchestrators.
 *
 * Responsibilities:
 * - Returns basic liveness status (always 200 if process is alive).
 * - Optional deep mode checks provider connectivity.
 * - No authentication required.
 */
import { defineEventHandler, getQuery, type H3Event } from 'h3';
import { useRuntimeConfig } from '#imports';
import { getActiveSecretStore } from '../secrets/registry';
import { getProviderAdminAdapter } from '../admin/providers/registry';
import { createStubProviderAdapter } from '../admin/providers/adapters/stub';

export interface HealthResponse {
    status: 'ok' | 'degraded';
    timestamp: string;
    uptime: number;
    providers?: {
        secrets?: { available: boolean };
        sync?: {
            available: boolean;
            provider?: string;
            checks?: { warnings: string[]; errors: string[] };
            details?: Record<string, unknown>;
        };
        storage?: {
            available: boolean;
            provider?: string;
            checks?: { warnings: string[]; errors: string[] };
            details?: Record<string, unknown>;
        };
        auth?: {
            available: boolean;
            provider?: string;
            checks?: { warnings: string[]; errors: string[] };
            details?: Record<string, unknown>;
        };
    };
}

type DeepProviderStatus = {
    available: boolean;
    provider?: string;
    checks?: { warnings: string[]; errors: string[] };
    details?: Record<string, unknown>;
};

async function resolveDeepProviderStatus(
    event: H3Event,
    kind: 'auth' | 'sync' | 'storage',
    enabled: boolean,
    provider: string
): Promise<DeepProviderStatus> {
    if (!enabled) {
        return { available: true };
    }

    const adapter =
        getProviderAdminAdapter(kind, provider) ??
        createStubProviderAdapter(kind, provider);

    let timer: ReturnType<typeof setTimeout>;
    try {
        const status = await Promise.race([
            adapter.getStatus(event, { enabled, provider }),
            new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('provider_probe_timeout')), 1_500); }),
        ]);
        const warnings = status.warnings
            .filter((warning) => warning.level === 'warning')
            .map(() => 'PROVIDER_WARNING');
        const errors = status.warnings
            .filter((warning) => warning.level === 'error')
            .map(() => 'PROVIDER_UNAVAILABLE');

        return {
            available: errors.length === 0,
            provider,
            checks: {
                warnings,
                errors,
            },
            details: {},
        };
    } catch {
        return {
            available: false,
            provider,
            checks: {
                warnings: [],
                errors: ['PROVIDER_STATUS_FAILED'],
            },
            details: {},
        };
    } finally { clearTimeout(timer!); }
}

/**
 * GET /api/health
 *
 * Purpose:
 * Liveness probe for deployment orchestrators.
 *
 * Behavior:
 * - Always returns 200 when process is alive.
 * - Query param `?deep=true` enables provider connectivity checks.
 *
 * Security:
 * - No authentication required (health checks must work before auth).
 * - Does not leak sensitive configuration details.
 */
export default defineEventHandler(async (event): Promise<HealthResponse> => {
    const query = getQuery(event);
    const deep = query.deep === 'true' || (event.path || event.node.req.url || '').split('?')[0] === '/api/ready';

    const response: HealthResponse = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
    };

    if (deep) {
        // Deep mode: check provider availability
        const config = useRuntimeConfig(event);

        const [sync, storage, auth] = await Promise.all([
            resolveDeepProviderStatus(
                event,
                'sync',
                Boolean(config.sync.enabled),
                String(config.sync.provider || '')
            ),
            resolveDeepProviderStatus(
                event,
                'storage',
                Boolean(config.storage.enabled),
                String(config.storage.provider || '')
            ),
            resolveDeepProviderStatus(
                event,
                'auth',
                Boolean(config.auth.enabled),
                String(config.auth.provider || '')
            ),
        ]);

        let secrets: { available: boolean } | undefined;
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Partial runtime configs can omit secrets.
        if (config.secrets?.provider) {
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
                const store = getActiveSecretStore();
                if (!store) throw new Error('Unavailable');
                await Promise.race([store.available(), new Promise<never>((_, reject) => {
                    timer = setTimeout(() => reject(new Error('Unavailable')), 1500);
                })]);
                secrets = { available: true };
            } catch { secrets = { available: false }; }
            finally { clearTimeout(timer); }
        }
        response.providers = { sync, storage, auth, ...(secrets ? { secrets } : {}) };

        // If any provider is expected but not configured, mark as degraded
        const anyProviderDown = 
            (config.sync.enabled && !sync.available) ||
            (config.storage.enabled && !storage.available) ||
            (config.auth.enabled && !auth.available) || secrets?.available === false;

        if (anyProviderDown) {
            response.status = 'degraded';
        }
    }

    return response;
});
