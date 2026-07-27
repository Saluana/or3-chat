import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RateLimitProvider } from '../types';

const mocks = vi.hoisted(() => ({
    storageProvider: 'convex',
    registeredProvider: null as RateLimitProvider | null,
}));

vi.mock('../registry', () => ({
    getRateLimitProviderById: () => mocks.registeredProvider,
}));

import {
    getRateLimitProvider,
    resetRateLimitProvider,
} from '../store';

const sharedProvider: RateLimitProvider = {
    name: 'shared-test',
    checkAndRecord: vi.fn(),
    getStats: vi.fn(),
};

describe('rate-limit provider resolution', () => {
    beforeEach(() => {
        resetRateLimitProvider();
        mocks.storageProvider = 'convex';
        mocks.registeredProvider = null;
        (globalThis as typeof globalThis & {
            useRuntimeConfig: () => {
                limits: { storageProvider: string };
            };
        }).useRuntimeConfig = () => ({
            limits: {
                storageProvider: mocks.storageProvider,
            },
        });
    });

    it('upgrades a temporary memory fallback after the shared provider registers', () => {
        expect(getRateLimitProvider().name).toBe('memory');

        mocks.registeredProvider = sharedProvider;

        expect(getRateLimitProvider()).toBe(sharedProvider);
    });

    it('caches a registered shared provider once resolved', () => {
        mocks.registeredProvider = sharedProvider;
        expect(getRateLimitProvider()).toBe(sharedProvider);

        mocks.registeredProvider = null;
        expect(getRateLimitProvider()).toBe(sharedProvider);
    });
});
