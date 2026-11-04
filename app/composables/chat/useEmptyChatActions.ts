import {
    computed,
    inject,
    onScopeDispose,
    provide,
    reactive,
    shallowRef,
    watch,
    type ComputedRef,
    type InjectionKey,
} from 'vue';
import { useToast } from '#imports';
import {
    getWorkspaceGeneration,
    subscribeActiveWorkspaceDb,
} from '~/db/client';
import { captureProjectOperation } from '~/utils/projects/operation';
import type { WorkspaceOperationScope } from '~/utils/chat/workspace-access';
import type { EmptyChatActionId } from '~/theme/_shared/chat-empty-state';

export interface EmptyChatOrigin {
    paneId: string;
    tabId?: string;
}
interface EmptyChatActionHost {
    available: ComputedRef<readonly EmptyChatActionId[]>;
    request(id: EmptyChatActionId, origin: EmptyChatOrigin): void;
}
const key: InjectionKey<EmptyChatActionHost> = Symbol('empty-chat-actions');
export function useEmptyChatActionHost() {
    return inject(key, null);
}

/** PageShell owns writes/navigation; themes receive only presentational action IDs. */
export function useEmptyChatActions(options: {
    available: ComputedRef<readonly EmptyChatActionId[]>;
    activateOrigin(origin: EmptyChatOrigin): Promise<boolean>;
    isCurrent(origin: EmptyChatOrigin): boolean;
    createDocument(scope: WorkspaceOperationScope): Promise<string>;
    openDocument(id: string): Promise<void>;
    openProject(id: string): Promise<void>;
}) {
    type Request = {
        kind: 'start-project';
        origin: EmptyChatOrigin;
        generation: number;
        savedId?: string;
    };
    const toast = useToast();
    const request = shallowRef<Request | null>(null);
    const form = reactive({ title: '', brief: '', error: '', pending: false });
    const active = computed(() => Boolean(request.value));
    function current(owner: Request) {
        return (
            request.value === owner &&
            owner.generation === getWorkspaceGeneration() &&
            options.isCurrent(owner.origin)
        );
    }
    function close() {
        if (!form.pending) request.value = null;
    }
    let opening = false;
    provide(key, {
        available: options.available,
        async request(id, origin) {
            if (
                opening ||
                request.value ||
                id === 'start-chat' ||
                !options.available.value.includes(id)
            )
                return;
            opening = true;
            const generation = getWorkspaceGeneration();
            try {
                const scope = captureProjectOperation();
                scope.assertCurrent('write');
                // Pane focus can await an outgoing draft capture. Wait for the real
                // tab activation before deciding whether the origin is still current.
                if (!(await options.activateOrigin(origin))) return;
                scope.assertCurrent('write');
                if (
                    generation !== getWorkspaceGeneration() ||
                    !options.isCurrent(origin) ||
                    !options.available.value.includes(id)
                )
                    return;
                if (id === 'create-document') {
                    try {
                        const documentId = await options.createDocument(scope);
                        scope.assertCurrent();
                        if (!options.isCurrent(origin)) return;
                        await options.openDocument(documentId);
                    } catch (error) {
                        toast.add({
                            title: 'Document creation failed',
                            description: error instanceof Error
                                ? error.message
                                : 'Please try again.',
                            color: 'error',
                        });
                    }
                    return;
                }
            } catch {
                return;
            } finally {
                opening = false;
            }
            form.title = '';
            form.brief = '';
            form.error = '';
            form.pending = false;
            request.value = {
                kind: 'start-project',
                origin: { ...origin },
                generation: getWorkspaceGeneration(),
            };
        },
    });
    watch(
        () => request.value && options.isCurrent(request.value.origin),
        (value) => {
            if (value === false && !form.pending) {
                request.value = null;
                form.pending = false;
            }
        },
    );
    const unsubscribe = import.meta.client
        ? subscribeActiveWorkspaceDb(() => {
              request.value = null;
              form.pending = false;
          })
        : undefined;
    onScopeDispose(() => {
        unsubscribe?.();
        request.value = null;
    });
    async function submit() {
        const owner = request.value;
        if (
            !owner ||
            form.pending ||
            !current(owner) ||
            !options.available.value.includes(owner.kind)
        )
            return;
        const title = form.title.trim();
        if (!title) {
            form.error = 'Title required';
            return;
        }
        form.pending = true;
        form.error = '';
        try {
            const scope = captureProjectOperation();
            scope.assertCurrent('write');
            if (!owner.savedId) {
                const { useProjectsCrud } =
                    await import('~/composables/projects/useProjectsCrud');
                if (!current(owner)) return;
                scope.assertCurrent('write');
                owner.savedId = await useProjectsCrud().createProject({
                    name: title,
                    description: form.brief.trim(),
                });
            }
            scope.assertCurrent();
            if (!current(owner)) return;
            await options.openProject(owner.savedId);
            if (request.value === owner) request.value = null;
        } catch (error) {
            if (current(owner))
                form.error = owner.savedId
                    ? 'Saved successfully. Could not open it. Choose Open to try again.'
                    : error instanceof Error
                      ? error.message
                      : 'Could not create this item. Please try again.';
        } finally {
            if (request.value === owner) {
                if (!current(owner)) request.value = null;
                form.pending = false;
            } else if (!request.value) form.pending = false;
        }
    }
    return { request, active, form, close, submit };
}
