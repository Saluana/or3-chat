import type { H3Event } from 'h3';
import type { PluginPackagePointerTarget } from './package-pointer-store';
import type { PluginPackageServices } from './package-operation-support';
import { packageGrantCandidate, readPackageManifest } from './package-operation-support';
import { getEnabledPlugins, getPluginGrantReview } from './workspace-plugin-store';
import { getWorkspaceAccessStore } from '../stores/registry';
import { listAllWorkspaceIds } from '../../utils/plugins/acquisition/route-support';
import { preflightPluginStateCompatibility } from '~~/shared/plugins/state-compatibility';
import { readLocalAdmission } from './local-admission';
import { readAdminUploadProvenance } from './admin-upload-provenance';
import { signedRelease } from './site-policy-service';
import { packageNeedsNoSetup } from './setup-readiness';
import { resolveConnectionService } from '../../utils/plugins/connections/resolve';
import { loadSetupState } from '../../utils/plugins/setup/state';
import { createHash } from 'node:crypto';
import type { Or3ExtensionManifestV2 } from '../extensions/types';
import { PluginPackageRouteCatalog } from './package-route-catalog';
import { resolvePluginV2DependencyGraph } from '~~/shared/plugins/v2-dependency-graph';
import { verifyPluginV2Compatibility } from '~~/shared/plugins/v2-compatibility';
import { OR3_PLUGIN_V2_HOST_CAPABILITIES } from './v2-host-capabilities';

type Block = { workspaceId: string; code: string };

function dependencyReadiness(manifests: ReadonlyMap<string, Or3ExtensionManifestV2>) {
    const graph = resolvePluginV2DependencyGraph([...manifests.values()].map((manifest) => ({
        id: manifest.id, version: manifest.version, dependencies: manifest.dependencies,
    })));
    const available = [...manifests.values()].map((manifest) => ({
        id: manifest.id, version: manifest.version,
        features: [...manifest.features.required, ...manifest.features.optional],
    }));
    const compatible = new Map([...manifests.values()].map((manifest) => [manifest.id,
        verifyPluginV2Compatibility({ manifest, host: OR3_PLUGIN_V2_HOST_CAPABILITIES,
            dependencies: available.filter((item) => item.id !== manifest.id) }).status === 'compatible',
    ]));
    return (enabled: ReadonlySet<string>) => {
        const resolved = new Map<string, boolean>();
        const visiting = new Set<string>();
        const ready = (pluginId: string): boolean => {
            if (resolved.has(pluginId)) return resolved.get(pluginId)!;
            const required = graph.resolutions[pluginId]?.required;
            if (!enabled.has(pluginId) || !compatible.get(pluginId) || graph.blocked[pluginId] || !required || visiting.has(pluginId)) return false;
            visiting.add(pluginId);
            const result = required.every(ready);
            visiting.delete(pluginId);
            resolved.set(pluginId, result);
            return result;
        };
        return ready;
    };
}

export function enabledWorkspaceFingerprint(ids: readonly string[]): `sha256-${string}` {
    return `sha256-${createHash('sha256').update(JSON.stringify([...ids].sort())).digest('hex')}`;
}

