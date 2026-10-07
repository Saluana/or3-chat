import {
    computed,
    inject,
    onBeforeUnmount,
    provide,
    ref,
    watch,
    type InjectionKey,
    type Ref,
} from 'vue';
import { liveQuery, type Subscription } from 'dexie';
import {
    getDb,
    getWorkspaceGeneration,
    subscribeActiveWorkspaceDb,
} from '~/db/client';
import { resolveChatProject } from '~/db/project-workspace';

type Owner = {
    threadId: () => string | undefined;
    projectId: Readonly<Ref<string | null>>;
};
const ownerKey: InjectionKey<Owner> = Symbol('chat-project-owner');

function observeOwner(threadId: Owner['threadId']): Owner['projectId'] {
    const projectId = ref<string | null>(null);
    let subscription: Subscription | undefined;
    let revision = 0;
    function bind() {
        subscription?.unsubscribe();
        projectId.value = null;
        const currentRevision = ++revision;
        const id = threadId();
        if (!id) return;
        const db = getDb();
        const generation = getWorkspaceGeneration();
        subscription = liveQuery(() =>
            resolveChatProject(db, id).catch(() => null),
        ).subscribe((owner) => {
            if (
                revision === currentRevision &&
                db === getDb() &&
                generation === getWorkspaceGeneration() &&
                threadId() === id
            )
                projectId.value = owner;
        });
    }
    watch(threadId, bind, { immediate: true });
    const stopWorkspace = subscribeActiveWorkspaceDb(bind);
    onBeforeUnmount(() => {
        revision++;
        subscription?.unsubscribe();
        stopWorkspace();
    });
    return projectId;
}

/** One ownership subscription serves the composer and every message in a chat. */
export function provideChatProjectOwner(threadId: Owner['threadId']) {
    const projectId = observeOwner(threadId);
    provide(ownerKey, { threadId, projectId });
    return projectId;
}

/** Standalone composers may also observe ownership without a chat container. */
export function useChatProjectOwner(threadId: Owner['threadId']) {
    const owner = inject(ownerKey, undefined);
    if (!owner) return observeOwner(threadId);
    return computed(() =>
        owner.threadId() === threadId() ? owner.projectId.value : null,
    );
}
