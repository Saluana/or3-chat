import { describe, it, expect } from 'vitest';
import {
    buildOr3ConfigFromEnv,
    buildOr3CloudConfigFromEnv,
} from '../../server/admin/config/resolve-config';

describe('Config integration: env to runtime', () => {
    it('demonstrates full OR3 config flow', () => {
        const env = {
            OR3_SITE_NAME: 'TestApp',
            OR3_MAX_FILE_SIZE_BYTES: '10485760',
            OR3_WORKFLOWS_ENABLED: 'false',
        };

        const config = buildOr3ConfigFromEnv(env);

        expect(config.site.name).toBe('TestApp');
        expect(config.limits.maxFileSizeBytes).toBe(10485760);
        expect(config.features.workflows.enabled).toBe(false);
    });

    it('demonstrates full OR3 Cloud config flow', () => {
        const env = {
            SSR_AUTH_ENABLED: 'true',
            AUTH_PROVIDER: 'clerk',
            NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_123',
            NUXT_CLERK_SECRET_KEY: 'sk_test_456',
            OR3_SYNC_PROVIDER: 'convex',
            VITE_CONVEX_URL: 'https://test.convex.cloud',
            OR3_REQUESTS_PER_MINUTE: '50',
        };

        const config = buildOr3CloudConfigFromEnv(env);

        expect(config.auth.enabled).toBe(true);
        expect(config.auth.provider).toBe('clerk');
        expect(config.auth.clerk?.publishableKey).toBe('pk_test_123');
        expect(config.sync.enabled).toBe(true);
        expect(config.sync.convex?.url).toBe('https://test.convex.cloud');
        expect(config.limits?.requestsPerMinute).toBe(50);
    });

    it('shows env var to config field mapping for features', () => {
        const env = {
            OR3_WORKFLOWS_ENABLED: 'true',
            OR3_WORKFLOWS_EDITOR: 'false',
            OR3_DOCUMENTS_ENABLED: 'false',
            OR3_BACKUP_ENABLED: 'true',
        };

        const config = buildOr3ConfigFromEnv(env);

        expect(config.features.workflows.enabled).toBe(true);
        expect(config.features.workflows.editor).toBe(false);
        expect(config.features.documents.enabled).toBe(false);
        expect(config.features.backup.enabled).toBe(true);
    });

    it('shows env var to config field mapping for security', () => {
        const env = {
            OR3_ALLOWED_ORIGINS: 'https://app.com,https://admin.com',
            OR3_FORCE_HTTPS: 'true',
            NODE_ENV: 'development',
        };

        const config = buildOr3CloudConfigFromEnv(env);

        expect(config.security?.allowedOrigins).toEqual([
            'https://app.com',
            'https://admin.com',
        ]);
        expect(config.security?.forceHttps).toBe(true);
    });

    it('shows env var to config field mapping for admin', () => {
        const env = {
            OR3_ADMIN_BASE_PATH: '/custom-admin',
            OR3_ADMIN_ALLOW_RESTART: 'true',
            OR3_ADMIN_ALLOW_REBUILD: 'false',
            OR3_ADMIN_REBUILD_COMMAND: 'npm run build',
        };

        const config = buildOr3CloudConfigFromEnv(env);

        expect(config.admin?.basePath).toBe('/custom-admin');
        expect(config.admin?.allowRestart).toBe(true);
        expect(config.admin?.allowRebuild).toBe(false);
        expect(config.admin?.rebuildCommand).toBe('npm run build');
    });

    it('shows auth gating behavior for sync and storage', () => {
        // When auth is disabled, sync and storage are forced off
        const noAuthConfig = buildOr3CloudConfigFromEnv({
            SSR_AUTH_ENABLED: 'false',
        });
        expect(noAuthConfig.auth.enabled).toBe(false);
        expect(noAuthConfig.sync.enabled).toBe(false);
        expect(noAuthConfig.storage.enabled).toBe(false);

        // When auth is enabled, sync and storage can be independently controlled
        const withAuthConfig = buildOr3CloudConfigFromEnv({
            SSR_AUTH_ENABLED: 'true',
            OR3_SYNC_ENABLED: 'false',
        });
        expect(withAuthConfig.auth.enabled).toBe(true);
        expect(withAuthConfig.sync.enabled).toBe(false);
        expect(withAuthConfig.storage.enabled).toBe(true);
    });

    it('shows storage provider auto-selection based on sync', () => {
        // Without sync, uses memory
        const noSyncConfig = buildOr3CloudConfigFromEnv({});
        expect(noSyncConfig.limits?.storageProvider).toBe('memory');
        expect(noSyncConfig.backgroundStreaming?.storageProvider).toBe('memory');

        // With sync, uses convex
        const withSyncConfig = buildOr3CloudConfigFromEnv({
            SSR_AUTH_ENABLED: 'true',
        });
        expect(withSyncConfig.limits?.storageProvider).toBe('convex');
        expect(withSyncConfig.backgroundStreaming?.storageProvider).toBe('convex');
    });

    it('shows complete production deployment config', () => {
        const env = {
            // Auth
            SSR_AUTH_ENABLED: 'true',
            AUTH_PROVIDER: 'clerk',
            NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_live_xxx',
            NUXT_CLERK_SECRET_KEY: 'sk_live_xxx',
            // Sync
            OR3_SYNC_PROVIDER: 'convex',
            VITE_CONVEX_URL: 'https://prod.convex.cloud',
            // Storage
            NUXT_PUBLIC_STORAGE_PROVIDER: 'convex',
            // LLM
            OPENROUTER_API_KEY: 'sk_or_xxx',
            OR3_OPENROUTER_ALLOW_USER_OVERRIDE: 'true',
            // Limits
            OR3_REQUESTS_PER_MINUTE: '60',
            OR3_MAX_CONVERSATIONS: '100',
            OR3_MAX_MESSAGES_PER_DAY: '1000',
            // Security
            OR3_ALLOWED_ORIGINS: 'https://app.example.com,https://admin.example.com',
            OR3_FORCE_HTTPS: 'true',
            // Admin
            OR3_ADMIN_ALLOWED_HOSTS: 'admin.example.com',
            OR3_ADMIN_ALLOW_RESTART: 'false',
            OR3_ADMIN_ALLOW_REBUILD: 'false',
            // Background
            OR3_BACKGROUND_STREAMING_ENABLED: 'true',
            OR3_BACKGROUND_MAX_JOBS: '30',
            // Env
            NODE_ENV: 'production',
        };

        const config = buildOr3CloudConfigFromEnv(env);

        // Should not throw in production with all required keys
        expect(config.auth.enabled).toBe(true);
        expect(config.sync.enabled).toBe(true);
        expect(config.storage.enabled).toBe(true);
        expect(config.services.llm?.openRouter?.instanceApiKey).toBe('sk_or_xxx');
        expect(config.limits?.requestsPerMinute).toBe(60);
        expect(config.security?.forceHttps).toBe(true);
        expect(config.backgroundStreaming?.enabled).toBe(true);
    });
});
