import { computed, readonly, ref, watch, type WatchSource } from 'vue';
import { useRoute } from '#imports';

import { useWorkspaceManager } from '~/composables/workspace/useWorkspaceManager';
import { getGlobalMultiPaneApi } from '~/utils/multiPaneApi';
import { useOr3NetAuth } from './useOr3NetAuth';
import { useOr3NetClient } from './useOr3NetClient';
import type { Or3NetSessionRecord } from './types';

const session = ref<Or3NetSessionRecord | null>(null);
const pending = ref(false);
const error = ref<Error | null>(null);
const boundKey = ref<string | null>(null);

const resolveInFlight = new Map<string, Promise<Or3NetSessionRecord | null>>();
let invalidationWatcherInstalled = false;
let pendingResolveCount = 0;

function normalizeRouteThreadId(value: unknown): string | null {
    const routeValue =
        typeof value === 'string'
            ? value
            : Array.isArray(value) && typeof value[0] === 'string'
              ? value[0]
              : null;
    if (routeValue === null) return null;
    const trimmed = routeValue.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function getActiveChatThreadIdFromPane(): string | null {
    const multiPane = getGlobalMultiPaneApi();
    if (!multiPane) return null;
    const pane = multiPane.panes.value[multiPane.activePaneIndex.value];
    if (!pane || pane.mode !== 'chat') return null;
    const threadId = pane.threadId.trim();
    return threadId ? threadId : null;
}

function invalidateState(): void {
    session.value = null;
    error.value = null;
    boundKey.value = null;
}

function startPendingResolve(): void {
    pendingResolveCount += 1;
    pending.value = pendingResolveCount > 0;
}

function finishPendingResolve(): void {
    pendingResolveCount = Math.max(0, pendingResolveCount - 1);
    pending.value = pendingResolveCount > 0;
}

function installInvalidationWatcher(
    workspaceId: WatchSource<string | null>,
    clientSessionId: WatchSource<string | null>
): void {
    if (invalidationWatcherInstalled || import.meta.server) {
        return;
    }

    invalidationWatcherInstalled = true;
    watch([workspaceId, clientSessionId], ([nextWorkspaceId, nextSessionId], [prevWorkspaceId, prevSessionId]) => {
        if (
            nextWorkspaceId === prevWorkspaceId &&
            nextSessionId === prevSessionId
        ) {
            return;
        }

        invalidateState();
    });
}

export function useOr3NetSession() {
    const route = useRoute();
    const auth = useOr3NetAuth();
    const client = useOr3NetClient();
    const { activeWorkspaceId } = useWorkspaceManager();

    const activeClientSessionId = computed(() => {
        const paneThreadId = getActiveChatThreadIdFromPane();
        if (paneThreadId) {
            return paneThreadId;
        }

        return normalizeRouteThreadId(route.params.id);
    });

    const currentKey = computed(() => {
        const workspaceId = activeWorkspaceId.value;
        const clientSessionId = activeClientSessionId.value;
        if (!workspaceId || !clientSessionId) return null;
        return `${workspaceId}:${clientSessionId}`;
    });

    installInvalidationWatcher(activeWorkspaceId, activeClientSessionId);

    async function refresh(force = false): Promise<Or3NetSessionRecord | null> {
        const workspaceId = activeWorkspaceId.value;
        const clientSessionId = activeClientSessionId.value;

        if (!auth.isConfigured.value || !workspaceId || !clientSessionId) {
            invalidateState();
            return null;
        }

        if (!force && boundKey.value === currentKey.value) {
            return session.value;
        }

        const requestKey = `${workspaceId}:${clientSessionId}`;
        const inFlight = resolveInFlight.get(requestKey);
        if (inFlight) {
            return inFlight;
        }

        error.value = null;
        startPendingResolve();
        const query = new URLSearchParams({
            limit: '1',
            client_kind: 'chat',
            client_session_id: clientSessionId,
        });
        const request = client
            .listSessions(workspaceId, query)
            .then((response) => {
                if (currentKey.value !== requestKey) {
                    return null;
                }
                const resolved = response.items[0] ?? null;
                session.value = resolved;
                boundKey.value = currentKey.value;
                return resolved;
            })
            .catch((cause) => {
                const normalized =
                    cause instanceof Error ? cause : new Error(String(cause));
                if (currentKey.value === requestKey) {
                    error.value = normalized;
                }
                throw normalized;
            })
            .finally(() => {
                finishPendingResolve();
                if (resolveInFlight.get(requestKey) === request) {
                    resolveInFlight.delete(requestKey);
                }
            });

        resolveInFlight.set(requestKey, request);
        return await request;
    }

    function remember(value: Or3NetSessionRecord | null): void {
        session.value = value;
        boundKey.value = currentKey.value;
        error.value = null;
    }

    if (
        import.meta.client &&
        auth.isConfigured.value &&
        activeWorkspaceId.value &&
        activeClientSessionId.value &&
        !pending.value &&
        boundKey.value !== currentKey.value
    ) {
        void refresh().catch(() => undefined);
    }

    return {
        session: readonly(session),
        pending: readonly(pending),
        error: readonly(error),
        networkSessionId: computed(() => session.value?.network_session_id ?? null),
        activeClientSessionId: readonly(activeClientSessionId),
        hasBoundSession: computed(() => session.value !== null),
        async refresh(options: { force?: boolean } = {}) {
            return await refresh(options.force === true);
        },
        remember,
        invalidate() {
            invalidateState();
        },
    };
}