/** The selected code is shared; rollback must account for every live enabled workspace. */
export async function prepareRollbackWorkspacePreflight(event: H3Event, services: PluginPackageServices, pluginId: string, previous: PluginPackagePointerTarget,
    options: { readonly expectedEnabledWorkspaceSha256?: string } = {}) {
    const manifest = await readPackageManifest(services.packages.packagePath(pluginId, previous.packageDigest));
    const local = await readLocalAdmission(pluginId, previous.packageDigest) ||
        await readAdminUploadProvenance(pluginId, previous.packageDigest);
    const release = local ? null : await signedRelease(pluginId, manifest.version);
    if (release && release.packageTreeSha256 !== previous.packageDigest) throw new Error('The previous release no longer matches its signed package.');
    const candidate = await packageGrantCandidate({
        packagePath: services.packages.packagePath(pluginId, previous.packageDigest),
        packageDigest: previous.packageDigest,
        release: release ? { releaseId: release.releaseId, authoritySha256: release.authoritySha256,
            ...(release.authority === undefined ? {} : { authority: release.authority }) } : null,
    });
    const noSetup = await packageNeedsNoSetup(services.packages, pluginId, previous.packageDigest);
    const access = getWorkspaceAccessStore(event);
    let initialEnabled: string[] | null = null;

    return async ({ current }: { current: PluginPackagePointerTarget; previous: PluginPackagePointerTarget }) => {
        if (!local) {
            const currentRelease = await signedRelease(pluginId, manifest.version);
            if (!release || currentRelease.releaseId !== release.releaseId ||
                currentRelease.packageTreeSha256 !== previous.packageDigest ||
                currentRelease.authoritySha256 !== release.authoritySha256) {
                throw new Error('The previous release changed after rollback review.');
            }
        }
        const ids = await listAllWorkspaceIds(event);
        const enabled: string[] = [];
        const blocking: Block[] = [];
        for (const workspaceId of ids) {
            try {
                if (await getEnabledPlugins(services.settings, workspaceId).then((items) => items.includes(pluginId))) enabled.push(workspaceId);
            } catch { blocking.push({ workspaceId, code: 'enablement-unavailable' }); }
        }
        enabled.sort();
        if (initialEnabled && (initialEnabled.length !== enabled.length || initialEnabled.some((id, index) => id !== enabled[index]))) {
            blocking.push({ workspaceId: '*', code: 'enabled-workspace-set-changed' });
        }
        initialEnabled ??= enabled;
        if (options.expectedEnabledWorkspaceSha256 && enabledWorkspaceFingerprint(enabled) !== options.expectedEnabledWorkspaceSha256) {
            blocking.push({ workspaceId: '*', code: 'enabled-workspace-set-changed' });
        }
        if (blocking.some((item) => item.workspaceId === '*')) return { checked: enabled.length, enabledWorkspaceIds: enabled, blocking };
        const selected = await new PluginPackageRouteCatalog(services.packages, services.pointers).listSelected();
        const currentManifests = new Map<string, Or3ExtensionManifestV2>(selected
            .filter((item) => item.status === 'ready').map((item) => [item.pluginId, item.manifest]));
        const currentManifest = currentManifests.get(pluginId);
        if (!currentManifest || currentManifest.id !== pluginId || manifest.id !== pluginId) {
            blocking.push({ workspaceId: '*', code: 'dependency-preflight-unavailable' });
            return { checked: enabled.length, enabledWorkspaceIds: enabled, blocking };
        }
        const proposedManifests = new Map(currentManifests);
        proposedManifests.set(pluginId, manifest);
        const currentReadiness = dependencyReadiness(currentManifests);
        const proposedReadiness = dependencyReadiness(proposedManifests);
        if (!proposedReadiness(new Set(proposedManifests.keys()))(pluginId)) {
            blocking.push({ workspaceId: '*', code: 'package-dependency-blocked' });
            return { checked: enabled.length, enabledWorkspaceIds: enabled, blocking };
        }
        for (const workspaceId of enabled) {
            try {
                const workspaceEnabled = new Set(await getEnabledPlugins(services.settings, workspaceId));
                const beforeReady = currentReadiness(workspaceEnabled);
                const afterReady = proposedReadiness(workspaceEnabled);
                if (!afterReady(pluginId) || [...workspaceEnabled].some((id) => beforeReady(id) && !afterReady(id))) {
                    blocking.push({ workspaceId, code: 'package-dependency-blocked' });
                    continue;
                }
                const [review, stateVersion] = await Promise.all([
                    getPluginGrantReview(services.settings, workspaceId, pluginId, candidate),
                    services.migration.getStateVersion(workspaceId, pluginId),
                ]);
                if (review.status !== 'current') { blocking.push({ workspaceId, code: `grant-review-${review.status}` }); continue; }
                const state = preflightPluginStateCompatibility({ operation: 'rollback', storedStateVersion: stateVersion,
                    target: previous.stateCompatibility, current: current.stateCompatibility });
                if (state.status !== 'eligible') { blocking.push({ workspaceId, code: state.status === 'blocked' ? state.code : 'state-migration-required' }); continue; }
                if (noSetup) continue;
                const workspace = await access.getWorkspace({ workspaceId });
                if (!workspace?.ownerUserId || workspace.deleted) { blocking.push({ workspaceId, code: 'workspace-unavailable' }); continue; }
                const { service, durable } = resolveConnectionService();
                const setup = await loadSetupState({ event, pluginId, workspaceId, ownerUserId: workspace.ownerUserId,
                    hasSelectedContext: false, service, durableConnections: durable,
                    selection: { pluginId, path: services.packages.packagePath(pluginId, previous.packageDigest), source: 'package',
                        digest: previous.packageDigest, manifestDigest: previous.manifestDigest,
                        selectedSlot: 'previous', pointerRevision: null, status: 'ready',
                        stateCompatibility: previous.stateCompatibility, issues: [] } });
                if (setup.packageDigest !== previous.packageDigest || setup.status.status !== 'ready') {
                    blocking.push({ workspaceId, code: setup.status.status === 'needs-setup' ? 'setup-required' : 'setup-unavailable' });
                }
            } catch { blocking.push({ workspaceId, code: 'preflight-unavailable' }); }
        }
        return { checked: enabled.length, enabledWorkspaceIds: enabled, blocking };
    };
}
