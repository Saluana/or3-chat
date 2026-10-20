import { reactive } from 'vue';
import { $fetch } from 'ofetch';
import { useRuntimeConfig } from '#imports';
import { getCachedSessionContext } from '~/composables/auth/useSessionContext';
import {
    evaluatePluginGate,
    mergePluginGatePolicy,
    type PluginGateDecision,
    type PluginGatePolicy,
} from '~~/shared/plugins/access-policy';

interface GateState {
    decisions: Record<string, PluginGateDecision>;
    pending: Record<string, boolean>;
    retryAt: Record<string, number>;
    scopeKey: string;
}

type GateGlobals = typeof globalThis & {
    __or3PluginGateState?: GateState;
    __or3PluginGateListeners?: Set<() => void>;
};

const g = globalThis as GateGlobals;
const state: GateState =
    g.__or3PluginGateState ??
    (g.__or3PluginGateState = reactive<GateState>({
        decisions: {},
        pending: {},
        retryAt: {},
        scopeKey: '__init__',
    }));
const gateListeners =
    g.__or3PluginGateListeners ??
    (g.__or3PluginGateListeners = new Set<() => void>());
// Existing HMR state can predate the retry field.
state.retryAt ??= {};
const MAX_GATE_BATCH_SIZE = 50;
const GATE_RETRY_COOLDOWN_MS = 10_000;
let queuedBatch: { scopeKey: string; pluginIds: string[] } | null = null;

function notifyGateChange(): void {
    for (const listener of [...gateListeners]) {
        try {
            listener();
        } catch {
            // Access observers must not break policy evaluation.
        }
    }
}

export function subscribePluginGateChanges(listener: () => void): () => void {
    gateListeners.add(listener);
    return () => gateListeners.delete(listener);
}

function buildScopeKey(): string {
    const session = getCachedSessionContext();
    return [
        session?.authenticated === true ? '1' : '0',
        session?.user?.id ?? '',
        session?.workspace?.id ?? '',
        session?.role ?? '',
        [...(session?.entitlements ?? [])].sort().join(','),
    ].join('|');
}

function resetDecisionCache(): void {
    state.decisions = {};
    state.pending = {};
    state.retryAt = {};
    notifyGateChange();
}

function syncScopeCache(): void {
    const scopeKey = buildScopeKey();
    if (state.scopeKey === scopeKey) return;
    state.scopeKey = scopeKey;
    resetDecisionCache();
}

function shouldUseServerDecision(): boolean {
    if (!process.client) return false;
    try {
        const { public: publicConfig } = useRuntimeConfig();
        return publicConfig.ssrAuthEnabled === true;
    } catch {
        return false;
    }
}

function getLocalDecision(policy?: PluginGatePolicy | null): PluginGateDecision {
    const session = getCachedSessionContext();
    const mergedPolicy = mergePluginGatePolicy(policy ?? {});

    return evaluatePluginGate({
        policy: mergedPolicy,
        session: {
            authenticated: Boolean(session?.authenticated),
            role: session?.role,
        },
        entitlements: session?.entitlements ?? [],
        pluginEnabled: true,
    });
}

function hydrateServerDecision(pluginId: string): void {
    if (!shouldUseServerDecision()) return;
    if (getCachedSessionContext()?.authenticated !== true) return;
    if (state.pending[pluginId]) return;
    if ((state.retryAt[pluginId] ?? 0) > Date.now()) return;
    const requestScopeKey = state.scopeKey;

    state.pending[pluginId] = true;
    if (queuedBatch?.scopeKey === requestScopeKey && queuedBatch.pluginIds.length < MAX_GATE_BATCH_SIZE) {
        queuedBatch.pluginIds.push(pluginId);
        return;
    }
    const batch = { scopeKey: requestScopeKey, pluginIds: [pluginId] };
    queuedBatch = batch;
    // Registries evaluate many distinct plugin gates in the same render. Join
    // them before sending one bounded request; local decisions remain immediate.
    void Promise.resolve().then(async () => {
        if (queuedBatch === batch) queuedBatch = null;
        if (state.scopeKey !== requestScopeKey) return;
        try {
            const result = await $fetch<{ decisions: Record<string, PluginGateDecision> }>('/api/plugins/access', {
                query: { pluginIds: batch.pluginIds },
                cache: 'no-store',
                retry: 0,
            });
            if (state.scopeKey !== requestScopeKey) return;
            for (const id of batch.pluginIds) {
                if (Object.hasOwn(result.decisions, id)) {
                    state.decisions[id] = result.decisions[id]!;
                } else {
                    state.retryAt[id] = Date.now() + GATE_RETRY_COOLDOWN_MS;
                }
            }
        } catch {
            if (state.scopeKey !== requestScopeKey) return;
            for (const id of batch.pluginIds) {
                state.retryAt[id] = Date.now() + GATE_RETRY_COOLDOWN_MS;
            }
        } finally {
            if (state.scopeKey === requestScopeKey) {
                for (const id of batch.pluginIds) state.pending[id] = false;
                notifyGateChange();
            }
        }
    });
}

function combineGateDecisions(
    local: PluginGateDecision,
    server: PluginGateDecision
): PluginGateDecision {
    return {
        allowed: local.allowed && server.allowed,
        reasons: Array.from(new Set([...server.reasons, ...local.reasons])),
        effectivePolicy: server.effectivePolicy,
    };
}

export function getPluginGateDecision(
    pluginId?: string,
    policy?: PluginGatePolicy | null
): PluginGateDecision {
    syncScopeCache();
    const local = getLocalDecision(policy);
    if (!pluginId) {
        return local;
    }

    if (!shouldUseServerDecision()) {
        return local;
    }

    if (getCachedSessionContext()?.authenticated !== true) {
        return local;
    }

    if (!state.decisions[pluginId]) {
        void hydrateServerDecision(pluginId);
        return local;
    }

    return combineGateDecisions(local, state.decisions[pluginId]);
}

export function isPluginGateDecisionPending(pluginId?: string): boolean {
    if (!pluginId) return false;
    syncScopeCache();
    return state.pending[pluginId] === true;
}
