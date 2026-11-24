import { createHash } from 'node:crypto';
import { onBeforeUnmount } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    toast: vi.fn(), exchange: vi.fn(), persist: vi.fn(), query: {} as Record<string, string>,
}));
vi.mock('#imports', () => ({
    useRuntimeConfig: () => ({ public: { ssrAuthEnabled: false } }),
    useToast: () => ({ add: mocks.toast }),
}));
vi.mock('~/composables/auth/useSessionContext', () => ({ useSessionContext: vi.fn() }));
vi.mock('~/core/auth/useUserApiKey', () => ({
    persistUserApiKey: mocks.persist, refreshOpenRouterConnection: vi.fn(), disconnectOpenRouterConnection: vi.fn(),
}));
vi.mock('~/core/auth/openrouter-auth', () => ({ exchangeOpenRouterCode: mocks.exchange }));

import Callback from '../openrouter-callback.vue';
import { useOpenRouterAuth } from '~/core/auth/useOpenrouter';
let capture: typeof import('~/plugins/openrouter-capture.client').default;

const wrappers: VueWrapper[] = [];
async function beginFlow() {
    const originalWindow = window;
    const assign = vi.fn();
    vi.stubGlobal('window', { location: { origin: originalWindow.location.origin, assign } });
    try { await useOpenRouterAuth().startLogin(); }
    finally { vi.stubGlobal('window', originalWindow); }
    return new URL(assign.mock.calls[0]![0] as string);
}
function land(state: string, code = 'returned-code') {
    window.history.replaceState(null, '', `/openrouter-callback?code=${code}&state=${state}`);
    (capture as unknown as () => void)();
}
async function showCallback() {
    const wrapper = mount(Callback, { global: { config: { errorHandler: vi.fn() } } });
    wrappers.push(wrapper);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(10);
    await flushPromises();
    return wrapper;
}

