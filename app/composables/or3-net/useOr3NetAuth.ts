import { computed, readonly, ref, watch } from 'vue';
import { $fetch } from 'ofetch';
import { useRuntimeConfig } from '#imports';

import { useWorkspaceManager } from '~/composables/workspace/useWorkspaceManager';
import type { Or3NetExchangeResponse } from './types';

const payload = ref<Or3NetExchangeResponse | null>(null);
const pending = ref(false);
const error = ref<Error | null>(null);
const boundWorkspaceId = ref<string | null>(null);

const exchangeInFlight = new Map<string, Promise<Or3NetExchangeResponse | null>>();
let workspaceWatcherInstalled = false;
let pendingExchangeCount = 0;

function invalidateState(): void {
    payload.value = null;
    error.value = null;
    boundWorkspaceId.value = null;
    pendingExchangeCount = 0;
    pending.value = false;
}

function startPendingExchange(): void {
    pendingExchangeCount += 1;
    pending.value = pendingExchangeCount > 0;
}

function finishPendingExchange(): void {
    pendingExchangeCount = Math.max(0, pendingExchangeCount - 1);
    pending.value = pendingExchangeCount > 0;
}

function normalizeError(value: unknown): Error {
    if (value instanceof Error) return value;
    return new Error(String(value));
}

function hasFreshPayload(workspaceId: string | null): boolean {
    if (!workspaceId || payload.value === null) {
        return false;
    }

    if (boundWorkspaceId.value !== workspaceId) {
        return false;
    }

    const expiresAtMs = Date.parse(payload.value.expires_at);
    if (!Number.isFinite(expiresAtMs)) {
        return false;
    }

    return expiresAtMs - Date.now() > 15_000;
}

function installWorkspaceWatcher(): void {
    if (workspaceWatcherInstalled || import.meta.server) {
        return;
    }

    workspaceWatcherInstalled = true;
    const { activeWorkspaceId } = useWorkspaceManager();

    watch(
        activeWorkspaceId,
        (nextWorkspaceId, previousWorkspaceId) => {
            if (nextWorkspaceId === previousWorkspaceId) {
                return;
            }
            invalidateState();
        },
        { immediate: false }
    );
}

async function exchangeToken(force = false): Promise<Or3NetExchangeResponse | null> {
    const runtimeConfig = useRuntimeConfig() as {
        public: {
            ssrAuthEnabled?: boolean;
            or3Net?: { enabled?: boolean };
        };
    };
    const enabled =
        runtimeConfig.public.ssrAuthEnabled === true &&
        runtimeConfig.public.or3Net?.enabled === true;

    const { activeWorkspaceId } = useWorkspaceManager();
    const workspaceId = activeWorkspaceId.value;

    if (!enabled || !workspaceId) {
        invalidateState();
        return null;
    }

    if (!force && hasFreshPayload(workspaceId)) {
        return payload.value;
    }

    const inFlight = exchangeInFlight.get(workspaceId);
    if (inFlight) {
        return inFlight;
    }

    error.value = null;
    startPendingExchange();

    const requestKey = workspaceId;
    const request = $fetch<Or3NetExchangeResponse>('/api/or3-net/exchange', {
        method: 'POST',
        body: { workspace_id: workspaceId },
        cache: 'no-store',
    })
        .then((response) => {
            if (activeWorkspaceId.value !== requestKey) {
                return null;
            }
            payload.value = response;
            boundWorkspaceId.value = response.workspace_id;
            return response;
        })
        .catch((cause) => {
            const normalized = normalizeError(cause);
            if (activeWorkspaceId.value === requestKey) {
                error.value = normalized;
            }
            throw normalized;
        })
        .finally(() => {
            finishPendingExchange();
            if (exchangeInFlight.get(requestKey) === request) {
                exchangeInFlight.delete(requestKey);
            }
        });

    exchangeInFlight.set(requestKey, request);
    return request;
}

export function useOr3NetAuth() {
    installWorkspaceWatcher();

    const token = computed(() => payload.value?.token ?? null);
    const expiresAt = computed(() => payload.value?.expires_at ?? null);
    const scopes = computed(() => payload.value?.scopes ?? []);
    const workspaceId = computed(() => boundWorkspaceId.value);
    const isConfigured = computed(() => {
        const runtimeConfig = useRuntimeConfig() as {
            public: { ssrAuthEnabled?: boolean; or3Net?: { enabled?: boolean } };
        };
        return (
            runtimeConfig.public.ssrAuthEnabled === true &&
            runtimeConfig.public.or3Net?.enabled === true
        );
    });

    if (import.meta.client && isConfigured.value && !pending.value && !token.value) {
        void exchangeToken().catch(() => undefined);
    }

    return {
        token: readonly(token),
        expiresAt: readonly(expiresAt),
        scopes: readonly(scopes),
        workspaceId: readonly(workspaceId),
        payload: readonly(payload),
        pending: readonly(pending),
        error: readonly(error),
        isConfigured: readonly(isConfigured),
        async getAccessToken(options: { forceRefresh?: boolean } = {}) {
            const response = await exchangeToken(options.forceRefresh === true);
            return response?.token ?? null;
        },
        async refresh() {
            return await exchangeToken(true);
        },
        invalidate() {
            invalidateState();
        },
    };
}
