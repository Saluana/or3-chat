import { createError, defineEventHandler, getRouterParam, readBody } from 'h3';
import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { requireAdminApiContext } from '../../../../../admin/api';
import { resolveAdminWorkspaceTarget } from '../../../../../admin/workspace-target';
import { getWorkspaceSettingsStore } from '../../../../../admin/stores/registry';
import {
    getPluginGrantReview,
    getPluginSettings,
    replacePluginSettings,
} from '../../../../../admin/plugins/workspace-plugin-store';
import { PluginSettingsMigrationService } from '../../../../../admin/plugins/settings-migration';
import { ImmutablePluginPackageStore } from '../../../../../admin/plugins/package-store';
import { PluginPackagePointerStore } from '../../../../../admin/plugins/package-pointer-store';
import { PluginPackagePromotionService } from '../../../../../admin/plugins/package-promotion';
import type { CandidateStateValue } from '../../../../../admin/plugins/package-candidate-canary';
import { Or3ExtensionManifestV2Schema } from '../../../../../admin/extensions/types';

const BodySchema = z.object({
    workspaceId: z.string().min(1).optional(),
    candidateDigest: z.string().regex(/^sha256-[a-f0-9]{64}$/),
});

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

async function readPackageGrantReview(input: {
    readonly packages: ImmutablePluginPackageStore;
    readonly store: ReturnType<typeof getWorkspaceSettingsStore>;
    readonly workspaceId: string;
    readonly pluginId: string;
    readonly packageDigest: `sha256-${string}`;
}) {
    const manifest = Or3ExtensionManifestV2Schema.parse(
        JSON.parse(
            await fs.readFile(
                resolve(
                    input.packages.packagePath(input.pluginId, input.packageDigest),
                    'or3.manifest.json'
                ),
                'utf8'
            )
        ) as unknown
    );
    return getPluginGrantReview(
        input.store,
        input.workspaceId,
        input.pluginId,
        manifest.requestedGrants
    );
}

export default defineEventHandler(async (event) => {
    const context = await requireAdminApiContext(event, {
        ownerOnly: true,
        mutation: true,
        superAdminOnly: true,
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
    const result = await promotion.promote({
        pluginId,
        workspaceId,
        expectedCandidateDigest: body.data.candidateDigest as `sha256-${string}`,
        storedStateVersion: await migration.getStateVersion(workspaceId, pluginId),
        snapshotState: async () =>
            JSON.parse(
                JSON.stringify({
                    settings: await getPluginSettings(store, workspaceId, pluginId),
                    stateVersion: await migration.getStateVersion(workspaceId, pluginId),
                })
            ) as CandidateStateValue,
        readGrantReview: (candidate) =>
            readPackageGrantReview({
                packages,
                store,
                workspaceId,
                pluginId: candidate.pluginId,
                packageDigest: candidate.packageDigest,
            }),
        restoreState: async (snapshot) => {
            if (!isStateSnapshot(snapshot)) throw new Error('Invalid settings snapshot');
            await replacePluginSettings(store, workspaceId, pluginId, snapshot.settings);
            await store.set(
                workspaceId,
                `plugins.stateVersion.${pluginId}`,
                snapshot.stateVersion === null ? '' : String(snapshot.stateVersion)
            );
        },
    });
    if (result.status === 'promoted') {
        await event.context.adminHooks?.doAction('admin.plugin:action:promoted', {
            id: pluginId,
            workspaceId,
            packageDigest: body.data.candidateDigest,
        });
    }
    return { ok: result.status === 'promoted', workspaceId, ...result };
});
