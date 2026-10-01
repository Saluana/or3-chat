import type { H3Event } from 'h3';
import type { WorkspaceSummary } from '../stores/types';
import { getWorkspaceAccessStore, getWorkspaceSettingsStore } from '../stores/registry';
import { ImmutablePluginPackageStore } from './package-store';
import { PluginPackagePointerStore } from './package-pointer-store';
import { packageGrantCandidate } from './package-operation-support';
import { SitePluginPolicyStore } from './site-policy';
import { ensureSitePolicyMigrated, signedRelease } from './site-policy-service';
import { PluginRolloutStore } from './rollout-store';
import { PluginRolloutCoordinator } from './rollout-service';
import { listAllWorkspaceIds } from '../../utils/plugins/acquisition/route-support';
import { resolveConnectionService } from '../../utils/plugins/connections/resolve';
import { loadSetupState } from '../../utils/plugins/setup/state';
import { revokeHostActivationsForPluginWorkspace } from '../../utils/plugins/isolation/activation-registry';
import { packageNeedsNoSetup } from './setup-readiness';

function stale(message: string) { return Object.assign(new Error(message), { code: 'rollout-preview-stale' }); }
const NO_SELECTED_PACKAGE = `sha256-${'0'.repeat(64)}` as const;

export async function rolloutCandidateFor(pluginId: string, forDisable = false) {
    const policies = new SitePluginPolicyStore();
    if (!forDisable) await ensureSitePolicyMigrated(policies);
    const policy = forDisable ? await policies.read(pluginId).catch(() => null) : await policies.read(pluginId);
    if (!forDisable && (!policy || !policy.catalogVisible)) throw stale('This release is not approved for the site.');
    const packages = new ImmutablePluginPackageStore();
    const pointers = new PluginPackagePointerStore(undefined, packages);
    const selection = await pointers.readStartupSelection(pluginId);
    const digest = forDisable
        ? selection.pointer?.current?.packageDigest ?? selection.selected?.packageDigest ?? NO_SELECTED_PACKAGE
        : selection.selected?.packageDigest;
    if (!digest || (!forDisable && (selection.status !== 'ready' || selection.selectedSlot !== 'current'))) throw stale('Install the selected release before changing workspaces.');
    if (forDisable) {
        return { candidate: {
            requestedGrants: [], releaseId: null,
            packageDigest: digest,
            authoritySha256: (policy?.approvedRelease.authoritySha256 ?? NO_SELECTED_PACKAGE) as `sha256-${string}`,
            authority: null,
        }, release: null, policy };
    }
    const release = await signedRelease(pluginId, policy!.approvedRelease.version);
    if (release.releaseId !== policy!.approvedRelease.releaseId ||
        release.packageTreeSha256 !== policy!.approvedRelease.packageTreeSha256 ||
        release.authoritySha256 !== policy!.approvedRelease.authoritySha256 || digest !== release.packageTreeSha256) throw stale('The approved release changed.');
    await packages.verifyStoredPackage(pluginId, digest);
    const candidate = await packageGrantCandidate({
        packagePath: packages.packagePath(pluginId, digest),
        packageDigest: digest,
        release: { releaseId: release.releaseId, authoritySha256: release.authoritySha256,
            ...(release.authority === undefined ? {} : { authority: release.authority }) },
    });
    if (!candidate.authoritySha256 || candidate.authoritySha256 !== release.authoritySha256) throw stale('Installed authority differs from the approved release.');
    return { candidate, release, policy };
}

export function rolloutCoordinatorFor(event: H3Event, justCreatedWorkspace?: WorkspaceSummary): PluginRolloutCoordinator {
    const settings = getWorkspaceSettingsStore(event);
    const access = getWorkspaceAccessStore(event);
    const packages = new ImmutablePluginPackageStore();
    const pointers = new PluginPackagePointerStore(undefined, packages);
    return new PluginRolloutCoordinator({
        policies: new SitePluginPolicyStore(), records: new PluginRolloutStore(), settings,
        listAllWorkspaceIds: () => listAllWorkspaceIds(event),
        getWorkspace: (workspaceId) => workspaceId === justCreatedWorkspace?.id
            ? Promise.resolve(justCreatedWorkspace) : access.getWorkspace({ workspaceId }),
        selectedPointer: async (pluginId, requireReady = true) => {
            const selection = await pointers.readStartupSelection(pluginId);
            const digest = requireReady
                ? selection.status === 'ready' && selection.selectedSlot === 'current' ? selection.selected?.packageDigest : null
                : selection.pointer?.current?.packageDigest ?? selection.selected?.packageDigest;
            return digest
                ? { packageDigest: digest, revision: selection.pointer?.revision ?? 0 }
                : requireReady ? null : { packageDigest: NO_SELECTED_PACKAGE, revision: 0 };
        },
        withPluginLock: (pluginId, fn) => packages.runPluginOperation(pluginId, fn),
        checkSetup: async (workspaceId, pluginId, packageDigest) => {
            const workspace = workspaceId === justCreatedWorkspace?.id
                ? justCreatedWorkspace : await access.getWorkspace({ workspaceId });
            if (!workspace?.ownerUserId) return 'blocked';
            if (await packageNeedsNoSetup(packages, pluginId, packageDigest as `sha256-${string}`)) return 'ready';
            const { service, durable } = resolveConnectionService();
            const state = await loadSetupState({
                event, pluginId, workspaceId, ownerUserId: workspace.ownerUserId,
                hasSelectedContext: false, service, durableConnections: durable, slot: 'current',
            });
            if (state.packageDigest !== packageDigest) return 'blocked';
            return state.status.status === 'ready' ? 'ready'
                : state.status.status === 'needs-setup' ? 'required' : 'blocked';
        },
        onApplied: async (workspaceId, pluginId, enabled) => {
            if (!enabled) revokeHostActivationsForPluginWorkspace(pluginId, workspaceId, 'plugin-disabled');
            await event.context.adminHooks?.doAction(enabled ? 'admin.plugin:action:enabled' : 'admin.plugin:action:disabled', { id: pluginId, workspaceId });
        },
    });
}
