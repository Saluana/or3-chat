import { describe, it, expect, vi } from 'vitest';

// Mock defineNuxtConfig to avoid Nuxt runtime dependency
vi.mock('#app', () => ({
    defineNuxtConfig: (config: Record<string, unknown>) => config,
}));

// Import after mocking
const defineNuxtConfig = (config: Record<string, unknown>) => config;
(globalThis as Record<string, unknown>).defineNuxtConfig = defineNuxtConfig;

describe('Nuxt config cache headers', () => {
    it('should set immutable cache for /_nuxt/** assets', async () => {
        const { default: nuxtConfig } = await import('../../nuxt.config');
        const routeRules = nuxtConfig.nitro?.routeRules;
        expect(routeRules).toBeDefined();
        expect(routeRules?.['/_nuxt/**']?.headers?.['cache-control']).toBe(
            'public,max-age=31536000,immutable'
        );
    });

    it('should set immutable cache for /_fonts/** assets', async () => {
        const { default: nuxtConfig } = await import('../../nuxt.config');
        const routeRules = nuxtConfig.nitro?.routeRules;
        expect(routeRules).toBeDefined();
        expect(routeRules?.['/_fonts/**']?.headers?.['cache-control']).toBe(
            'public,max-age=31536000,immutable'
        );
    });

    it('should set long cache with stale-while-revalidate for static images', async () => {
        const { default: nuxtConfig } = await import('../../nuxt.config');
        const routeRules = nuxtConfig.nitro?.routeRules;
        expect(routeRules).toBeDefined();

        const expectedCacheControl =
            'public,max-age=604800,stale-while-revalidate=86400';

        expect(routeRules?.['/**/*.webp']?.headers?.['cache-control']).toBe(
            expectedCacheControl
        );
        expect(routeRules?.['/**/*.png']?.headers?.['cache-control']).toBe(
            expectedCacheControl
        );
        expect(routeRules?.['/**/*.svg']?.headers?.['cache-control']).toBe(
            expectedCacheControl
        );
        expect(routeRules?.['/**/*.woff2']?.headers?.['cache-control']).toBe(
            expectedCacheControl
        );
    });
});
