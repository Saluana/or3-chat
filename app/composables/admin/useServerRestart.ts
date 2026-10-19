import { computed, getCurrentInstance, onBeforeUnmount, onMounted, watch, type Ref, type ComputedRef } from 'vue';
import { useState, useToast, refreshNuxtData } from '#imports';
import { ADMIN_HEADERS } from './useAdminExtensions';
import { useConfirmDialog } from './useConfirmDialog';
import { parseErrorMessage } from '~/utils/admin/parse-error';
import { restartTerminalPhases, type RestartOperation, type RestartStatus } from '~~/shared/admin/restarts';

const observationKey = 'or3:admin:restart-observation';
type Observation = { requestId: string; startedAt: number };
const labels: Record<string, string> = {
    preparing: 'Waiting for active work to finish…', draining: 'Finishing requests…',
    restarting: 'Restarting the server…', verifying: 'Checking the new server…',
    succeeded: 'Server restarted and verified.', cancelled: 'Restart cancelled. Active work was left running.',
    failed: 'Restart failed. Check Operations before trying again.', needs_attention: 'Restart needs attention. Inspect the server terminal or deployment diagnostics before retrying.',
};

/** Shared observation survives route changes/reloads. Reconnection only reads status. */
export function useServerRestart(isOwner: Ref<boolean> | ComputedRef<boolean>, allowRestart?: Ref<boolean | undefined> | ComputedRef<boolean | undefined>) {
    const { confirm } = useConfirmDialog();
    const toast = useToast();
    const status = useState<RestartStatus | null>('admin:restart:status', () => null);
    const observation = useState<Observation | null>('admin:restart:observation', () => null);
    const submitting = useState('admin:restart:submitting', () => false);
    const restartRequired = useState('admin:restart:required', () => false);
    const message = useState('admin:restart:message', () => '');
    const announced = useState<string | null>('admin:restart:announced', () => null);
    const operation = computed<RestartOperation | null>(() => status.value?.operation ?? null);
    const busy = computed(() => submitting.value || Boolean(observation.value && (!operation.value || !restartTerminalPhases.has(operation.value.phase))));
    const canRestart = computed(() => isOwner.value && allowRestart?.value !== false && status.value?.capability.restart === true
        && operation.value?.phase !== 'needs_attention' && !busy.value);
    const progress = computed(() => message.value || (operation.value ? labels[operation.value.phase] ?? 'Restart accepted…' : ''));

    function remember(value: Observation | null) {
        observation.value = value;
        if (typeof window === 'undefined') return;
        try { if (value) localStorage.setItem(observationKey, JSON.stringify(value)); else localStorage.removeItem(observationKey); } catch { /* In-memory observation still works. */ }
    }
    function restore() {
        if (typeof window === 'undefined' || observation.value) return;
        try {
            const value: unknown = JSON.parse(localStorage.getItem(observationKey) ?? 'null');
            if (value && typeof value === 'object' && 'requestId' in value && typeof value.requestId === 'string'
                && /^[0-9a-f-]{36}$/i.test(value.requestId) && 'startedAt' in value && typeof value.startedAt === 'number' && Number.isFinite(value.startedAt)) {
                observation.value = { requestId: value.requestId, startedAt: value.startedAt };
            }
        } catch { /* Ignore malformed, non-authoritative browser metadata. */ }
    }
    async function refresh() {
        if (!isOwner.value) return;
        restore();
        try {
            const observed = await $fetch<RestartStatus>('/api/admin/system/restart-status', {
                query: observation.value ? { requestId: observation.value.requestId } : undefined, timeout: 4_000, retry: 0,
            });
            status.value = observed; message.value = '';
            const o = observed.operation;
            if (o && !restartTerminalPhases.has(o.phase) && !observation.value) remember({ requestId: o.requestId, startedAt: Date.parse(o.createdAt) });
            if (o?.phase === 'succeeded') {
                if (!o.observedBootId || o.observedBootId === o.originalBootId || observed.bootId !== o.observedBootId || observed.activeRevision !== o.targetRevision) {
                    message.value = 'Waiting for verified server identity…'; return;
                }
                restartRequired.value = false;
                const wasObserving = observation.value?.requestId === o.requestId;
                remember(null);
                if (wasObserving && announced.value !== o.requestId) {
                    announced.value = o.requestId;
                    toast.add({ title: 'Server restarted', description: 'The new server is healthy and its settings are verified.', color: 'success' });
                    await refreshNuxtData(['admin:system:status', 'admin:system:config:enriched']);
                }
            } else if (o && restartTerminalPhases.has(o.phase)) remember(null);
            if (observation.value && Date.now() - observation.value.startedAt > 9 * 60_000) {
                message.value = 'Observation timed out. Recheck Operations; no additional restart was submitted.';
            }
        } catch (error: unknown) {
            const code = (error as { statusCode?: number } | null | undefined)?.statusCode;
            message.value = code === 401 || code === 403 ? 'Sign in again to observe this restart.'
                : observation.value ? 'Waiting for the server to reconnect…' : 'Restart status is unavailable.';
            if (code !== 401 && code !== 403 && observation.value && Date.now() - observation.value.startedAt > 9 * 60_000) {
                message.value = 'Observation timed out. Recheck Operations before taking further action.';
            }
        }
    }
    async function restart(target: 'current' | 'saved' = 'current') {
        if (!isOwner.value || allowRestart?.value === false || busy.value) return;
        await refresh();
        if (!canRestart.value || !status.value?.activeRevision || !status.value.savedRevision) return;
        if (target === 'saved' && !status.value.capability.applySaved) return;
        // Polling may observe another administrator's save while this dialog is
        // open. Only submit the revision this confirmation was opened for.
        const confirmedTarget = target === 'saved'
            ? { kind: 'saved' as const, savedRevision: status.value.savedRevision }
            : { kind: 'current' as const, activeRevision: status.value.activeRevision };
        const confirmed = await confirm({ title: target === 'saved' ? 'Apply saved settings and restart' : 'Restart Server',
            message: target === 'saved' ? 'Apply the saved configuration after active work finishes? OR3 will briefly be unavailable.'
                : 'Restart after active work finishes? OR3 will briefly be unavailable. Keep this page open to follow progress.',
            danger: true, confirmText: target === 'saved' ? 'Apply and restart' : 'Restart' });
        if (!confirmed) return;
        const requestId = crypto.randomUUID();
        submitting.value = true; message.value = ''; remember({ requestId, startedAt: Date.now() });
        try {
            const result = await $fetch<{ operation: RestartOperation }>('/api/admin/system/restart', {
                method: 'POST', headers: ADMIN_HEADERS, timeout: 5_000, retry: 0,
                body: { requestId, policy: 'wait', target: confirmedTarget },
            });
            status.value = { ...status.value, operation: result.operation };
        } catch (error: unknown) {
            const code = (error as { statusCode?: number } | null | undefined)?.statusCode;
            const refusal = code && code >= 400 && code < 500 ? parseErrorMessage(error, 'Restart was refused. Refresh Operations and try again.') : null;
            if (refusal) remember(null);
            // A transport failure can follow durable acceptance. Read with the same
            // identity; never generate another request automatically.
            await refresh();
            if (refusal) message.value = refusal;
        } finally { submitting.value = false; }
    }
    async function reconcile() {
        if (!isOwner.value || busy.value || operation.value?.phase !== 'needs_attention') return;
        if (!await confirm({ title: 'Recheck restart', message: 'Verify the existing restart receipt. This does not stop the server or repeat the restart.', confirmText: 'Recheck' })) return;
        submitting.value = true;
        try {
            await $fetch('/api/admin/system/restart-reconcile', { method: 'POST', headers: ADMIN_HEADERS, body: { requestId: operation.value.requestId }, timeout: 35_000, retry: 0 });
            await refresh();
        } catch { message.value = 'The restart could not be verified. Inspect the source terminal or use the managed recovery guide.'; }
        finally { submitting.value = false; }
    }
    async function cancel() {
        if (!isOwner.value || submitting.value || operation.value?.phase !== 'preparing') return;
        submitting.value = true;
        try {
            await $fetch('/api/admin/system/restart-cancel', { method: 'POST', headers: ADMIN_HEADERS, body: { requestId: operation.value.requestId }, timeout: 5000, retry: 0 });
            await refresh();
        } catch { message.value = 'Cancellation was not confirmed. Continue observing this restart.'; }
        finally { submitting.value = false; }
    }
    if (getCurrentInstance()) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let disposed = false;
        const poll = async () => {
            if (disposed) return;
            await refresh();
            const observing = busy.value && observation.value && Date.now() - observation.value.startedAt <= 9 * 60_000;
            schedulePoll((observing ? 1_000 : 5_000) + Math.random() * 500);
        };
        function schedulePoll(delay: number) {
            // Unmount can run while refresh() is awaiting its response.
            if (!disposed) timer = setTimeout(poll, delay);
        }
        const changed = (event: StorageEvent) => { if (event.key === observationKey) { observation.value = null; restore(); void refresh(); } };
        onMounted(() => { void poll(); window.addEventListener('storage', changed); });
        watch(isOwner, value => { if (value) void refresh(); });
        onBeforeUnmount(() => { disposed = true; clearTimeout(timer); window.removeEventListener('storage', changed); });
    }
    return { restart, cancel, reconcile, refresh, restartRequired, status, operation, busy, canRestart, progress };
}
