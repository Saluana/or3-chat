import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getJobProvider, resetJobProvider } from '../store';
import { memoryJobProvider } from '../providers/memory';

// Mock useRuntimeConfig globally
const mockRuntimeConfig = {
    backgroundJobs: {
        storageProvider: 'memory',
    },
    public: {
        sync: {
            convexUrl: '',
        },
    },
};

vi.stubGlobal('useRuntimeConfig', () => mockRuntimeConfig);

describe('Background Job Store', () => {
    beforeEach(() => {
        resetJobProvider();
        mockRuntimeConfig.backgroundJobs.storageProvider = 'memory';
        mockRuntimeConfig.public.sync.convexUrl = '';
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('returns memory provider by default', async () => {
        const provider = await getJobProvider();
        expect(provider).toBe(memoryJobProvider);
    });

    it('returns memory provider when configured explicitly', async () => {
        mockRuntimeConfig.backgroundJobs.storageProvider = 'memory';
        const provider = await getJobProvider();
        expect(provider.name).toBe('memory');
    });

    it('returns memory provider when convex is configured but missing URL', async () => {
        mockRuntimeConfig.backgroundJobs.storageProvider = 'convex';
        // convexUrl is empty string
        const provider = await getJobProvider();
        expect(provider.name).toBe('memory');
    });
});
