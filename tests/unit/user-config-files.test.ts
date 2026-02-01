import { describe, it, expect } from 'vitest';

describe('User config files', () => {
    it('imports config.or3.ts without error', async () => {
        const { or3Config } = await import('../../config.or3');
        expect(or3Config).toBeDefined();
        expect(or3Config.site.name).toBeTruthy();
        expect(or3Config.features).toBeDefined();
        expect(or3Config.limits).toBeDefined();
    });

    it('imports config.or3cloud.ts without error', async () => {
        const { or3CloudConfig } = await import('../../config.or3cloud');
        expect(or3CloudConfig).toBeDefined();
        expect(or3CloudConfig.auth).toBeDefined();
        expect(or3CloudConfig.sync).toBeDefined();
        expect(or3CloudConfig.storage).toBeDefined();
    });

    it('or3Config has valid structure', async () => {
        const { or3Config } = await import('../../config.or3');
        // Validate required top-level keys exist
        expect(or3Config).toHaveProperty('site');
        expect(or3Config).toHaveProperty('features');
        expect(or3Config).toHaveProperty('limits');
        expect(or3Config).toHaveProperty('ui');
    });

    it('or3CloudConfig has valid structure', async () => {
        const { or3CloudConfig } = await import('../../config.or3cloud');
        // Validate required top-level keys exist
        expect(or3CloudConfig).toHaveProperty('auth');
        expect(or3CloudConfig).toHaveProperty('sync');
        expect(or3CloudConfig).toHaveProperty('storage');
        expect(or3CloudConfig).toHaveProperty('services');
    });
});
