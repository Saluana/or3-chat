import type { H3Event } from 'h3';
import { useRuntimeConfig } from '#imports';
import { bootstrapDefaultEnabledPlugins } from '../admin/plugins/workspace-plugin-store';
import { getWorkspaceSettingsStore } from '../admin/stores/registry';
import { ImmutablePluginPackageStore } from '../admin/plugins/package-store';
import { PluginPackagePointerStore } from '../admin/plugins/package-pointer-store';
import { SitePluginPolicyStore } from '../admin/plugins/site-policy';
import { ensureSitePolicyMigrated } from '../admin/plugins/site-policy-service';
import { rolloutCandidateFor, rolloutCoordinatorFor } from '../admin/plugins/rollout-route-support';

export const PLUGIN_PROVISIONING_REPAIRS_KEY = 'plugins.provisioning.repairs';
export interface PluginProvisioningRepair {
    pluginId: string | null;
    operationId: string | null;
    message: string;
}

export function getDefaultEnabledPluginIds(event?: H3Event): string[] {
    const config = useRuntimeConfig(event);
    const rawDefaultEnabled = (
        (config.plugins as { defaultEnabled?: unknown } | undefined)?.defaultEnabled
    );

    if (!Array.isArray(rawDefaultEnabled)) {
        return [];
    }

    return rawDefaultEnabled.filter(
        (value): value is string =>
            typeof value === 'string' && value.trim().length > 0
    );
}

export async function provisionWorkspaceDefaults(
    event: H3Event,
    workspaceId: string,
    createdWorkspace?: { ownerUserId: string; name: string }
): Promise<{ warnings: string[] }> {
    const warnings: string[] = [];
    const repairs: PluginProvisioningRepair[] = [];
    let repairRecordWritten = false;
    const warn = (message: string, pluginId: string | null = null, operationId: string | null = null) => {
        warnings.push(message);
        repairs.push({ pluginId, operationId, message });
    };
    const saveRepairs = async (): Promise<boolean> => {
        if (!repairs.length && !repairRecordWritten) return true;
        try {
            await getWorkspaceSettingsStore(event).set(
                workspaceId, PLUGIN_PROVISIONING_REPAIRS_KEY, JSON.stringify(repairs)
            );
            repairRecordWritten = true;
            return true;
        } catch {
            warnings.push(`Plugin repair details could not be saved for workspace ${workspaceId}.`);
            return false;
        }
    };
    const packages = new ImmutablePluginPackageStore();
    const policies = new SitePluginPolicyStore();
    let sitePolicies: Awaited<ReturnType<SitePluginPolicyStore['list']>>;
    let managedPluginIds: Set<string>;
    try {
        await ensureSitePolicyMigrated(policies);
        sitePolicies = await policies.list();
        managedPluginIds = new Set(await new PluginPackagePointerStore(undefined, packages).listPluginIds());
        for (const policy of sitePolicies) managedPluginIds.add(policy.pluginId);
    } catch {
        warn(`Plugin defaults could not be inspected for workspace ${workspaceId}; review its plugin settings.`);
        await saveRepairs();
        return { warnings };
    }
    const defaultEnabledPluginIds = getDefaultEnabledPluginIds(event);
    const settingsStore = getWorkspaceSettingsStore(event);
    try {
        const sourceDefaults = defaultEnabledPluginIds.filter((pluginId) => !managedPluginIds.has(pluginId));
        if (sourceDefaults.length) await bootstrapDefaultEnabledPlugins(settingsStore, workspaceId, sourceDefaults);
    } catch {
        warn(`Source plugin defaults need repair for workspace ${workspaceId}.`);
    }
    try {
        const coordinator = rolloutCoordinatorFor(event, createdWorkspace ? {
            id: workspaceId, name: createdWorkspace.name, ownerUserId: createdWorkspace.ownerUserId,
            createdAt: Date.now(), deleted: false, memberCount: 1,
        } : undefined);
        const prepared: Array<{
            pluginId: string;
            candidate: Awaited<ReturnType<typeof rolloutCandidateFor>>['candidate'];
            operationId: string;
            repair: PluginProvisioningRepair;
        }> = [];
        // Record every applicable default before starting any provider mutation.
        // A slow first rollout can then return without losing the later work.
        for (const policy of sitePolicies) {
            const future = policy.futureDefault;
            if (!policy.catalogVisible || !future?.enabled ||
                future.packageTreeSha256 !== policy.approvedRelease.packageTreeSha256 ||
                future.authoritySha256 !== policy.approvedRelease.authoritySha256) continue;
            try {
                const { candidate } = await rolloutCandidateFor(policy.pluginId);
                const preview = await coordinator.createPreview({
                    pluginId: policy.pluginId, actorId: 'workspace-provisioning',
                    selection: { kind: 'selected', workspaceIds: [workspaceId] },
                    enabled: true, includeFutureWorkspaces: false,
                    approvedGrants: future.approvedGrants, candidate,
                    provisioningGuard: { policyRevision: policy.revision, futureDefault: future },
                });
                const repair = { pluginId: policy.pluginId, operationId: preview.id,
                    message: `Check plugin ${policy.pluginId} rollout ${preview.id} for workspace ${workspaceId}.` };
                repairs.push(repair);
                if (!await saveRepairs()) {
                    warnings.push(repair.message);
                    return { warnings };
                }
                prepared.push({ pluginId: policy.pluginId, candidate, operationId: preview.id, repair });
            } catch {
                warn(`Plugin ${policy.pluginId} could not be prepared in workspace ${workspaceId}; review its plugin settings.`, policy.pluginId);
                await saveRepairs();
            }
        }
        for (const { pluginId, candidate, operationId, repair } of prepared) {
            try {
                // The provider CAS is unabortable. Let it retain the plugin lock,
                // while returning the already-created workspace with its repair link.
                const mutation = (async () => {
                    await coordinator.start(operationId, candidate);
                    return coordinator.continue(operationId, candidate);
                })()
                    .then((result) => ({ result, error: null as unknown }), (error: unknown) => ({ result: null, error }));
                let timer: ReturnType<typeof setTimeout> | undefined;
                const settled = await Promise.race([
                    mutation,
                    new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), 8_000); }),
                ]);
                if (timer) clearTimeout(timer);
                if (settled === null) {
                    warnings.push(repair.message);
                    return { warnings };
                }
                repairs.splice(repairs.indexOf(repair), 1);
                if (settled.error) throw settled.error;
                const outcome = settled.result?.targets[0]?.outcome;
                if (!outcome || outcome.state === 'blocked' || outcome.state === 'failed') {
                    warn(`Plugin ${pluginId} needs setup or retry in workspace ${workspaceId}; rollout ${operationId}.`, pluginId, operationId);
                }
                await saveRepairs();
            } catch {
                const index = repairs.indexOf(repair);
                if (index >= 0) repairs.splice(index, 1);
                warn(`Plugin ${pluginId} could not be provisioned in workspace ${workspaceId}; rollout ${operationId}.`, pluginId, operationId);
                await saveRepairs();
            }
        }
    } catch {
        warn(`Plugin defaults could not be inspected for workspace ${workspaceId}; review its plugin settings.`);
    }
    await saveRepairs();
    return { warnings };
}
