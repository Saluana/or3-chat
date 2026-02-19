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
}

type GateGlobals = typeof globalThis & {
    __or3PluginGateState?: GateState;
};

const g = globalThis as GateGlobals;
const state: GateState =
    g.__or3PluginGateState ??
    (g.__or3PluginGateState = reactive<GateState>({
        decisions: {},
        pending: {},
    }));

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
        entitlements: ((session as { entitlements?: string[] } | null)?.entitlements ?? []),
        pluginEnabled: true,
    });
}

async function hydrateServerDecision(pluginId: string): Promise<void> {
    if (!shouldUseServerDecision()) return;
    if (state.pending[pluginId]) return;

    state.pending[pluginId] = true;
    try {
        const result = await $fetch<PluginGateDecision>('/api/plugins/access', {
            query: { pluginId },
            cache: 'no-store',
        });
        state.decisions[pluginId] = result;
    } catch {
        // Keep local fallback decision when server endpoint is unavailable.
    } finally {
        state.pending[pluginId] = false;
    }
}

export function getPluginGateDecision(
    pluginId?: string,
    policy?: PluginGatePolicy | null
): PluginGateDecision {
    const local = getLocalDecision(policy);
    if (!pluginId) {
        return local;
    }

    if (!state.decisions[pluginId]) {
        void hydrateServerDecision(pluginId);
        return local;
    }

    return state.decisions[pluginId];
}
