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
import { getProviderAdminAdapter } from '../admin/providers/registry';
import { createStubProviderAdapter } from '../admin/providers/adapters/stub';

export interface HealthResponse {
    status: 'ok' | 'degraded';
    timestamp: string;
    uptime: number;
    providers?: {
        sync?: {
            available: boolean;
            provider?: string;
            checks?: { warnings: string[]; errors: string[] };
        };
        storage?: {
            available: boolean;
            provider?: string;
            checks?: { warnings: string[]; errors: string[] };
        };
        auth?: {
            available: boolean;
            provider?: string;
            checks?: { warnings: string[]; errors: string[] };
        };
    };
}

type DeepProviderStatus = {
    available: boolean;
    provider?: string;
    checks?: { warnings: string[]; errors: string[] };
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

    try {
        const status = await adapter.getStatus(event, { enabled, provider });
        const warnings = status.warnings
            .filter((warning) => warning.level === 'warning')
            .map((warning) => warning.message);
        const errors = status.warnings
            .filter((warning) => warning.level === 'error')
            .map((warning) => warning.message);

        return {
            available: errors.length === 0,
            provider,
            checks: {
                warnings,
                errors,
            },
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            available: false,
            provider,
            checks: {
                warnings: [],
                errors: [message],
            },
        };
    }
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
    const deep = query.deep === 'true';

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

        response.providers = { sync, storage, auth };

        // If any provider is expected but not configured, mark as degraded
        const anyProviderDown = 
            (config.sync.enabled && !sync.available) ||
            (config.storage.enabled && !storage.available) ||
            (config.auth.enabled && !auth.available);

        if (anyProviderDown) {
            response.status = 'degraded';
        }
    }

    return response;
});
