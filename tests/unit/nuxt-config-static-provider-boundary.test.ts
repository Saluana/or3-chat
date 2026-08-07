// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fsObservations = vi.hoisted(() => ({
    generatedProviderReads: 0,
    providerPackageChecks: [] as string[],
}));

vi.mock('node:fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:fs')>();
    return {
        ...actual,
        existsSync(path: Parameters<typeof actual.existsSync>[0]) {
            const value = String(path);
            if (value.includes('/node_modules/or3-provider-')) {
                fsObservations.providerPackageChecks.push(value);
            }
            return actual.existsSync(path);
        },
        readFileSync(...args: Parameters<typeof actual.readFileSync>) {
            if (String(args[0]).endsWith('/or3.providers.generated.ts')) {
                fsObservations.generatedProviderReads += 1;
            }
            return Reflect.apply(actual.readFileSync, actual, args);
        },
    };
});

const originalArgv = [...process.argv];
const defineNuxtConfig = (config: Record<string, unknown>) => config;

describe('static generation provider import boundary', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.stubEnv('SSR_AUTH_ENABLED', 'false');
        vi.stubEnv('OR3_SYNC_ENABLED', 'false');
        vi.stubEnv('OR3_CLOUD_SYNC_ENABLED', 'false');
        vi.stubEnv('OR3_STORAGE_ENABLED', 'false');
        vi.stubEnv('OR3_CLOUD_STORAGE_ENABLED', 'false');
        vi.stubEnv('OR3_BACKGROUND_STREAMING_ENABLED', 'false');
        vi.stubEnv('OR3_WIZARD_UI_ENABLED', 'false');
        process.argv = [...originalArgv, 'generate'];
        fsObservations.generatedProviderReads = 0;
        fsObservations.providerPackageChecks.length = 0;
        (globalThis as Record<string, unknown>).defineNuxtConfig = defineNuxtConfig;
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        process.argv = [...originalArgv];
    });

    it('does not evaluate or resolve cloud provider modules when cloud auth is disabled', async () => {
        const { default: nuxtConfig } = await import('../../nuxt.config');
        const modules = (nuxtConfig.modules ?? []) as unknown[];
        const moduleIds = modules.filter((entry): entry is string => typeof entry === 'string');

        expect(moduleIds.some((moduleId) => moduleId.startsWith('or3-provider-'))).toBe(false);
        expect(fsObservations.generatedProviderReads).toBe(0);
        expect(fsObservations.providerPackageChecks).toEqual([]);
    });

    it('keeps generated provider modules available to non-static SSR builds', async () => {
        vi.stubEnv('SSR_AUTH_ENABLED', 'true');
        process.argv = originalArgv.filter((argument) => argument !== 'generate');
        vi.resetModules();

        const { default: nuxtConfig } = await import('../../nuxt.config');
        const modules = (nuxtConfig.modules ?? []) as unknown[];
        const moduleIds = modules.filter((entry): entry is string => typeof entry === 'string');

        expect(moduleIds).toContain('or3-provider-basic-auth/nuxt');
        expect(fsObservations.generatedProviderReads).toBe(1);
        expect(fsObservations.providerPackageChecks.length).toBeGreaterThan(0);
    });

    it('exposes configured OpenRouter browser auth settings', async () => {
        vi.stubEnv(
            'NUXT_PUBLIC_OPENROUTER_REDIRECT_URI',
            'https://chat.example.com/openrouter-callback'
        );
        vi.stubEnv('NUXT_PUBLIC_OPENROUTER_CLIENT_ID', 'or3-client');
        vi.stubEnv('NUXT_PUBLIC_OPENROUTER_AUTH_URL', 'https://login.example.com');
        vi.resetModules();

        const { default: nuxtConfig } = await import('../../nuxt.config');
        expect(nuxtConfig.runtimeConfig.public.openRouterRedirectUri).toBe(
            'https://chat.example.com/openrouter-callback'
        );
        expect(nuxtConfig.runtimeConfig.public.openRouterClientId).toBe(
            'or3-client'
        );
        expect(nuxtConfig.runtimeConfig.public.openRouterAuthUrl).toBe(
            'https://login.example.com'
        );
    });

    it('exposes the configured Connect origin for copyable setup commands', async () => {
        vi.stubEnv('OR3_CONNECT_PUBLIC_URL', 'https://chat.example.com');
        vi.resetModules();

        const { default: nuxtConfig } = await import('../../nuxt.config');
        expect(nuxtConfig.runtimeConfig.public.connect.publicUrl).toBe(
            'https://chat.example.com'
        );
    });
});
