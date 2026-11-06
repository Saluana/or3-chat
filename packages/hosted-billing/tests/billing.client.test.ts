import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, nextTick, ref } from 'vue';
import type { BillingStatus } from '../runtime/types';
import { useBilling } from '../runtime/composables/useBilling';

const fetch = vi.hoisted(() => vi.fn());
const session = ref({ session: { user: { id: 'alice' } } });
vi.mock('ofetch', () => ({ $fetch: fetch }));
vi.mock('~/composables/auth/useSessionContext', () => ({ useSessionContext: () => ({ data: session, refresh: vi.fn() }) }));

describe('billing account switching', () => {
    let unmount: (() => void) | undefined;
    beforeEach(() => { session.value = { session: { user: { id: 'alice' } } }; });
    afterEach(() => { unmount?.(); fetch.mockReset(); });
    it('clears the old account immediately and discards its late response, including after logout', async () => {
        const pending: Array<(value: BillingStatus) => void> = [];
        fetch.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
        let billing!: ReturnType<typeof useBilling>;
        const app = createApp(defineComponent({ setup() { billing = useBilling(); return () => null; } }));
        const host = document.createElement('div');
        document.body.append(host);
        app.mount(host);
        unmount = () => { app.unmount(); host.remove(); };
        session.value = { session: { user: { id: 'bob' } } };
        await nextTick();
        pending[1]!({ userId: 'bob', state: 'expired' } as BillingStatus);
        await nextTick();
        expect(billing.status.value?.userId).toBe('bob');
        pending[0]!({ userId: 'alice', state: 'active' } as BillingStatus);
        await nextTick();
        expect(billing.status.value).toMatchObject({ userId: 'bob', state: 'expired' });
        session.value = { session: { user: { id: '' } } };
        await nextTick();
        expect(billing.status.value).toBeNull();
    });

    it('finishes Checkout reconciliation despite mount and focus status checks', async () => {
        let complete!: (value: BillingStatus) => void;
        const paid = { userId: 'alice', state: 'active', allowed: true,
            paidUntil: Date.now() + 86_400_000 } as BillingStatus;
        fetch.mockImplementation((url: string, options: { signal: AbortSignal }) => {
            if (url.endsWith('/refresh')) return new Promise((resolve, reject) => {
                complete = resolve;
                options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
            });
            return Promise.resolve({ userId: 'alice', state: 'trial' } as BillingStatus);
        });
        let billing!: ReturnType<typeof useBilling>;
        let reconciliation!: Promise<void>;
        const app = createApp(defineComponent({ setup() {
            billing = useBilling();
            // BillingPanel requests this during setup on a Checkout return.
            reconciliation = billing.refresh(true);
            return () => null;
        } }));
        const host = document.createElement('div');
        document.body.append(host);
        app.mount(host);
        unmount = () => { app.unmount(); host.remove(); };
        window.dispatchEvent(new Event('focus'));
        complete(paid);
        await reconciliation;
        await nextTick();
        expect(billing.status.value).toMatchObject({ userId: 'alice', state: 'active', allowed: true });
        expect(billing.error.value).toBe('');
    });
});
