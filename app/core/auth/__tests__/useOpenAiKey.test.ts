import { effectScope, ref } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ session: null as unknown, cloud: true }));
vi.mock('#imports', () => ({
    useRuntimeConfig: () => ({ public: { ssrAuthEnabled: state.cloud } }),
    useState: () => state.session,
}));
vi.mock('~/db/kv', () => ({ getKvByName: vi.fn(), setKvByName: vi.fn(), hardDeleteKvByName: vi.fn() }));
vi.mock('~/db/client', () => ({ getWorkspaceGeneration: () => 0, subscribeActiveWorkspaceDb: () => () => {} }));

import { useOpenAiKey } from '../useOpenAiKey';

function session(id: string) {
    return { session: { authenticated: true, provider: 'test', user: { id }, workspace: { id: `workspace-${id}` } } };
}

describe('OpenAI connection scope', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('hides the previous account and ignores an older in-flight response', async () => {
        const current = ref(session('first'));
        state.session = current;
        const resolvers: Array<(value: unknown) => void> = [];
        vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => resolvers.push(resolve))));
        const scope = effectScope();
        const key = scope.run(() => useOpenAiKey())!;
        const first = key.refresh();
        current.value = session('second');
        expect(key.connection.value.connected).toBe(false);
        const second = key.refresh();
        resolvers[1]!({ ok: true, json: async () => ({ connected: false, instance: true }) });
        await second;
        resolvers[0]!({ ok: true, json: async () => ({ connected: true }) });
        await expect(first).rejects.toThrow(/account or workspace changed/);
        expect(key.connection.value).toEqual({ connected: false, available: true, instance: true });
        scope.stop();
    });

    it('does not let an older status overwrite a later credential change', async () => {
        state.session = ref(session('third'));
        const resolvers: Array<(value: unknown) => void> = [];
        vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => resolvers.push(resolve))));
        const scope = effectScope();
        const key = scope.run(() => useOpenAiKey())!;
        const status = key.refresh();
        const save = key.save('sk-12345678901234567890');
        resolvers[1]!({ ok: true, json: async () => ({ connected: true }) });
        await save;
        resolvers[0]!({ ok: true, json: async () => ({ connected: false }) });
        await status;
        expect(key.connection.value.connected).toBe(true);
        scope.stop();
    });

    it('keeps the saved result when a status request overlaps the save', async () => {
        state.session = ref(session('fourth'));
        const resolvers: Array<(value: unknown) => void> = [];
        vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => resolvers.push(resolve))));
        const scope = effectScope();
        const key = scope.run(() => useOpenAiKey())!;
        const save = key.save('sk-12345678901234567890');
        const status = key.refresh();
        resolvers[0]!({ ok: true, json: async () => ({ connected: true }) });
        await save;
        resolvers[1]!({ ok: true, json: async () => ({ connected: false }) });
        await status;
        expect(key.connection.value.connected).toBe(true);
        scope.stop();
    });
});
