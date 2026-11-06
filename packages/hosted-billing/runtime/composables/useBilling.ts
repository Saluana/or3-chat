import { computed, onMounted, onScopeDispose, ref, watch } from 'vue';
import { useSessionContext } from '~/composables/auth/useSessionContext';
import type { BillingStatus } from '../types';
import { $fetch } from 'ofetch';

export function useBilling() {
    const session = useSessionContext();
    const userId = computed(() => session.data.value?.session?.user?.id);
    const receivedStatus = ref<BillingStatus | null>(null);
    const now = ref(Date.now());
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    const armDeadline = () => {
        if (deadlineTimer) clearTimeout(deadlineTimer);
        now.value = Date.now();
        const value = receivedStatus.value;
        const deadline = value?.accessExpiresAt ?? (value?.state === 'active' ? value.paidUntil : value?.trialEndsAt ?? 0);
        if (value?.allowed && deadline > now.value) deadlineTimer = setTimeout(armDeadline, Math.min(deadline - now.value + 1, 2_147_483_647));
    };
    watch(receivedStatus, armDeadline);
    const status = computed<BillingStatus | null>(() => {
        const value = receivedStatus.value;
        if (!value?.allowed) return value;
        const deadline = value.accessExpiresAt ?? (value.state === 'active' ? value.paidUntil : value.trialEndsAt);
        return deadline <= now.value ? { ...value, allowed: false,
            state: value.paidUntil ? 'payment_required' : 'expired', storageLimitBytes: 0 } : value;
    });
    const error = ref('');
    const busy = ref(false);
    let generation = 0;
    let identityGeneration = 0;
    let controller: AbortController | undefined;
    let reconciling = false;

    async function refresh(reconcile = false) {
        const owner = userId.value;
        if (typeof window === 'undefined' || !owner) return;
        // Mount, focus and interval reads must not cancel a Checkout return or
        // an explicit refresh that is checking the current Stripe state.
        if (!reconcile && reconciling) return;
        const request = ++generation;
        controller?.abort();
        controller = new AbortController();
        reconciling = reconcile;
        try {
            const next = await $fetch<BillingStatus>(`/api/billing/${reconcile ? 'refresh' : 'status'}`, {
                method: reconcile ? 'POST' : 'GET',
                ...(reconcile ? { headers: { 'x-or3-cloud-intent': 'mutation' }, body: {} } : {}),
                signal: controller.signal, retry: 0,
            });
            if (request !== generation || userId.value !== owner || next.userId !== owner) return;
            receivedStatus.value = next;
            error.value = '';
            const access = session.data.value?.cloudAccess;
            const expiresAt = next.accessExpiresAt ?? (next.state === 'active' ? next.paidUntil : next.trialEndsAt);
            if (reconcile || access?.enabled !== next.allowed || access?.expiresAt !== expiresAt) await session.refresh();
        } catch {
            if (request === generation && userId.value === owner) error.value = 'Could not check your subscription. Please try again.';
        } finally { if (request === generation) reconciling = false; }
    }
    watch(userId, () => {
        identityGeneration++;
        generation++;
        controller?.abort();
        reconciling = false;
        receivedStatus.value = null;
        error.value = '';
        busy.value = false;
        void refresh();
    });
    let timer: ReturnType<typeof setInterval> | undefined;
    const onFocus = () => { void refresh(); };
    onMounted(() => {
        void refresh();
        timer = setInterval(() => { if (!document.hidden && !busy.value) void refresh(); }, 60_000);
        window.addEventListener('focus', onFocus);
    });
    onScopeDispose(() => {
        identityGeneration++;
        generation++;
        controller?.abort();
        if (timer) clearInterval(timer);
        if (deadlineTimer) clearTimeout(deadlineTimer);
        if (typeof window !== 'undefined') window.removeEventListener('focus', onFocus);
    });
    async function redirect(action: 'checkout' | 'portal') {
        if (busy.value || !userId.value) return;
        const owner = userId.value;
        const identity = identityGeneration;
        busy.value = true;
        error.value = '';
        try {
            const result = await $fetch<{ url: string }>(`/api/billing/${action}`, {
                method: 'POST', headers: { 'x-or3-cloud-intent': 'mutation' }, body: {}, retry: 0,
            });
            if (owner !== userId.value || identity !== identityGeneration) return;
            const url = new URL(result.url);
            if (url.protocol !== 'https:' || !['checkout.stripe.com', 'billing.stripe.com'].includes(url.hostname)) throw new Error('Unexpected billing URL');
            window.location.assign(url.href);
        } catch {
            if (owner === userId.value && identity === identityGeneration) error.value = 'Could not open billing. Please try again or contact support.';
        } finally { if (owner === userId.value && identity === identityGeneration) busy.value = false; }
    }
    return { status, userId, error, busy, refresh, redirect };
}
