import { createError, defineEventHandler, getRouterParam, readBody } from 'h3';
import { z } from 'zod';
import { requireAdminApiContext } from '../../../../../admin/api';
import { resolveAdminWorkspaceTarget } from '../../../../../admin/workspace-target';
import { getWorkspaceSettingsStore } from '../../../../../admin/stores/registry';
import {
    getPluginSettings,
    setPluginSettings,
} from '../../../../../admin/plugins/workspace-plugin-store';
import { PluginSettingsMigrationService } from '../../../../../admin/plugins/settings-migration';
import { ImmutablePluginPackageStore } from '../../../../../admin/plugins/package-store';
import { PluginPackagePointerStore } from '../../../../../admin/plugins/package-pointer-store';
import { PluginPackagePromotionService } from '../../../../../admin/plugins/package-promotion';
import type { CandidateStateValue } from '../../../../../admin/plugins/package-candidate-canary';

const BodySchema = z.object({ workspaceId: z.string().min(1).optional() });

type StateSnapshot = {
    readonly settings: Record<string, unknown>;
    readonly stateVersion: number | null;
};

function isStateSnapshot(value: unknown): value is StateSnapshot {
    if (value === null || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;
    return (
        record.settings !== null &&
        typeof record.settings === 'object' &&
        !Array.isArray(record.settings) &&
        (record.stateVersion === null ||
            (Number.isSafeInteger(record.stateVersion) && (record.stateVersion as number) >= 0))
    );
}

export default defineEventHandler(async (event) => {
    const context = await requireAdminApiContext(event, {
        ownerOnly: true,
        mutation: true,
        allowWorkspaceAdmin: true,
    });
    const pluginId = getRouterParam(event, 'pluginId');
    const body = BodySchema.safeParse(await readBody(event));
    if (!pluginId || !body.success) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid request' });
    }
    const workspaceId = resolveAdminWorkspaceTarget(context, body.data.workspaceId);
    const store = getWorkspaceSettingsStore(event);
    const migration = new PluginSettingsMigrationService(store);
    const packages = new ImmutablePluginPackageStore();
    const pointers = new PluginPackagePointerStore(undefined, packages);
    const promotion = new PluginPackagePromotionService(packages, pointers);
    const result = await promotion.rollback({
        pluginId,
        storedStateVersion: await migration.getStateVersion(workspaceId, pluginId),
        snapshotState: async () =>
            JSON.parse(
                JSON.stringify({
                    settings: await getPluginSettings(store, workspaceId, pluginId),
                    stateVersion: await migration.getStateVersion(workspaceId, pluginId),
                })
            ) as CandidateStateValue,
        restoreState: async (snapshot) => {
            if (!isStateSnapshot(snapshot)) throw new Error('Invalid settings snapshot');
            await setPluginSettings(store, workspaceId, pluginId, snapshot.settings);
            await store.set(
                workspaceId,
                `plugins.stateVersion.${pluginId}`,
                snapshot.stateVersion === null ? '' : String(snapshot.stateVersion)
            );
        },
    });
    if (result.status === 'rolled-back') {
        await event.context.adminHooks?.doAction('admin.plugin:action:rolled-back', {
            id: pluginId,
            workspaceId,
        });
    }
    return { ok: result.status === 'rolled-back', workspaceId, ...result };
});
