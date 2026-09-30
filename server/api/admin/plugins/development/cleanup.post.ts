import { createError, defineEventHandler, readBody } from 'h3';
import { z } from 'zod';
import { requireAdminApiContext } from '../../../../admin/api';
import { PluginPackageLifecycleService } from '../../../../admin/plugins/package-lifecycle';
import { pluginPackageServices } from '../../../../admin/plugins/package-operation-support';
import { getWorkspaceSettingsStore } from '../../../../admin/stores/registry';
import { requireWatchedProfile, readWatchStatus } from '../../../../utils/plugins/development/watched-candidate';

const Body = z.object({
    pluginId: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/),
    selectedDigest: z.string().regex(/^sha256-[a-f0-9]{64}$/),
});

/** Prune only this watched plugin's unreferenced immutable package copies. */
export default defineEventHandler(async (event) => {
    await requireAdminApiContext(event, { ownerOnly: true, mutation: true, superAdminOnly: true });
    const profile = await requireWatchedProfile(event);
    const body = Body.safeParse(await readBody(event));
    if (!body.success) throw createError({ statusCode: 400, statusMessage: 'Invalid cleanup target.' });
    const status = await readWatchStatus(profile);
    const watchedPluginId = status.candidate?.pluginId ?? status.lastGood?.pluginId;
    if (!watchedPluginId || watchedPluginId !== body.data.pluginId) {
        throw createError({ statusCode: 409, statusMessage: 'The watched plugin changed. Refresh development status.' });
    }
    const services = pluginPackageServices(getWorkspaceSettingsStore(event));
    const pointer = await services.pointers.readPointer(watchedPluginId);
    if (pointer?.current?.packageDigest !== body.data.selectedDigest) {
        throw createError({ statusCode: 409, statusMessage: 'The selected package changed. Refresh development status.' });
    }
    const result = await new PluginPackageLifecycleService(
        services.packages, services.pointers, services.settings,
    ).garbageCollectUnreferencedVersions(watchedPluginId);
    return { ok: true, ...result };
});
