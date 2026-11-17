import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { liveQuery } from 'dexie';
import { subscribeActiveWorkspaceDb } from '~/db/client';
import { getCachedSessionContext } from '~/composables/auth/useSessionContext';
import { captureChatMediaScope } from '~/utils/chat/media-scope';
import { hasWorkspaceToolReceipts, workspaceDocumentChangeReceipt, workspaceSourceReceipts } from '~/utils/chat/workspace-source-receipts';
import { parseToolResultArtifact, readToolResultStorage } from '~~/shared/chat/tool-result-artifact';

type ReceiptCall = { name: string; status: string; result?: string };
function receipts(call: ReceiptCall) {
    return { sources: workspaceSourceReceipts(call), documentChange: workspaceDocumentChangeReceipt(call) };
}
type Receipts = ReturnType<typeof receipts>;
const key = (call: ReceiptCall) => `${call.name}:${call.result}`;

/** Resolve only host receipts; keep full tool output out of reactive chat state. */
export function useWorkspaceToolReceipts(calls: () => readonly ReceiptCall[]) {
    const resolved = shallowRef(new Map<string, Receipts>());
    const mounted = ref(false);
    const available = ref(true);
    const controller = new AbortController();
    let scope: ReturnType<typeof captureChatMediaScope> | undefined;
    let stopWorkspace: (() => void) | undefined;
    const retained = computed(() => calls().filter(call => call.status === 'complete'
        && hasWorkspaceToolReceipts(call.name) && call.result && parseToolResultArtifact(call.result)));
    const invalidate = () => {
        available.value = false;
        controller.abort();
        resolved.value = new Map();
    };
    const current = () => {
        try { scope?.assertCurrent(); return !!scope && !controller.signal.aborted; }
        catch { invalidate(); return false; }
    };

    onMounted(() => {
        scope = captureChatMediaScope(undefined, controller.signal);
        stopWorkspace = subscribeActiveWorkspaceDb(invalidate);
        mounted.value = true;
    });
    watch(getCachedSessionContext, () => { if (scope) current(); }, { deep: true });
    watch([mounted, available, () => retained.value.map(key).join('\n')], (_, _previous, onCleanup) => {
        if (!mounted.value || !available.value || !current()) return;
        const pending = new Map(retained.value.map(call => [key(call), call]));
        // Adding another call must not clear controls already visible for earlier
        // results while IndexedDB resolves the new receipt.
        resolved.value = new Map([...resolved.value].filter(([id]) => pending.has(id)));
        if (!pending.size) return;
        const origin = scope!;
        let active = true;
        const subscription = liveQuery(async () => Promise.all([...pending].map(async ([id, call]) => {
            try {
                const result = await readToolResultStorage(call.result!, part => origin.db.kv.get(part));
                origin.assertCurrent();
                return [id, receipts({ ...call, result })] as const;
            } catch {
                // A background result can arrive before its chunks sync. Stay
                // subscribed to those rows; never render an unverified receipt.
                return [id, undefined] as const;
            }
        }))).subscribe({
            next: entries => {
                if (!active || !current()) return;
                resolved.value = new Map(entries.flatMap(([id, value]) => value ? [[id, value]] : []));
            },
            error: () => { if (active) resolved.value = new Map(); },
        });
        onCleanup(() => { active = false; subscription.unsubscribe(); });
    });
    onBeforeUnmount(() => { invalidate(); stopWorkspace?.(); });

    return computed(() => available.value ? calls().flatMap(call => {
        if (call.status !== 'complete' || !hasWorkspaceToolReceipts(call.name)) return [];
        const value = call.result && parseToolResultArtifact(call.result) ? resolved.value.get(key(call)) : receipts(call);
        return value ? [value] : [];
    }) : []);
}
