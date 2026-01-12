import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('#imports', () => ({
    useRuntimeConfig: () => ({
        public: {
            storage: {
                provider: 'mock-provider',
            },
        },
    }),
}));

import {
    _resetStorageProviders,
    getActiveStorageProvider,
    registerStorageProvider,
} from '../provider-registry';

describe('storage provider registry', () => {
    beforeEach(() => {
        _resetStorageProviders();
    });

    it('selects the provider from runtime config', () => {
        registerStorageProvider({
            id: 'mock-provider',
            create: () => ({
                id: 'mock-provider',
                displayName: 'Mock Provider',
                supports: {
                    presignedUpload: true,
                    presignedDownload: true,
                },
                async getPresignedUploadUrl() {
                    return { url: 'upload', expiresAt: Date.now() };
                },
                async getPresignedDownloadUrl() {
                    return { url: 'download', expiresAt: Date.now() };
                },
            }),
        });

        const provider = getActiveStorageProvider();
        expect(provider?.id).toBe('mock-provider');
    });
});
