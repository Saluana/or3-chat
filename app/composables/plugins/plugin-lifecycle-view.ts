import { isPortableActivationReady, usePortableActivations } from './portable-client-runtime';
import { useTrustedV2Activations } from './trusted-v2-manager';
import type { PluginLifecycleView } from '~~/shared/plugins/lifecycle/lifecycle-view';

export interface PluginLifecycleEntry {
    readonly pluginId: string;
    readonly display?: { readonly version: string | null; readonly selectedDigest: string | null };
    readonly startup: { readonly selectedDigest: string | null };
}

/** Browser evidence is accepted only for the exact selected digest and workspace. */
export function pluginLifecycleView(
    entry: PluginLifecycleEntry,
    workspaceId: string | null,
    portable: ReturnType<typeof usePortableActivations>,
    trusted: ReturnType<typeof useTrustedV2Activations>
): PluginLifecycleView {
    const selectedDigest = entry.display?.selectedDigest ?? entry.startup.selectedDigest;
    const selected = selectedDigest && entry.display?.version
        ? { pluginId: entry.pluginId, version: entry.display.version, packageTreeSha256: selectedDigest, manifestSha256: null, source: 'instance-selection' as const }
        : null;
    const activation = [portable.get(`portable:${entry.pluginId}`), portable.get(entry.pluginId)]
        .find((candidate) => candidate && selected && candidate.workspaceId === workspaceId && candidate.packageDigest === selected.packageTreeSha256) ?? null;
    const trustedActivation = trusted.get(entry.pluginId);
    if (!activation) {
        if (trustedActivation && selected && trustedActivation.workspaceId === workspaceId && trustedActivation.packageDigest === selected.packageTreeSha256) {
            return {
                selected, acquisition: null,
                runtime: {
                    state: 'running',
                    identity: { pluginId: entry.pluginId, version: trustedActivation.version, packageTreeSha256: trustedActivation.packageDigest, manifestSha256: null },
                    observedAt: trustedActivation.observedAt,
                    degradedContributions: [],
                },
                activationTimedOut: false,
            };
        }
        return { selected, acquisition: null, runtime: { state: 'not-observed' }, activationTimedOut: false };
    }
    if (activation.status === 'blocked' || activation.status === 'stopped') {
        return { selected, acquisition: null, runtime: { state: 'failed', code: activation.blockCode ?? activation.status }, activationTimedOut: false };
    }
    const identity = { pluginId: activation.pluginId, version: activation.version, packageTreeSha256: activation.packageDigest, manifestSha256: null };
    if (activation.status === 'active' && isPortableActivationReady(activation)) {
        return {
            selected, acquisition: null,
            runtime: { state: 'running', identity, observedAt: typeof activation.startedAt === 'number' ? new Date(activation.startedAt).toISOString() : new Date().toISOString(), degradedContributions: [...activation.degradedContributions] },
            activationTimedOut: false,
        };
    }
    return { selected, acquisition: null, runtime: { state: 'starting', identity }, activationTimedOut: false };
}
