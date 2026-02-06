import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest';
import type { H3Event } from 'h3';
import { ClerkTokenBroker } from '../clerk-token-broker';

function makeEvent(authImpl?: () => unknown): H3Event {
    return {
        context: {
            auth: authImpl,
        },
    } as H3Event;
}

describe('ClerkTokenBroker', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    beforeEach(() => {
        errorSpy.mockClear();
        warnSpy.mockClear();
    });

    afterAll(() => {
        vi.restoreAllMocks();
    });

    it('returns null when event.context.auth is missing', async () => {
        const broker = new ClerkTokenBroker();
        const token = await broker.getProviderToken(makeEvent(undefined), {
            providerId: 'convex',
            template: 'convex-sync',
        });

        expect(token).toBeNull();
    });

    it('returns null for invalid auth context shape', async () => {
        const broker = new ClerkTokenBroker();
        const token = await broker.getProviderToken(
            makeEvent(() => ({ notGetToken: true })),
            { providerId: 'convex', template: 'convex-sync' }
        );

        expect(token).toBeNull();
        expect(errorSpy).toHaveBeenCalledWith('[token-broker:clerk] Invalid auth context shape');
    });

    it('rejects empty or whitespace-only tokens', async () => {
        const broker = new ClerkTokenBroker();
        const getTokenMock = vi.fn().mockResolvedValue('   ');

        const token = await broker.getProviderToken(
            makeEvent(() => ({ getToken: getTokenMock })),
            { providerId: 'convex', template: 'convex-sync' }
        );

        expect(token).toBeNull();
        expect(warnSpy).toHaveBeenCalledWith('[token-broker:clerk] Empty token returned');
    });

    it('mints token and forwards template on happy path', async () => {
        const broker = new ClerkTokenBroker();
        const getTokenMock = vi.fn().mockResolvedValue('jwt-token');

        const token = await broker.getProviderToken(
            makeEvent(() => ({ getToken: getTokenMock })),
            { providerId: 'convex', template: 'convex-sync' }
        );

        expect(token).toBe('jwt-token');
        expect(getTokenMock).toHaveBeenCalledWith({ template: 'convex-sync' });
    });

    it('returns null when getToken throws', async () => {
        const broker = new ClerkTokenBroker();
        const getTokenMock = vi.fn().mockRejectedValue(new Error('boom'));

        const token = await broker.getProviderToken(
            makeEvent(() => ({ getToken: getTokenMock })),
            { providerId: 'convex', template: 'convex-sync' }
        );

        expect(token).toBeNull();
        expect(errorSpy).toHaveBeenCalled();
    });
});
