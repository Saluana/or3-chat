// @vitest-environment node
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
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
            if (/or3\.providers\.generated\.(ts|json)$/.test(String(args[0]))) {
                fsObservations.generatedProviderReads += 1;
            }
            return Reflect.apply(actual.readFileSync, actual, args);
        },
    };
});

const extensionFixture = vi.hoisted(() => ({ modules: [] as string[] }));
vi.mock('../../config.or3', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../config.or3')>();
    return {
        or3Config: {
            ...actual.or3Config,
            extensions: {
                ...actual.or3Config.extensions,
                plugins: {
                    ...actual.or3Config.extensions?.plugins,
                    modules: extensionFixture.modules,
                },
            },
        },
    };
});

vi.mock('../../shared/config/module-resolution', async (importOriginal) => {
    const actual =
        await importOriginal<
            typeof import('../../shared/config/module-resolution')
        >();
    return {
        ...actual,
        resolveModuleEntry(id: string, root: string) {
            if (id.includes('or3-provider-'))
                fsObservations.providerPackageChecks.push(id);
            return actual.resolveModuleEntry(id, root);
        },
    };
});

const originalArgv = [...process.argv];
const defineNuxtConfig = (config: Record<string, unknown>) => config;

describe('static generation provider import boundary', () => {
    beforeEach(() => {
        vi.resetModules();
        extensionFixture.modules = [];
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
        (globalThis as Record<string, unknown>).defineNuxtConfig =
            defineNuxtConfig;
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        process.argv = [...originalArgv];
    });

    it('excludes an unresolved scoped module when only a sibling is installed', async () => {
        const scope = resolve(
            import.meta.dirname,
            '../../node_modules/@or3-plan-regression',
        );
        mkdirSync(resolve(scope, 'sibling'), { recursive: true });
        writeFileSync(
            resolve(scope, 'sibling/package.json'),
            JSON.stringify({ name: '@or3-plan-regression/sibling' }),
        );
        extensionFixture.modules = ['@or3-plan-regression/missing/nuxt'];
        try {
            const { default: config } = await import('../../nuxt.config');
            expect(config.modules).not.toContain(
                '@or3-plan-regression/missing/nuxt',
            );
        } finally {
            rmSync(scope, { recursive: true, force: true });
        }
    });

    it('does not evaluate or resolve cloud provider modules when cloud auth is disabled', async () => {
        const { default: nuxtConfig } = await import('../../nuxt.config');
        const modules = (nuxtConfig.modules ?? []) as unknown[];
        const moduleIds = modules.filter(
            (entry): entry is string => typeof entry === 'string',
        );

        expect(
            moduleIds.some((moduleId) => moduleId.includes('or3-provider-')),
        ).toBe(false);
        expect(fsObservations.generatedProviderReads).toBe(0);
        expect(fsObservations.providerPackageChecks).toEqual([]);
    });

    it.each([undefined, 'false', 'true'])('gates the audit routes when the journey harness is %s', async (enabled) => {
        vi.stubEnv('OR3_PRODUCTION_JOURNEY_TEST_HARNESS', enabled);
        const { default: config } = await import('../../nuxt.config');
        const pages: Array<{ name: string; path: string; file: string }> = [];
        config.hooks['pages:extend'](pages);
        const auditRoute = pages.find((page) => page.path === '/__or3-mobile-auth-test');
        const projectRoute = pages.find((page) => page.path === '/__or3-projects-journey');
        if (enabled === 'true') {
            expect(auditRoute?.file).toMatch(/tests\/e2e\/fixtures\/MobileAuthJourney\.vue$/);
            expect(config.routeRules['/__or3-mobile-auth-test']).toEqual({ ssr: false });
            expect(projectRoute?.file).toMatch(/tests\/e2e\/fixtures\/ProjectsJourney\.vue$/);
            expect(config.routeRules['/__or3-projects-journey']).toEqual({ ssr: false });
        } else {
            expect(auditRoute).toBeUndefined();
            expect(config.routeRules['/__or3-mobile-auth-test']).toBeUndefined();
            expect(projectRoute).toBeUndefined();
            expect(config.routeRules['/__or3-projects-journey']).toBeUndefined();
        }
    });

    it('keeps generated provider modules available to non-static SSR builds', async () => {
        vi.stubEnv('SSR_AUTH_ENABLED', 'true');
        process.argv = originalArgv.filter(
            (argument) => argument !== 'generate',
        );
        vi.resetModules();

        const { default: nuxtConfig } = await import('../../nuxt.config');
        const modules = (nuxtConfig.modules ?? []) as unknown[];
        const moduleIds = modules.filter(
            (entry): entry is string => typeof entry === 'string',
        );

        expect(
            moduleIds.some((id) =>
                id.includes('/or3-provider-basic-auth/dist/'),
            ),
        ).toBe(true);
        expect(fsObservations.generatedProviderReads).toBe(1);
        expect(fsObservations.providerPackageChecks.length).toBeGreaterThan(0);
    });

    it('exposes configured OpenRouter browser auth settings', async () => {
        vi.stubEnv(
            'NUXT_PUBLIC_OPENROUTER_REDIRECT_URI',
            'https://chat.example.com/openrouter-callback',
        );
        vi.stubEnv('NUXT_PUBLIC_OPENROUTER_CLIENT_ID', 'or3-client');
        vi.stubEnv(
            'NUXT_PUBLIC_OPENROUTER_AUTH_URL',
            'https://login.example.com',
        );
        vi.resetModules();

        const { default: nuxtConfig } = await import('../../nuxt.config');
        expect(nuxtConfig.runtimeConfig.public.openRouterRedirectUri).toBe(
            'https://chat.example.com/openrouter-callback',
        );
        expect(nuxtConfig.runtimeConfig.public.openRouterClientId).toBe(
            'or3-client',
        );
        expect(nuxtConfig.runtimeConfig.public.openRouterAuthUrl).toBe(
            'https://login.example.com',
        );
    });

    it('exposes the configured Connect origin for copyable setup commands', async () => {
        vi.stubEnv('OR3_CONNECT_PUBLIC_URL', 'https://chat.example.com');
        vi.resetModules();

        const { default: nuxtConfig } = await import('../../nuxt.config');
        expect(nuxtConfig.runtimeConfig.public.connect.publicUrl).toBe(
            'https://chat.example.com',
        );
    });

    it('installs every Iconify collection the server bundle declares', async () => {
        const { default: nuxtConfig } = await import('../../nuxt.config');
        const collections =
            (
                nuxtConfig.icon as
                    | { serverBundle?: { collections?: string[] } }
                    | undefined
            )?.serverBundle?.collections ?? [];
        const manifest = JSON.parse(
            readFileSync(
                new URL('../../package.json', import.meta.url),
                'utf8',
            ),
        ) as { devDependencies?: Record<string, string> };
        const missing = collections.filter(
            (collection) =>
                !manifest.devDependencies?.[`@iconify-json/${collection}`],
        );

        expect(collections.length).toBeGreaterThan(0);
        expect(missing).toEqual([]);
    });
});

