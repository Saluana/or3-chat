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
        scopeKey: '__init__',
    }));
const gateListeners =
    g.__or3PluginGateListeners ??
    (g.__or3PluginGateListeners = new Set<() => void>());

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

async function hydrateServerDecision(pluginId: string): Promise<void> {
    if (!shouldUseServerDecision()) return;
    if (state.pending[pluginId]) return;
    const requestScopeKey = state.scopeKey;

    state.pending[pluginId] = true;
    try {
        const result = await $fetch<PluginGateDecision>('/api/plugins/access', {
            query: { pluginId },
            cache: 'no-store',
        });
        if (state.scopeKey !== requestScopeKey) {
            return;
        }
        state.decisions[pluginId] = result;
        notifyGateChange();
    } catch {
        // Keep local fallback decision when server endpoint is unavailable.
    } finally {
        if (state.scopeKey !== requestScopeKey) {
            return;
        }
        state.pending[pluginId] = false;
        notifyGateChange();
    }
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
