import { inject, onBeforeUnmount, provide, shallowRef, watch, type InjectionKey, type Ref } from 'vue';
import { liveQuery, type Subscription } from 'dexie';
import { getDb, getWorkspaceGeneration, subscribeActiveWorkspaceDb } from '~/db/client';

type BranchAnchors = { threadId: () => string | undefined; anchors: Readonly<Ref<ReadonlySet<string> | null>> };
const key: InjectionKey<BranchAnchors> = Symbol('chat-branch-anchors');

/** Shares the active chat's branch anchors across its message rows. */
export function provideChatBranchAnchors(threadId: BranchAnchors['threadId']) {
    const anchors = shallowRef<ReadonlySet<string> | null>(new Set());
    let subscription: Subscription | undefined;
    let revision = 0;
    function bind() {
        subscription?.unsubscribe();
        anchors.value = new Set();
        const token = ++revision;
        const id = threadId();
        if (!id) return;
        const db = getDb();
        const generation = getWorkspaceGeneration();
        subscription = liveQuery(async () => {
            const rows = await db.threads.where('parent_thread_id').equals(id).toArray();
            return new Set(rows.filter(row => !row.deleted && row.anchor_message_id).map(row => row.anchor_message_id!));
        }).subscribe({ next: next => {
            if (token === revision && db === getDb() && generation === getWorkspaceGeneration() && threadId() === id)
                anchors.value = next;
        }, error: () => {
            if (token === revision && db === getDb() && generation === getWorkspaceGeneration() && threadId() === id)
                anchors.value = null;
        } });
    }
    watch(threadId, bind, { immediate: true });
    const stopWorkspace = subscribeActiveWorkspaceDb(bind);
    onBeforeUnmount(() => { revision++; subscription?.unsubscribe(); stopWorkspace(); });
    provide(key, { threadId, anchors });
}

export function useChatBranchAnchors() { return inject(key, undefined); }
