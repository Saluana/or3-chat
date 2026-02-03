import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    buildOr3ConfigFromEnv,
    buildOr3CloudConfigFromEnv,
} from '../../server/admin/config/resolve-config';

describe('buildOr3ConfigFromEnv', () => {
    it('applies defaults when env is empty', () => {
        const config = buildOr3ConfigFromEnv({});
        expect(config.site.name).toBe('OR3');
        expect(config.limits.maxFileSizeBytes).toBe(20 * 1024 * 1024);
        expect(config.features.workflows.enabled).toBe(true);
    });

    it('parses numeric env vars correctly', () => {
        const config = buildOr3ConfigFromEnv({
            OR3_MAX_FILE_SIZE_BYTES: '52428800',
            OR3_MAX_FILES_PER_MESSAGE: '15',
        });
        expect(config.limits.maxFileSizeBytes).toBe(52428800);
        expect(config.limits.maxFilesPerMessage).toBe(15);
    });

    it('ignores malformed numbers and uses defaults', () => {
        const config = buildOr3ConfigFromEnv({
            OR3_MAX_FILE_SIZE_BYTES: 'not-a-number',
        });
        expect(config.limits.maxFileSizeBytes).toBe(20 * 1024 * 1024);
    });

    it('handles infinite and NaN as undefined', () => {
        const config = buildOr3ConfigFromEnv({
            OR3_MAX_FILE_SIZE_BYTES: 'Infinity',
            OR3_MAX_FILES_PER_MESSAGE: 'NaN',
        });
        expect(config.limits.maxFileSizeBytes).toBe(20 * 1024 * 1024);
        expect(config.limits.maxFilesPerMessage).toBe(10);
    });

    it('parses boolean feature toggles', () => {
        const config = buildOr3ConfigFromEnv({
            OR3_WORKFLOWS_ENABLED: 'false',
            OR3_DOCUMENTS_ENABLED: 'true',
        });
        expect(config.features.workflows.enabled).toBe(false);
        expect(config.features.documents.enabled).toBe(true);
    });

    it('treats non-false strings as true for feature toggles', () => {
        const config = buildOr3ConfigFromEnv({
            OR3_WORKFLOWS_ENABLED: 'yes',
        });
        expect(config.features.workflows.enabled).toBe(true);
    });

    it('handles sidebar collapsed as boolean', () => {
        const config = buildOr3ConfigFromEnv({
            OR3_SIDEBAR_COLLAPSED: 'true',
        });
        expect(config.ui.sidebarCollapsedByDefault).toBe(true);
    });

    it('allows overriding site branding', () => {
        const config = buildOr3ConfigFromEnv({
            OR3_SITE_NAME: 'MyApp',
            OR3_SITE_DESCRIPTION: 'My description',
            OR3_LOGO_URL: '/logo.png',
        });
        expect(config.site.name).toBe('MyApp');
        expect(config.site.description).toBe('My description');
        expect(config.site.logoUrl).toBe('/logo.png');
    });

    it('allows partial feature toggle overrides', () => {
        const config = buildOr3ConfigFromEnv({
            OR3_WORKFLOWS_EDITOR: 'false',
        });
        expect(config.features.workflows.enabled).toBe(true);
        expect(config.features.workflows.editor).toBe(false);
        expect(config.features.workflows.slashCommands).toBe(true);
    });

    it('allows setting legal URLs', () => {
        const config = buildOr3ConfigFromEnv({
            OR3_TERMS_URL: 'https://example.com/terms',
            OR3_PRIVACY_URL: 'https://example.com/privacy',
        });
        expect(config.legal.termsUrl).toBe('https://example.com/terms');
        expect(config.legal.privacyUrl).toBe('https://example.com/privacy');
    });

    it('allows setting UI defaults', () => {
        const config = buildOr3ConfigFromEnv({
            OR3_DEFAULT_PANE_COUNT: '2',
            OR3_MAX_PANES: '6',
        });
        expect(config.ui.defaultPaneCount).toBe(2);
        expect(config.ui.maxPanes).toBe(6);
    });
});