describe('normalized application plan', () => {
    async function inputs(env: Record<string, string> = {}) {
        const { buildOr3ConfigFromEnv, buildOr3CloudConfigFromEnv } =
            await import('../../server/admin/config/resolve-config');
        return {
            or3Config: buildOr3ConfigFromEnv(env),
            or3CloudConfig: buildOr3CloudConfigFromEnv(env, { strict: false }),
            env,
            modules: new Map<
                string,
                { ok: true; entry: string } | { ok: false; message: string }
            >(),
            isStaticGenerateBuild: false,
            now: 0,
        };
    }
    it('fails requested auth with no store module even when sync transfer is disabled', async () => {
        const { buildApplicationPlan } =
            await import('../../shared/config/application-plan');
        const input = await inputs({
            SSR_AUTH_ENABLED: 'true',
            OR3_AUTH_PROVIDER: 'basic-auth',
            OR3_SYNC_PROVIDER: 'sqlite',
            OR3_CLOUD_SYNC_ENABLED: 'false',
            OR3_CLOUD_STORAGE_ENABLED: 'false',
        });
        input.modules.set('or3-provider-basic-auth/nuxt', {
            ok: true,
            entry: '/fixture/auth.mjs',
        });
        const missing = buildApplicationPlan(input);
        expect(missing.ok).toBe(false);
        if (!missing.ok)
            expect(missing.errors.join(' ')).toMatch(
                /workspace.*or3-provider-sqlite/i,
            );
        input.modules.set('or3-provider-sqlite/nuxt', {
            ok: true,
            entry: '/fixture/sqlite.mjs',
        });
        const ready = buildApplicationPlan(input);
        expect(ready.ok).toBe(true);
        if (ready.ok) {
            expect(ready.plan.runtimeConfig.auth.enabled).toBe(true);
            expect(ready.plan.runtimeConfig.sync.enabled).toBe(false);
            expect(ready.plan.modules).toContain('/fixture/sqlite.mjs');
        }
    });
    it('keeps explicit offline output independent and excludes private values', async () => {
        const { buildApplicationPlan } =
            await import('../../shared/config/application-plan');
        const input = await inputs({
            SSR_AUTH_ENABLED: 'false',
            OPENROUTER_API_KEY: 'private-sentinel-openrouter',
            OR3_ADMIN_PASSWORD: 'private-sentinel-admin',
            OR3_CONNECT_ENCRYPTION_KEY: 'private-sentinel-connect',
            OR3_WIZARD_UI_TOKEN: 'private-sentinel-wizard',
        });
        input.isStaticGenerateBuild = true;
        const result = buildApplicationPlan(input);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.plan.modules).toEqual([]);
            expect(result.plan.runtimeConfig.public.ssrAuthEnabled).toBe(false);
            expect(
                JSON.stringify(result.plan.runtimeConfig.public),
            ).not.toContain('private-sentinel');
            expect(result.plan.runtimeConfig.openrouterApiKey).toBe(
                'private-sentinel-openrouter',
            );
        }
        input.or3CloudConfig.auth.enabled = true;
        const invalid = buildApplicationPlan(input);
        expect(invalid.ok).toBe(false);
        if (!invalid.ok)
            expect(invalid.errors.join(' ')).toContain('generate:static');
    });
});
