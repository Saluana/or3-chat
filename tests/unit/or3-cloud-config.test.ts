import { describe, expect, it } from 'vitest';
import { defineOr3CloudConfig } from '../../utils/or3-cloud-config';
import type { Or3CloudConfig } from '../../types/or3-cloud-config';

const baseConfig: Or3CloudConfig = {
    auth: {
        enabled: false,
        provider: 'clerk',
        clerk: {},
    },
    sync: {
        enabled: false,
        provider: 'convex',
        convex: {},
    },
    storage: {
        enabled: false,
        provider: 'convex',
    },
    services: {
        llm: {
            openRouter: {},
        },
    },
    limits: {},
    security: {},
};

describe('defineOr3CloudConfig', () => {
    it('applies defaults for optional sections', () => {
        const config = defineOr3CloudConfig(baseConfig, { strict: false });
        expect(config.limits?.requestsPerMinute).toBe(20);
        expect(config.services.llm?.openRouter?.allowUserOverride).toBe(true);
        expect(config.storage.allowedMimeTypes?.length).toBeGreaterThan(0);
        expect(config.backgroundStreaming?.maxConcurrentJobsPerUser).toBe(5);
        expect(config.webhooks?.maxPerUser).toBe(20);
        expect(config.webhooks?.rateLimitPerMinute).toBe(120);
        expect(config.auth.lockPage?.enabled).toBe(false);
        expect(config.auth.lockPage?.adapter).toBe('default');
    });

    it('throws in strict mode when instance key is required', () => {
        expect(() =>
            defineOr3CloudConfig(
                {
                    ...baseConfig,
                    services: {
                        llm: {
                            openRouter: {
                                allowUserOverride: false,
                            },
                        },
                    },
                },
                { strict: true }
            )
        ).toThrow(/instanceApiKey is required/i);
    });

    it('throws in strict mode when clerk keys are missing', () => {
        expect(() =>
            defineOr3CloudConfig(
                {
                    ...baseConfig,
                    auth: {
                        enabled: true,
                        provider: 'clerk',
                        clerk: {},
                    },
                },
                { strict: true }
            )
        ).toThrow(/clerk\.publishableKey/i);
    });

    it('throws when sync enabled but Convex URL missing in strict mode', () => {
        expect(() =>
            defineOr3CloudConfig(
                {
                    ...baseConfig,
                    auth: {
                        enabled: true,
                        provider: 'clerk',
                        clerk: {
                            publishableKey: 'pk_test',
                            secretKey: 'sk_test',
                        },
                    },
                    sync: {
                        enabled: true,
                        provider: 'convex',
                        convex: {},
                    },
                },
                { strict: true }
            )
        ).toThrow(/convex\.url is required/i);
    });

    it('throws when OpenRouter requires user key but disallows override', () => {
        expect(() =>
            defineOr3CloudConfig(
                {
                    ...baseConfig,
                    services: {
                        llm: {
                            openRouter: {
                                requireUserKey: true,
                                allowUserOverride: false,
                            },
                        },
                    },
                },
                { strict: true }
            )
        ).toThrow(/allowUserOverride must be true when requireUserKey/i);
    });

    it('allows custom provider IDs for extensibility', () => {
        expect(() =>
            defineOr3CloudConfig({
                ...baseConfig,
                auth: {
                    enabled: true,
                    provider: 'fake-provider',
                    clerk: {},
                },
            })
        ).not.toThrow();
    });

    it('merges nested objects correctly', () => {
        const config = defineOr3CloudConfig(
            {
                ...baseConfig,
                auth: {
                    enabled: true,
                    provider: 'clerk',
                    clerk: { publishableKey: 'pk_test' },
                },
                services: {
                    llm: {
                        openRouter: {
                            instanceApiKey: 'sk_test',
                        },
                    },
                },
            },
            { strict: false }
        );
        // Should merge with defaults
        expect(config.services.llm?.openRouter?.allowUserOverride).toBe(true);
        expect(config.services.llm?.openRouter?.instanceApiKey).toBe('sk_test');
    });

    it('merges lock page config with defaults', () => {
        const config = defineOr3CloudConfig({
            ...baseConfig,
            auth: {
                enabled: true,
                provider: 'basic-auth',
                lockPage: {
                    enabled: true,
                    adapter: 'marketing',
                },
                clerk: {},
            },
        });

        expect(config.auth.lockPage?.enabled).toBe(true);
        expect(config.auth.lockPage?.adapter).toBe('marketing');
    });

    it('merges admin config with defaults', () => {
        const config = defineOr3CloudConfig({
            ...baseConfig,
            admin: {
                basePath: '/custom-admin',
            },
        });
        expect(config.admin?.basePath).toBe('/custom-admin');
        expect(config.admin?.allowRestart).toBe(false); // default preserved
        expect(config.admin?.pluginRuntimeLoaderEnabled).toBe(true);
        expect(config.admin?.pluginZipInstallEnabled).toBe(true);
        expect(config.admin?.pluginRouteDispatcherEnabled).toBe(true);
    });

    it('allows overriding plugin operation toggles', () => {
        const config = defineOr3CloudConfig({
            ...baseConfig,
            admin: {
                pluginRuntimeLoaderEnabled: false,
                pluginZipInstallEnabled: false,
                pluginRouteDispatcherEnabled: false,
            },
        });

        expect(config.admin?.pluginRuntimeLoaderEnabled).toBe(false);
        expect(config.admin?.pluginZipInstallEnabled).toBe(false);
        expect(config.admin?.pluginRouteDispatcherEnabled).toBe(false);
    });

    it('merges security config with defaults', () => {
        const config = defineOr3CloudConfig({
            ...baseConfig,
            security: {
                allowedOrigins: ['https://example.com'],
            },
        });
        expect(config.security?.allowedOrigins).toEqual(['https://example.com']);
        expect(config.security?.forceHttps).toBeDefined(); // default preserved
    });

    it('merges webhook config with defaults', () => {
        const config = defineOr3CloudConfig({
            ...baseConfig,
            webhooks: {
                enabled: true,
                maxPerUser: 10,
                blockPrivateIps: true,
            },
        });

        expect(config.webhooks?.enabled).toBe(true);
        expect(config.webhooks?.maxPerUser).toBe(10);
        expect(config.webhooks?.adminMax).toBe(50);
        expect(config.webhooks?.blockPrivateIps).toBe(true);
    });
});

describe('or3-cloud-config error messages', () => {
    it('produces readable error for strict validation failures', () => {
        try {
            defineOr3CloudConfig(
                {
                    ...baseConfig,
                    auth: { enabled: true, provider: 'clerk', clerk: {} },
                },
                { strict: true }
            );
            expect.fail('should have thrown');
        } catch (err: any) {
            expect(err.message).toContain('[or3-cloud-config]');
            expect(err.message).toContain('publishableKey');
        }
    });

    it('lists multiple errors when multiple fields invalid', () => {
        try {
            defineOr3CloudConfig(
                {
                    ...baseConfig,
                    auth: { enabled: true, provider: 'clerk', clerk: {} },
                    services: {
                        llm: {
                            openRouter: {
                                allowUserOverride: false,
                            },
                        },
                    },
                },
                { strict: true }
            );
            expect.fail('should have thrown');
        } catch (err: any) {
            expect(err.message).toContain('publishableKey');
            expect(err.message).toContain('instanceApiKey');
        }
    });
});
