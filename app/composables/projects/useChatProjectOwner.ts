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
import {
    ambiguousChatProjects,
    resolveChatProject,
} from '~/db/project-workspace';
import type { Or3DB } from '~/db/client';

type Owner = {
    threadId: () => string | undefined;
    projectId: Readonly<Ref<string | null>>;
};
const ownerKey: InjectionKey<Owner> = Symbol('chat-project-owner');

/** A live read of one chat, rebound when the chat or active workspace changes. */
function observeChat<T>(
    threadId: Owner['threadId'],
    initial: T,
    read: (db: Or3DB, id: string) => Promise<T>,
): Ref<T> {
    const value = ref(initial) as Ref<T>;
    let subscription: Subscription | undefined;
    let revision = 0;
    function bind() {
        subscription?.unsubscribe();
        value.value = initial;
        const currentRevision = ++revision;
        const id = threadId();
        if (!id) return;
        const db = getDb();
        const generation = getWorkspaceGeneration();
        subscription = liveQuery(() => read(db, id)).subscribe((next) => {
            if (
                revision === currentRevision &&
                db === getDb() &&
                generation === getWorkspaceGeneration() &&
                threadId() === id
            )
                value.value = next;
        });
    }
    watch(threadId, bind, { immediate: true });
    const stopWorkspace = subscribeActiveWorkspaceDb(bind);
    onBeforeUnmount(() => {
        revision++;
        subscription?.unsubscribe();
        stopWorkspace();
    });
    return value;
}

function observeOwner(threadId: Owner['threadId']): Owner['projectId'] {
    return observeChat<string | null>(threadId, null, (db, id) =>
        resolveChatProject(db, id).catch(() => null),
    );
}

export type ChatProjectChoice = { id: string; name: string };

/** Projects to choose from while a legacy chat is listed in several; empty once its owner is resolved. */
export function useAmbiguousChatProjects(
    threadId: Owner['threadId'],
): Readonly<Ref<ChatProjectChoice[]>> {
    return observeChat<ChatProjectChoice[]>(threadId, [], (db, id) =>
        ambiguousChatProjects(db, id).then(
            (projects) =>
                projects.map((project) => ({
                    id: project.id,
                    name: project.name || 'Untitled project',
                })),
            () => [],
        ),
    );
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
