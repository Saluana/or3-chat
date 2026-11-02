import { computed, onScopeDispose, ref, watch } from 'vue';
import { liveQuery, type Subscription } from 'dexie';
import { getDb, getWorkspaceGeneration, subscribeActiveWorkspaceDb } from '~/db/client';
import { getKvRecordByName, setKvByName } from '~/db/kv';
import { chatToolPreferenceKey, readChatToolPreferences, type ChatToolPreferences } from '~/utils/chat/tool-preferences';

/** Reactive, workspace-owned chat/draft preferences using the same KV store as model overrides. */
export function useChatToolPreferences(options: { threadId: () => string | undefined; draftId?: () => string | undefined }) {
    const preferences = ref<ChatToolPreferences>({ enabled: false, tools: {} });
    const ready = ref(false);
    const saving = ref(false);
    const error = ref('');
    const workspaceRevision = ref(getWorkspaceGeneration());
    const unsubscribe = subscribeActiveWorkspaceDb(() => { workspaceRevision.value = getWorkspaceGeneration(); });
    let subscription: Subscription | undefined;
    let revision = 0;
    const stop = watch(() => [options.threadId(), options.draftId?.(), workspaceRevision.value], () => {
        const token = ++revision;
        subscription?.unsubscribe();
        preferences.value = { enabled: false, tools: {} };
        ready.value = false;
        saving.value = false;
        error.value = '';
        if (import.meta.server) return;
        const db = getDb();
        const threadId = options.threadId();
        const draftId = options.draftId?.();
        subscription = liveQuery(() => readChatToolPreferences(db, threadId, draftId)).subscribe({
            next(value) {
                if (token !== revision) return;
                preferences.value = value;
                ready.value = true;
                error.value = '';
            },
            error() {
                if (token === revision) error.value = 'Could not load tool settings. Reopen chat settings to retry.';
            },
        });
    }, { immediate: true });

    async function update(patch: Partial<ChatToolPreferences>) {
        if (!ready.value || saving.value) return;
        const db = getDb();
        const generation = getWorkspaceGeneration();
        const token = revision;
        const threadId = options.threadId();
        const draftId = options.draftId?.();
        const key = chatToolPreferenceKey(threadId, draftId);
        const current = () => token === revision && db === getDb() && generation === getWorkspaceGeneration();
        saving.value = true;
        error.value = '';
        try {
            const { row } = await getKvRecordByName(key, db);
            const base = await readChatToolPreferences(db, threadId, draftId);
            const next = { enabled: patch.enabled ?? base.enabled, tools: { ...base.tools, ...patch.tools } };
            await setKvByName(key, JSON.stringify(next), db, { isValid: current, ifClock: row?.clock ?? null });
            if (current()) preferences.value = next;
        } catch {
            if (current()) error.value = 'Could not save tool settings. Try the switch again.';
        } finally {
            if (current()) saving.value = false;
        }
    }
    onScopeDispose(() => { revision++; subscription?.unsubscribe(); unsubscribe(); stop(); });
    return {
        preferences: computed(() => preferences.value), ready, saving, error,
        setEnabled: (enabled: boolean) => update({ enabled }),
        setTools: (tools: Record<string, boolean>) => update({ tools }),
    };
}
