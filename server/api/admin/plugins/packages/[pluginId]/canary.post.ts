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
} from '../../../../../admin/plugins/workspace-plugin-store';
import { PluginSettingsMigrationService } from '../../../../../admin/plugins/settings-migration';
import { ImmutablePluginPackageStore } from '../../../../../admin/plugins/package-store';
import { PluginPackagePointerStore } from '../../../../../admin/plugins/package-pointer-store';
import { Or3ExtensionManifestV2Schema } from '../../../../../admin/extensions/types';
import { verifyPackageServerRouteHandlers } from '../../../../../admin/plugins/server-module-resolver';
import {
    PluginPackageCandidateCanaryService,
    type CandidateStateValue,
} from '../../../../../admin/plugins/package-candidate-canary';

const BodySchema = z.object({
    workspaceId: z.string().min(1).optional(),
    clientId: z.string().min(1).max(128).optional(),
});

async function readPackageManifest(packageRoot: string) {
    return Or3ExtensionManifestV2Schema.parse(
        JSON.parse(
            await fs.readFile(resolve(packageRoot, 'or3.manifest.json'), 'utf8')
        ) as unknown
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
    const packages = new ImmutablePluginPackageStore();
    const pointers = new PluginPackagePointerStore(undefined, packages);
    const pointer = await pointers.readPointer(pluginId);
    if (!pointer?.candidate) {
        throw createError({ statusCode: 409, statusMessage: 'No package candidate is available' });
    }
    const store = getWorkspaceSettingsStore(event);
    const migration = new PluginSettingsMigrationService(store);
    const canary = new PluginPackageCandidateCanaryService(packages, pointers);
    const result = await canary.run({
        pluginId,
        workspaceId,
        packageDigest: pointer.candidate.packageDigest,
        clientId: body.data.clientId ?? 'admin-server-only-canary',
        snapshotState: async () =>
            JSON.parse(
                JSON.stringify({
                    settings: await getPluginSettings(store, workspaceId, pluginId),
                    stateVersion: await migration.getStateVersion(workspaceId, pluginId),
                })
            ) as CandidateStateValue,
        readGrantReview: async (candidate) => {
            const manifest = await readPackageManifest(
                packages.packagePath(candidate.pluginId, candidate.packageDigest)
            );
            return getPluginGrantReview(
                store,
                workspaceId,
                candidate.pluginId,
                manifest.requestedGrants
            );
        },
        serverDryRun: async (dryRun) => {
            try {
                await packages.verifyStoredPackage(dryRun.pluginId, dryRun.packageDigest);
                const manifest = await readPackageManifest(dryRun.packagePath);
                await verifyPackageServerRouteHandlers({
                    packageRoot: dryRun.packagePath,
                    routes: manifest.runtime.server?.routes ?? [],
                });
                return { status: 'passed' as const };
            } catch {
                return { status: 'blocked' as const, code: 'server-handler-invalid' };
            }
        },
        // Client V2 activation has its own ABI release gate. A server-only
        // candidate records that fact rather than fabricating a browser pass.
        clientHiddenPrepare: () => ({ status: 'skipped' as const, code: 'server-only-profile' }),
    });
    return { ok: result.status === 'passed', workspaceId, ...result };
});
