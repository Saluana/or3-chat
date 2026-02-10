import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockH3Event } from '../../../tests/utils/mock-h3';

describe('Health check endpoint', () => {
    let handler: any;

    beforeEach(async () => {
        vi.resetModules();
        
        // Mock runtime config
        vi.mock('#imports', () => ({
            useRuntimeConfig: () => ({
                sync: { enabled: true, provider: 'convex' },
                storage: { enabled: true, provider: 'convex' },
                auth: { enabled: true, provider: 'clerk' },
            }),
        }));

        const module = await import('../health.get');
        handler = module.default;
    });

    it('returns basic health status', async () => {
        const event = createMockH3Event({
            method: 'GET',
            path: '/api/health',
        });

        const response = await handler(event);

        expect(response.status).toBe('ok');
        expect(response.timestamp).toBeDefined();
        expect(typeof response.uptime).toBe('number');
        expect(response.providers).toBeUndefined();
    });

    it('includes provider status when deep=true', async () => {
        const event = createMockH3Event({
            method: 'GET',
            path: '/api/health?deep=true',
            query: { deep: 'true' },
        });

        const response = await handler(event);

        expect(response.status).toBe('ok');
        expect(response.providers).toBeDefined();
        expect(response.providers?.sync).toEqual({
            available: true,
            provider: 'convex',
        });
        expect(response.providers?.storage).toEqual({
            available: true,
            provider: 'convex',
        });
        expect(response.providers?.auth).toEqual({
            available: true,
            provider: 'clerk',
        });
    });

    it('marks as degraded when provider is enabled but not configured', async () => {
        vi.resetModules();
        
        vi.mock('#imports', () => ({
            useRuntimeConfig: () => ({
                sync: { enabled: true, provider: '' },
                storage: { enabled: false, provider: '' },
                auth: { enabled: true, provider: 'clerk' },
            }),
        }));

        const module = await import('../health.get');
        const degradedHandler = module.default;

        const event = createMockH3Event({
            method: 'GET',
            path: '/api/health?deep=true',
            query: { deep: 'true' },
        });

        const response = await degradedHandler(event);

        expect(response.status).toBe('degraded');
    });
});
