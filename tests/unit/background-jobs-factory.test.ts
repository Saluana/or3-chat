/**
 * Unit tests for Background Job Provider Factory
 * Phase 9.3: Provider factory tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { BackgroundJobProvider } from '../../server/utils/background-jobs/types';
import {
    registerBackgroundJobProvider,
    resetBackgroundJobProviders,
} from '../../server/utils/background-jobs/registry';

// Create a mock that will be shared and assigned to global scope
const mockUseRuntimeConfig = vi.fn();

// Make it globally available for auto-imports
(globalThis as { useRuntimeConfig?: typeof mockUseRuntimeConfig }).useRuntimeConfig = mockUseRuntimeConfig;

// Hoist the mock setup before any imports
vi.mock('#imports', () => ({
    useRuntimeConfig: mockUseRuntimeConfig,
}));

// Now import the modules that depend on the mock
import {
    getJobProvider,
    isBackgroundStreamingEnabled,
    resetJobProvider,
} from '../../server/utils/background-jobs/store';

const mockConvexProvider: BackgroundJobProvider = {
    name: 'convex',
    createJob: vi.fn(async () => 'job-1'),
    getJob: vi.fn(async () => null),
    updateJob: vi.fn(async () => {}),
    completeJob: vi.fn(async () => {}),
    failJob: vi.fn(async () => {}),
    abortJob: vi.fn(async () => false),
    cleanupExpired: vi.fn(async () => 0),
};

describe('Background Job Provider Factory', () => {
    beforeEach(() => {
        resetJobProvider();
        resetBackgroundJobProviders();
        registerBackgroundJobProvider('convex', mockConvexProvider);
        vi.clearAllMocks();
        // Default mock return value
        mockUseRuntimeConfig.mockReturnValue({
            backgroundJobs: {
                storageProvider: 'memory',
            },
        });
    });

    afterEach(() => {
        resetJobProvider();
        resetBackgroundJobProviders();
    });

    describe('Provider Selection', () => {
        it('should return memory provider by default', async () => {
            mockUseRuntimeConfig.mockReturnValue({
                backgroundJobs: {
                    storageProvider: 'memory',
                },
            });

            const provider = await getJobProvider();
            expect(provider.name).toBe('memory');
        });

        it('should return memory provider when no config is provided', async () => {
            mockUseRuntimeConfig.mockReturnValue({});

            const provider = await getJobProvider();
            expect(provider.name).toBe('memory');
        });

        it('should return convex provider when configured with convexUrl', async () => {
            mockUseRuntimeConfig.mockReturnValue({
                backgroundJobs: {
                    storageProvider: 'convex',
                },
                public: {
                    sync: {
                        convexUrl: 'https://test.convex.cloud',
                    },
                },
            });

            const provider = await getJobProvider();
            expect(provider.name).toBe('convex');
        });

        it('should fall back to memory when convex is selected but no URL is configured', async () => {
            const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            mockUseRuntimeConfig.mockReturnValue({
                backgroundJobs: {
                    storageProvider: 'convex',
                },
                public: {
                    sync: {
                        convexUrl: undefined,
                    },
                },
            });

            const provider = await getJobProvider();
            expect(provider.name).toBe('memory');
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                expect.stringContaining('Convex URL not configured')
            );

            consoleWarnSpy.mockRestore();
        });

        it('should fall back to memory for unimplemented redis provider', async () => {
            const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            mockUseRuntimeConfig.mockReturnValue({
                backgroundJobs: {
                    storageProvider: 'redis',
                },
            });

            const provider = await getJobProvider();
            expect(provider.name).toBe('memory');
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                expect.stringContaining('Redis provider not yet implemented')
            );

            consoleWarnSpy.mockRestore();
        });

        it('should cache provider instance after first call', async () => {
            mockUseRuntimeConfig.mockReturnValue({
                backgroundJobs: {
                    storageProvider: 'memory',
                },
            });

            const provider1 = await getJobProvider();
            const provider2 = await getJobProvider();

            expect(provider1).toBe(provider2);
            // useRuntimeConfig should only be called once due to caching
            expect(mockUseRuntimeConfig).toHaveBeenCalledTimes(1);
        });

        it('should reset cache and allow provider switch', async () => {
            // First call - memory provider
            mockUseRuntimeConfig.mockReturnValue({
                backgroundJobs: {
                    storageProvider: 'memory',
                },
            });

            const provider1 = await getJobProvider();
            expect(provider1.name).toBe('memory');

            // Reset cache
            resetJobProvider();

            // Second call - convex provider (simulated)
            mockUseRuntimeConfig.mockReturnValue({
                backgroundJobs: {
                    storageProvider: 'convex',
                },
                public: {
                    sync: {
                        convexUrl: 'https://test.convex.cloud',
                    },
                },
            });

            const provider2 = await getJobProvider();
            expect(provider2.name).toBe('convex');
        });
    });

    describe('Background Streaming Enablement', () => {
        it('should return false when background jobs are not enabled', () => {
            mockUseRuntimeConfig.mockReturnValue({
                backgroundJobs: {
                    enabled: false,
                },
            });

            expect(isBackgroundStreamingEnabled()).toBe(false);
        });

        it('should return true when background jobs are enabled', () => {
            mockUseRuntimeConfig.mockReturnValue({
                backgroundJobs: {
                    enabled: true,
                },
            });

            expect(isBackgroundStreamingEnabled()).toBe(true);
        });

        it('should return false when no config is provided', () => {
            mockUseRuntimeConfig.mockReturnValue({});

            expect(isBackgroundStreamingEnabled()).toBe(false);
        });

        it('should return false when backgroundJobs config is missing', () => {
            mockUseRuntimeConfig.mockReturnValue({
                backgroundJobs: undefined,
            });

            expect(isBackgroundStreamingEnabled()).toBe(false);
        });
    });
});
