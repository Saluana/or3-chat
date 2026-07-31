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

    it('returns same provider instance on repeated calls (memoization)', () => {
        let createCallCount = 0;
        registerStorageProvider({
            id: 'mock-provider',
            create: () => {
                createCallCount++;
                return {
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
                };
            },
        });

        const provider1 = getActiveStorageProvider();
        const provider2 = getActiveStorageProvider();
        const provider3 = getActiveStorageProvider();

        // Should be the exact same instance
        expect(provider1).toBe(provider2);
        expect(provider2).toBe(provider3);
        // Factory should only be called once
        expect(createCallCount).toBe(1);
    });

    it('clears cache on reset', () => {
        let createCallCount = 0;
        const registrationConfig = {
            id: 'mock-provider',
            create: () => {
                createCallCount++;
                return {
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
                };
            },
        };

        registerStorageProvider(registrationConfig);
        getActiveStorageProvider();
        expect(createCallCount).toBe(1);

        _resetStorageProviders();
        registerStorageProvider(registrationConfig);
        getActiveStorageProvider();
        expect(createCallCount).toBe(2);
    });
});
