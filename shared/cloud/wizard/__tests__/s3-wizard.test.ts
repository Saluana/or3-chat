import { describe, expect, it } from 'vitest';
import { createDefaultAnswers, getProviderDescriptor } from '../catalog';
import { deriveEnvFromAnswers } from '../derive';
import { validateAnswers } from '../validation';

describe('wizard: s3 storage provider', () => {
    it('is present in provider catalog as implemented', () => {
        const desc = getProviderDescriptor('storage', 's3');
        expect(desc?.implemented).toBe(true);
        expect(desc?.id).toBe('s3');
    });

    it('derives OR3_STORAGE_S3_* env vars and provider module', () => {
        const answers = {
            ...createDefaultAnswers({ instanceDir: '/tmp/or3' }),
            storageProvider: 's3' as const,
            s3Endpoint: 'https://s3.example.com',
            s3Region: 'us-east-1',
            s3Bucket: 'bucket',
            s3AccessKeyId: 'ak',
            s3SecretAccessKey: 'sk',
            s3SessionToken: 'st',
            s3ForcePathStyle: true,
            s3KeyPrefix: 'or3',
            s3UrlTtlSeconds: 120,
            s3RequireChecksum: false,
        };

        const { env, providerModules } = deriveEnvFromAnswers(answers);

        expect(env.NUXT_PUBLIC_STORAGE_PROVIDER).toBe('s3');
        expect(env.OR3_STORAGE_S3_ENDPOINT).toBe('https://s3.example.com');
        expect(env.OR3_STORAGE_S3_REGION).toBe('us-east-1');
        expect(env.OR3_STORAGE_S3_BUCKET).toBe('bucket');
        expect(env.OR3_STORAGE_S3_ACCESS_KEY_ID).toBe('ak');
        expect(env.OR3_STORAGE_S3_SECRET_ACCESS_KEY).toBe('sk');
        expect(env.OR3_STORAGE_S3_SESSION_TOKEN).toBe('st');
        expect(env.OR3_STORAGE_S3_FORCE_PATH_STYLE).toBe('true');
        expect(env.OR3_STORAGE_S3_KEY_PREFIX).toBe('or3');
        expect(env.OR3_STORAGE_S3_URL_TTL_SECONDS).toBe('120');
        expect(env.OR3_STORAGE_S3_REQUIRE_CHECKSUM).toBe('false');

        expect(providerModules).toContain('or3-provider-s3/nuxt');
    });

    it('validates required S3 fields when selected', () => {
        const answers = {
            ...createDefaultAnswers({ instanceDir: '/tmp/or3' }),
            storageProvider: 's3' as const,
            s3Region: 'us-east-1',
            s3Bucket: 'bucket',
            s3AccessKeyId: 'ak',
            s3SecretAccessKey: 'sk',
            s3ForcePathStyle: false,
            s3UrlTtlSeconds: 900,
            s3RequireChecksum: false,
            // Avoid unrelated wizard validation failure.
            openrouterInstanceApiKey: 'test-openrouter-key',
            openrouterAllowUserOverride: true,
        };

        const result = validateAnswers(answers);
        // Wizard validation may include other unrelated requirements depending on defaults.
        // For this test, we only care that S3-specific validations pass.
        const s3Errors = result.errors.filter((e) =>
            e.includes('OR3_STORAGE_S3_')
        );
        expect(s3Errors).toEqual([]);
    });

    it('fails validation when S3 URL TTL is not an integer', () => {
        const answers = {
            ...createDefaultAnswers({ instanceDir: '/tmp/or3' }),
            storageProvider: 's3' as const,
            s3Region: 'us-east-1',
            s3Bucket: 'bucket',
            s3AccessKeyId: 'ak',
            s3SecretAccessKey: 'sk',
            s3ForcePathStyle: false,
            s3UrlTtlSeconds: 900.5,
            s3RequireChecksum: false,
            openrouterInstanceApiKey: 'test-openrouter-key',
            openrouterAllowUserOverride: true,
        };

        const result = validateAnswers(answers);
        expect(result.errors).toContain('OR3_STORAGE_S3_URL_TTL_SECONDS must be an integer.');
    });

    it('fails validation when S3 URL TTL is outside allowed bounds', () => {
        const answers = {
            ...createDefaultAnswers({ instanceDir: '/tmp/or3' }),
            storageProvider: 's3' as const,
            s3Region: 'us-east-1',
            s3Bucket: 'bucket',
            s3AccessKeyId: 'ak',
            s3SecretAccessKey: 'sk',
            s3ForcePathStyle: false,
            s3UrlTtlSeconds: 0,
            s3RequireChecksum: false,
            openrouterInstanceApiKey: 'test-openrouter-key',
            openrouterAllowUserOverride: true,
        };

        const result = validateAnswers(answers);
        expect(result.errors).toContain('OR3_STORAGE_S3_URL_TTL_SECONDS must be between 1 and 86400.');
    });
});
