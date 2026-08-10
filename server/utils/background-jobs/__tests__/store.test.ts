import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerBackgroundJobProvider, resetBackgroundJobProviders } from '../registry';
import { getJobProvider, resetJobProvider } from '../store';
import type { BackgroundJobProvider } from '../types';

describe('background job provider selection', () => {
    beforeEach(() => {
        resetJobProvider();
        resetBackgroundJobProviders();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        resetJobProvider();
        resetBackgroundJobProviders();
    });

    it('uses a registered durable provider without falling back to memory', async () => {
        const provider = { name: 'sqlite' } as BackgroundJobProvider;
        registerBackgroundJobProvider('sqlite', provider);
        vi.stubGlobal('useRuntimeConfig', () => ({
            backgroundJobs: { storageProvider: 'sqlite' }
        }));

        await expect(getJobProvider()).resolves.toBe(provider);
    });

    it('fails fast when an explicitly configured provider is unavailable', async () => {
        vi.stubGlobal('useRuntimeConfig', () => ({
            backgroundJobs: { storageProvider: 'sqlite' }
        }));

        await expect(getJobProvider()).rejects.toThrow('Provider "sqlite" is not registered');
    });
});
