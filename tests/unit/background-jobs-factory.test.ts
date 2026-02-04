/**
 * Unit tests for Background Job Provider Factory
 * Phase 9.3: Provider factory tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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
import {
    registerBackgroundJobProvider,
    _resetBackgroundJobProviders,
} from '../../server/utils/background-jobs/registry';

describe('Background Job Provider Factory', () => {
    beforeEach(() => {
        resetJobProvider();
        _resetBackgroundJobProviders();
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
        _resetBackgroundJobProviders();
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

        it('should return convex provider when configured and registered', async () => {
            mockUseRuntimeConfig.mockReturnValue({
                backgroundJobs: {
                    storageProvider: 'convex',
                },
            });

            registerBackgroundJobProvider({
                id: 'convex',
                create: () => ({ name: 'convex' } as any),
            });

            const provider = await getJobProvider();
            expect(provider.name).toBe('convex');
        });

        it('should fall back to memory when provider is missing', async () => {
            const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            mockUseRuntimeConfig.mockReturnValue({
                backgroundJobs: {
                    storageProvider: 'convex',
                },
            });

            const provider = await getJobProvider();
            expect(provider.name).toBe('memory');
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                expect.stringContaining('Provider \"convex\" not registered')
            );

            consoleWarnSpy.mockRestore();
        });

        it('should fall back to memory for unregistered redis provider', async () => {
            const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            mockUseRuntimeConfig.mockReturnValue({
                backgroundJobs: {
                    storageProvider: 'redis',
                },
            });

            const provider = await getJobProvider();
            expect(provider.name).toBe('memory');
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                expect.stringContaining('Provider \"redis\" not registered')
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
            });

            registerBackgroundJobProvider({
                id: 'convex',
                create: () => ({ name: 'convex' } as any),
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