describe('buildOr3CloudConfigFromEnv', () => {
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
        originalEnv = { ...process.env };
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    describe('envBool parsing', () => {
        it('accepts "true" as truthy', () => {
            const config = buildOr3CloudConfigFromEnv({
                OR3_FORCE_HTTPS: 'true',
                NODE_ENV: 'development',
            });
            expect(config.security?.forceHttps).toBe(true);
        });

        it('accepts "1" as truthy', () => {
            const config = buildOr3CloudConfigFromEnv({
                OR3_FORCE_HTTPS: '1',
                NODE_ENV: 'development',
            });
            expect(config.security?.forceHttps).toBe(true);
        });

        it('accepts "yes" as truthy', () => {
            const config = buildOr3CloudConfigFromEnv({
                OR3_FORCE_HTTPS: 'yes',
                NODE_ENV: 'development',
            });
            expect(config.security?.forceHttps).toBe(true);
        });

        it('accepts "on" as truthy', () => {
            const config = buildOr3CloudConfigFromEnv({
                OR3_FORCE_HTTPS: 'on',
                NODE_ENV: 'development',
            });
            expect(config.security?.forceHttps).toBe(true);
        });

        it('accepts "TRUE" (uppercase) as truthy', () => {
            const config = buildOr3CloudConfigFromEnv({
                OR3_FORCE_HTTPS: 'TRUE',
                NODE_ENV: 'development',
            });
            expect(config.security?.forceHttps).toBe(true);
        });

        it('accepts "Yes" (mixed case) as truthy', () => {
            const config = buildOr3CloudConfigFromEnv({
                OR3_FORCE_HTTPS: 'Yes',
                NODE_ENV: 'development',
            });
            expect(config.security?.forceHttps).toBe(true);
        });

        it('treats "false" as falsy', () => {
            const config = buildOr3CloudConfigFromEnv({
                OR3_FORCE_HTTPS: 'false',
                NODE_ENV: 'development',
            });
            expect(config.security?.forceHttps).toBe(false);
        });

        it('treats "0" as falsy', () => {
            const config = buildOr3CloudConfigFromEnv({
                OR3_FORCE_HTTPS: '0',
                NODE_ENV: 'development',
            });
            expect(config.security?.forceHttps).toBe(false);
        });

        it('treats empty string as falsy', () => {
            const config = buildOr3CloudConfigFromEnv({
                OR3_FORCE_HTTPS: '',
                NODE_ENV: 'development',
            });
            expect(config.security?.forceHttps).toBe(false);
        });

        it('treats random string as falsy', () => {
            const config = buildOr3CloudConfigFromEnv({
                OR3_FORCE_HTTPS: 'random',
                NODE_ENV: 'development',
            });
            expect(config.security?.forceHttps).toBe(false);
        });
    });

    it('defaults auth/sync/storage to disabled when SSR_AUTH_ENABLED is unset', () => {
        const config = buildOr3CloudConfigFromEnv({});
        expect(config.auth.enabled).toBe(false);
        expect(config.sync.enabled).toBe(false);
        expect(config.storage.enabled).toBe(false);
    });

    it('enables auth when SSR_AUTH_ENABLED=true', () => {
        const config = buildOr3CloudConfigFromEnv({
            SSR_AUTH_ENABLED: 'true',
            NODE_ENV: 'development',
        });
        expect(config.auth.enabled).toBe(true);
        expect(config.sync.enabled).toBe(true); // sync follows auth
        expect(config.storage.enabled).toBe(true); // storage follows auth
    });

    it('allows explicitly disabling sync when auth is enabled', () => {
        const config = buildOr3CloudConfigFromEnv({
            SSR_AUTH_ENABLED: 'true',
            OR3_SYNC_ENABLED: 'false',
            NODE_ENV: 'development',
        });
        expect(config.auth.enabled).toBe(true);
        expect(config.sync.enabled).toBe(false);
        expect(config.storage.enabled).toBe(true);
    });

    it('reads CONVEX_SELF_HOSTED_ADMIN_KEY into sync.convex.adminKey', () => {
        const config = buildOr3CloudConfigFromEnv({
            SSR_AUTH_ENABLED: 'true',
            CONVEX_SELF_HOSTED_ADMIN_KEY: 'admin-key-value',
            NODE_ENV: 'development',
        });
        expect(config.sync.convex?.adminKey).toBe('admin-key-value');
    });

    it('parses CORS origins from CSV', () => {
        const config = buildOr3CloudConfigFromEnv({
            OR3_ALLOWED_ORIGINS: 'https://app.com, https://admin.app.com, ',
        });
        expect(config.security?.allowedOrigins).toEqual([
            'https://app.com',
            'https://admin.app.com',
        ]);
    });

    it('handles empty CORS origins string', () => {
        const config = buildOr3CloudConfigFromEnv({
            OR3_ALLOWED_ORIGINS: '',
        });
        expect(config.security?.allowedOrigins).toEqual([]);
    });

    it('parses admin allowed hosts from CSV', () => {
        const config = buildOr3CloudConfigFromEnv({
            OR3_ADMIN_ALLOWED_HOSTS: 'admin.local , admin.prod ',
        });
        expect(config.admin?.allowedHosts).toEqual(['admin.local', 'admin.prod']);
    });

    it('parses extension allowed extensions from CSV', () => {
        const config = buildOr3CloudConfigFromEnv({
            OR3_ADMIN_EXTENSION_ALLOWED_EXTENSIONS: '.js,.ts, .vue ',
        });
        expect(config.admin?.extensionAllowedExtensions).toEqual(['.js', '.ts', '.vue']);
    });

    it('throws in strict mode when Clerk keys missing', () => {
        process.env.NODE_ENV = 'production';
        expect(() =>
            buildOr3CloudConfigFromEnv({
                SSR_AUTH_ENABLED: 'true',
                AUTH_PROVIDER: 'clerk',
            })
        ).toThrow(/publishableKey/i);
    });

    it('throws with OR3_STRICT_CONFIG=true when Clerk keys missing', () => {
        process.env.OR3_STRICT_CONFIG = 'true';
        process.env.NODE_ENV = 'development';
        expect(() =>
            buildOr3CloudConfigFromEnv({
                SSR_AUTH_ENABLED: 'true',
                AUTH_PROVIDER: 'clerk',
            })
        ).toThrow(/publishableKey/i);
    });

    it('throws in strict mode when only publishableKey is missing', () => {
        process.env.NODE_ENV = 'production';
        expect(() =>
            buildOr3CloudConfigFromEnv({
                SSR_AUTH_ENABLED: 'true',
                AUTH_PROVIDER: 'clerk',
                NUXT_CLERK_SECRET_KEY: 'sk_test',
            })
        ).toThrow(/publishableKey/i);
    });

    it('does not throw in non-strict mode when keys missing', () => {
        process.env.NODE_ENV = 'development';
        expect(() =>
            buildOr3CloudConfigFromEnv({
                SSR_AUTH_ENABLED: 'true',
                AUTH_PROVIDER: 'clerk',
            })
        ).not.toThrow();
    });

    it('throws in strict mode when Convex URL missing', () => {
        process.env.NODE_ENV = 'production';
        expect(() =>
            buildOr3CloudConfigFromEnv({
                SSR_AUTH_ENABLED: 'true',
                AUTH_PROVIDER: 'clerk',
                NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test',
                NUXT_CLERK_SECRET_KEY: 'sk_test',
                OR3_SYNC_PROVIDER: 'convex',
            })
        ).toThrow(/convex\.url/i);
    });

    it('parses numeric limits correctly', () => {
        const config = buildOr3CloudConfigFromEnv({
            OR3_REQUESTS_PER_MINUTE: '100',
            OR3_MAX_CONVERSATIONS: '500',
            OR3_MAX_MESSAGES_PER_DAY: '1000',
        });
        expect(config.limits?.requestsPerMinute).toBe(100);
        expect(config.limits?.maxConversations).toBe(500);
        expect(config.limits?.maxMessagesPerDay).toBe(1000);
    });

    it('uses default limits when env is malformed', () => {
        const config = buildOr3CloudConfigFromEnv({
            OR3_REQUESTS_PER_MINUTE: 'bad',
        });
        expect(config.limits?.requestsPerMinute).toBe(20);
    });

    it('uses default for background streaming numeric values', () => {
        const config = buildOr3CloudConfigFromEnv({
            OR3_BACKGROUND_MAX_JOBS: 'invalid',
        });
        expect(config.backgroundStreaming?.maxConcurrentJobs).toBe(20);
    });

    it('parses background streaming config correctly', () => {
        const config = buildOr3CloudConfigFromEnv({
            OR3_BACKGROUND_STREAMING_ENABLED: 'true',
            OR3_BACKGROUND_MAX_JOBS: '50',
            OR3_BACKGROUND_JOB_TIMEOUT: '600',
        });
        expect(config.backgroundStreaming?.enabled).toBe(true);
        expect(config.backgroundStreaming?.maxConcurrentJobs).toBe(50);
        expect(config.backgroundStreaming?.jobTimeoutSeconds).toBe(600);
    });

    it('respects forceHttps override', () => {
        const config = buildOr3CloudConfigFromEnv({
            OR3_FORCE_HTTPS: 'true',
            NODE_ENV: 'development',
        });
        expect(config.security?.forceHttps).toBe(true);
    });

    it('defaults forceHttps to true in production', () => {
        const config = buildOr3CloudConfigFromEnv({
            NODE_ENV: 'production',
        });
        expect(config.security?.forceHttps).toBe(true);
    });

    it('allows admin rebuild and restart flags', () => {
        const config = buildOr3CloudConfigFromEnv({
            OR3_ADMIN_ALLOW_RESTART: 'true',
            OR3_ADMIN_ALLOW_REBUILD: 'true',
            OR3_ADMIN_REBUILD_COMMAND: 'bun run custom:build',
        });
        expect(config.admin?.allowRestart).toBe(true);
        expect(config.admin?.allowRebuild).toBe(true);
        expect(config.admin?.rebuildCommand).toBe('bun run custom:build');
    });

    it('parses admin extension limits', () => {
        const config = buildOr3CloudConfigFromEnv({
            OR3_ADMIN_EXTENSION_MAX_ZIP_BYTES: '10485760',
            OR3_ADMIN_EXTENSION_MAX_FILES: '1000',
            OR3_ADMIN_EXTENSION_MAX_TOTAL_BYTES: '52428800',
        });
        expect(config.admin?.extensionMaxZipBytes).toBe(10485760);
        expect(config.admin?.extensionMaxFiles).toBe(1000);
        expect(config.admin?.extensionMaxTotalBytes).toBe(52428800);
    });

    it('throws when OpenRouter requires user key but disallows override', () => {
        process.env.NODE_ENV = 'production';
        expect(() =>
            buildOr3CloudConfigFromEnv({
                OR3_OPENROUTER_REQUIRE_USER_KEY: 'true',
                OR3_OPENROUTER_ALLOW_USER_OVERRIDE: 'false',
            })
        ).toThrow(/allowUserOverride must be true/i);
    });

    it('throws when OpenRouter disallows override but no instance key', () => {
        process.env.NODE_ENV = 'production';
        expect(() =>
            buildOr3CloudConfigFromEnv({
                OR3_OPENROUTER_ALLOW_USER_OVERRIDE: 'false',
            })
        ).toThrow(/instanceApiKey is required/i);
    });

    it('uses correct storage provider for limits based on sync', () => {
        const configNoSync = buildOr3CloudConfigFromEnv({
            NODE_ENV: 'development',
        });
        expect(configNoSync.limits?.storageProvider).toBe('memory');

        const configWithSync = buildOr3CloudConfigFromEnv({
            SSR_AUTH_ENABLED: 'true',
            NODE_ENV: 'development',
        });
        expect(configWithSync.limits?.storageProvider).toBe('convex');
    });

    it('allows overriding limits storage provider', () => {
        const config = buildOr3CloudConfigFromEnv({
            OR3_LIMITS_STORAGE_PROVIDER: 'redis',
        });
        expect(config.limits?.storageProvider).toBe('redis');
    });

    it('uses correct storage provider for background streaming based on sync', () => {
        const configNoSync = buildOr3CloudConfigFromEnv({
            NODE_ENV: 'development',
        });
        expect(configNoSync.backgroundStreaming?.storageProvider).toBe('memory');

        const configWithSync = buildOr3CloudConfigFromEnv({
            SSR_AUTH_ENABLED: 'true',
            NODE_ENV: 'development',
        });
        expect(configWithSync.backgroundStreaming?.storageProvider).toBe('convex');
    });

    it('allows overriding background streaming storage provider', () => {
        const config = buildOr3CloudConfigFromEnv({
            OR3_BACKGROUND_STREAMING_PROVIDER: 'redis',
        });
        expect(config.backgroundStreaming?.storageProvider).toBe('redis');
    });

    it('respects OR3_STRICT_CONFIG=true', () => {
        process.env.OR3_STRICT_CONFIG = 'true';
        process.env.NODE_ENV = 'development';
        expect(() =>
            buildOr3CloudConfigFromEnv({
                SSR_AUTH_ENABLED: 'true',
                AUTH_PROVIDER: 'clerk',
            })
        ).toThrow(/publishableKey/i);
    });
});
