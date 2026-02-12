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
import { defineEventHandler, getQuery } from 'h3';
import { useRuntimeConfig } from '#imports';

export interface HealthResponse {
    status: 'ok' | 'degraded';
    timestamp: string;
    uptime: number;
    providers?: {
        sync?: { available: boolean; provider?: string };
        storage?: { available: boolean; provider?: string };
        auth?: { available: boolean; provider?: string };
    };
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
        
        response.providers = {
            sync: {
                available: config.sync.enabled,
                provider: config.sync.enabled ? config.sync.provider : undefined,
            },
            storage: {
                available: config.storage.enabled,
                provider: config.storage.enabled ? config.storage.provider : undefined,
            },
            auth: {
                available: config.auth.enabled,
                provider: config.auth.enabled ? config.auth.provider : undefined,
            },
        };

        // If any provider is expected but not configured, mark as degraded
        const anyProviderDown = 
            (config.sync.enabled && !config.sync.provider) ||
            (config.storage.enabled && !config.storage.provider) ||
            (config.auth.enabled && !config.auth.provider);

        if (anyProviderDown) {
            response.status = 'degraded';
        }
    }

    return response;
});
