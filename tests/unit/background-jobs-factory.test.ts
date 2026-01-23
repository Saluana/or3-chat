/**
 * Unit tests for Background Job Provider Factory
 * Phase 9.3: Provider factory tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    getJobProvider,
    isBackgroundStreamingEnabled,
    resetJobProvider,
} from '../../server/utils/background-jobs/store';

// Mock useRuntimeConfig
vi.mock('#imports', () => ({
    useRuntimeConfig: vi.fn(),
}));

import { useRuntimeConfig } from '#imports';

describe('Background Job Provider Factory', () => {
    beforeEach(() => {
        resetJobProvider();
        vi.clearAllMocks();
    });

    afterEach(() => {
        resetJobProvider();
    });

    describe('Provider Selection', () => {
        it('should return memory provider by default', () => {
            vi.mocked(useRuntimeConfig).mockReturnValue({
                backgroundJobs: {
                    storageProvider: 'memory',
                },
            } as ReturnType<typeof useRuntimeConfig>);

            const provider = getJobProvider();
            expect(provider.name).toBe('memory');
        });

        it('should return memory provider when no config is provided', () => {
            vi.mocked(useRuntimeConfig).mockReturnValue({} as ReturnType<typeof useRuntimeConfig>);

            const provider = getJobProvider();
            expect(provider.name).toBe('memory');
        });

        it('should return convex provider when configured with convexUrl', () => {
            vi.mocked(useRuntimeConfig).mockReturnValue({
                backgroundJobs: {
                    storageProvider: 'convex',
                },
                public: {
                    sync: {
                        convexUrl: 'https://test.convex.cloud',
                    },
                },
            } as ReturnType<typeof useRuntimeConfig>);

            const provider = getJobProvider();
            expect(provider.name).toBe('convex');
        });

        it('should fall back to memory when convex is selected but no URL is configured', () => {
            const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            vi.mocked(useRuntimeConfig).mockReturnValue({
                backgroundJobs: {
                    storageProvider: 'convex',
                },
                public: {
                    sync: {
                        convexUrl: undefined,
                    },
                },
            } as ReturnType<typeof useRuntimeConfig>);

            const provider = getJobProvider();
            expect(provider.name).toBe('memory');
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                expect.stringContaining('Convex URL not configured')
            );

            consoleWarnSpy.mockRestore();
        });

        it('should fall back to memory for unimplemented redis provider', () => {
            const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            vi.mocked(useRuntimeConfig).mockReturnValue({
                backgroundJobs: {
                    storageProvider: 'redis',
                },
            } as ReturnType<typeof useRuntimeConfig>);

            const provider = getJobProvider();
            expect(provider.name).toBe('memory');
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                expect.stringContaining('Redis provider not yet implemented')
            );

            consoleWarnSpy.mockRestore();
        });

        it('should cache provider instance after first call', () => {
            const config = {
                backgroundJobs: {
                    storageProvider: 'memory',
                },
            } as ReturnType<typeof useRuntimeConfig>;

            vi.mocked(useRuntimeConfig).mockReturnValue(config);

            const provider1 = getJobProvider();
            const provider2 = getJobProvider();

            expect(provider1).toBe(provider2);
            // useRuntimeConfig should only be called once due to caching
            expect(useRuntimeConfig).toHaveBeenCalledTimes(1);
        });

        it('should reset cache and allow provider switch', () => {
            // First call - memory provider
            vi.mocked(useRuntimeConfig).mockReturnValue({
                backgroundJobs: {
                    storageProvider: 'memory',
                },
            } as ReturnType<typeof useRuntimeConfig>);

            const provider1 = getJobProvider();
            expect(provider1.name).toBe('memory');

            // Reset cache
            resetJobProvider();

            // Second call - convex provider (simulated)
            vi.mocked(useRuntimeConfig).mockReturnValue({
                backgroundJobs: {
                    storageProvider: 'convex',
                },
                public: {
                    sync: {
                        convexUrl: 'https://test.convex.cloud',
                    },
                },
            } as ReturnType<typeof useRuntimeConfig>);

            const provider2 = getJobProvider();
            expect(provider2.name).toBe('convex');
        });
    });

    describe('Background Streaming Enablement', () => {
        it('should return false when background jobs are not enabled', () => {
            vi.mocked(useRuntimeConfig).mockReturnValue({
                backgroundJobs: {
                    enabled: false,
                },
            } as ReturnType<typeof useRuntimeConfig>);

            expect(isBackgroundStreamingEnabled()).toBe(false);
        });

        it('should return true when background jobs are enabled', () => {
            vi.mocked(useRuntimeConfig).mockReturnValue({
                backgroundJobs: {
                    enabled: true,
                },
            } as ReturnType<typeof useRuntimeConfig>);

            expect(isBackgroundStreamingEnabled()).toBe(true);
        });

        it('should return false when no config is provided', () => {
            vi.mocked(useRuntimeConfig).mockReturnValue({} as ReturnType<typeof useRuntimeConfig>);

            expect(isBackgroundStreamingEnabled()).toBe(false);
        });

        it('should return false when backgroundJobs config is missing', () => {
            vi.mocked(useRuntimeConfig).mockReturnValue({
                backgroundJobs: undefined,
            } as ReturnType<typeof useRuntimeConfig>);

            expect(isBackgroundStreamingEnabled()).toBe(false);
        });
    });
});