beforeEach(async () => {
    sessionStorage.clear(); localStorage.clear();
    vi.useFakeTimers();
    mocks.query = {};
    mocks.persist.mockReset().mockResolvedValue(undefined);
    mocks.exchange.mockReset().mockResolvedValue({ ok: true, status: 200, userKey: 'sk-or-fixture-key-only' });
    mocks.toast.mockClear();
    vi.stubGlobal('defineNuxtPlugin', (plugin: unknown) => plugin);
    vi.stubGlobal('onBeforeUnmount', onBeforeUnmount);
    vi.stubGlobal('useIcon', (name: string) => name);
    vi.stubGlobal('useRuntimeConfig', () => ({ public: { ssrAuthEnabled: false } }));
    vi.stubGlobal('useRoute', () => ({ query: mocks.query }));
    vi.stubGlobal('useRouter', () => ({ replace: vi.fn().mockResolvedValue(undefined) }));
    capture = (await import('~/plugins/openrouter-capture.client')).default;
});
afterEach(() => {
    wrappers.splice(0).forEach(wrapper => wrapper.unmount());
    vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('OpenRouter callback attempt ownership', () => {
    it('finishes the captured callback after its query parameters have been removed', async () => {
        const flow = await beginFlow();
        land(flow.searchParams.get('state')!);
        expect(window.location.search).toBe('');
        const wrapper = await showCallback();

        expect(mocks.persist).toHaveBeenCalledWith('sk-or-fixture-key-only');
        expect(wrapper.text()).toContain('Login complete');
        const verifier = mocks.exchange.mock.calls[0]![0].verifier as string;
        expect(createHash('sha256').update(verifier).digest('base64url')).toBe(flow.searchParams.get('code_challenge'));
        expect(localStorage.getItem('openrouter_code_verifier')).toBeNull();
        expect(localStorage.getItem('openrouter_auth_code')).toBeNull();
    });

    it('keeps returned state separate from the expected state during early capture', async () => {
        await beginFlow();
        land('different-returned-state');
        mocks.query = { code: 'returned-code', state: 'different-returned-state' };
        const wrapper = await showCallback();

        expect(mocks.exchange).not.toHaveBeenCalled();
        expect(mocks.persist).not.toHaveBeenCalled();
        expect(wrapper.text()).toContain('This connection attempt could not be verified');
    });

    it('offers recovery when tab storage access is denied on return or retry', async () => {
        const flow = await beginFlow();
        const state = flow.searchParams.get('state')!;
        vi.spyOn(globalThis, 'sessionStorage', 'get').mockImplementation(() => {
            throw new DOMException('Storage denied', 'SecurityError');
        });
        land(state);
        mocks.query = { code: 'returned-code', state };
        const wrapper = await showCallback();

        expect(wrapper.text()).toContain('OpenRouter connection not completed');
        expect(wrapper.find('[aria-busy]').attributes('aria-busy')).toBe('false');
        await wrapper.findAll('button').find(button => button.text() === 'Try again')!.trigger('click');
        await vi.waitFor(() => expect(wrapper.find('[aria-busy]').attributes('aria-busy')).toBe('false'));
        expect(wrapper.text()).toContain('Could not start the connection again');
        expect(mocks.exchange).not.toHaveBeenCalled();
    });

    it('does not replay a used code when marker cleanup is denied', async () => {
        const flow = await beginFlow(); land(flow.searchParams.get('state')!);
        vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
            throw new DOMException('Cleanup denied', 'SecurityError');
        });
        const first = await showCallback();
        expect(first.text()).toContain('Login complete');
        const second = await showCallback();
        expect(second.text()).toContain('OpenRouter connection not completed');
        expect(mocks.exchange).toHaveBeenCalledTimes(1);
        expect(mocks.persist).toHaveBeenCalledTimes(1);
    });

    it('starts a fresh authorization after a transient exchange failure', async () => {
        mocks.exchange.mockResolvedValueOnce({ ok: false, status: 503, reason: 'bad-response', errorCode: 'ERR_NETWORK' });
        const original = await beginFlow(); land(original.searchParams.get('state')!);
        const wrapper = await showCallback();
        expect(wrapper.text()).toContain('The connection could not be completed');
        const originalWindow = window;
        const assign = vi.fn();
        vi.stubGlobal('window', { location: { origin: originalWindow.location.origin, assign },
            MouseEvent: originalWindow.MouseEvent, Event: originalWindow.Event });
        try {
            await wrapper.findAll('button').find(button => button.text() === 'Try again')!.trigger('click');
            await vi.waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
            const next = new URL(assign.mock.calls[0]![0] as string);
            expect(next.searchParams.get('state')).not.toBe(original.searchParams.get('state'));
            expect(mocks.exchange).toHaveBeenCalledTimes(1);
            expect(mocks.persist).not.toHaveBeenCalled();
        } finally { vi.stubGlobal('window', originalWindow); }
    });

    it('does not save an older exchange or clear a newer tab attempt', async () => {
        let finish!: (value: unknown) => void;
        mocks.exchange.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        const first = await beginFlow(); land(first.searchParams.get('state')!);
        const wrapper = await showCallback();
        const next = await beginFlow();
        finish({ ok: true, status: 200, userKey: 'sk-or-old-attempt-key' });
        await flushPromises();

        expect(mocks.persist).not.toHaveBeenCalled();
        expect(wrapper.text()).toContain('A newer connection attempt has started');
        expect(JSON.parse(sessionStorage.getItem('openrouter_code_verifier')!).state).toBe(next.searchParams.get('state'));
    });

    it.each(['session', 'local'] as const)('finishes a legacy %s attempt without clearing another tab’s newer markers', async storage => {
        const source = storage === 'session' ? sessionStorage : localStorage;
        source.setItem('openrouter_code_verifier', 'legacy-verifier'); source.setItem('openrouter_state', 'legacy-state');
        land('legacy-state');
        localStorage.setItem('openrouter_state', 'other-tab-state');
        localStorage.setItem('openrouter_code_verifier', 'other-tab-verifier');
        const wrapper = await showCallback();

        expect(wrapper.text()).toContain('Login complete');
        expect(mocks.exchange).toHaveBeenCalledWith(expect.objectContaining({ code: 'returned-code', verifier: 'legacy-verifier' }));
        expect(localStorage.getItem('openrouter_state')).toBe('other-tab-state');
        expect(localStorage.getItem('openrouter_code_verifier')).toBe('other-tab-verifier');
    });
});
