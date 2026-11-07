import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearWorkspaceChatLimitsCache, resolveWorkspaceChatLimits } from '../workspace-chat-limits';

const limits = { toolIterations: 4, generatedImages: 2 };

afterEach(() => {
    clearWorkspaceChatLimitsCache();
    vi.useRealTimers();
});

describe('workspace chat limits', () => {
    it('reuses fresh limits instead of adding a lookup to every send', async () => {
        const load = vi.fn(async () => limits);
        expect(await resolveWorkspaceChatLimits('ws-1', load)).toEqual(limits);
        expect(await resolveWorkspaceChatLimits('ws-1', load)).toEqual(limits);
        expect(load).toHaveBeenCalledTimes(1);
        await resolveWorkspaceChatLimits('ws-2', load);
        expect(load).toHaveBeenCalledTimes(2);
    });

    it('keeps the last known workspace limits when a later refresh fails', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
        await resolveWorkspaceChatLimits('ws-1', async () => limits);
        vi.setSystemTime(1_000_000 + 61_000);
        const failing = vi.fn(async () => { throw new Error('503'); });
        expect(await resolveWorkspaceChatLimits('ws-1', failing)).toEqual(limits);
        expect(failing).toHaveBeenCalledTimes(1);
    });

    it('surfaces a failure when the workspace has no known limits', async () => {
        await expect(resolveWorkspaceChatLimits('ws-1', async () => { throw new Error('503'); })).rejects.toThrow('503');
        await expect(resolveWorkspaceChatLimits('ws-1', async () => ({ toolIterations: 0 }))).rejects.toThrow();
    });

    it('reports Stop as a cancellation and passes the signal to the request', async () => {
        await resolveWorkspaceChatLimits('ws-1', async () => limits);
        vi.useFakeTimers();
        vi.setSystemTime(Date.now() + 61_000);
        const controller = new AbortController();
        const load = vi.fn(async (signal?: AbortSignal) => {
            controller.abort();
            throw Object.assign(new Error('fetch aborted'), { cause: signal?.reason });
        });
        await expect(resolveWorkspaceChatLimits('ws-1', load, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
        expect(load).toHaveBeenCalledWith(controller.signal);
    });
});
