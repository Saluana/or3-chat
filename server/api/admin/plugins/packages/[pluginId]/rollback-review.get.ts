import { createError, defineEventHandler, getRouterParam, setResponseHeader } from 'h3';
import { requireAdminApiContext } from '../../../../../admin/api';
import { getWorkspaceSettingsStore } from '../../../../../admin/stores/registry';
import { pluginPackageServices, readPackageManifest } from '../../../../../admin/plugins/package-operation-support';
import { enabledWorkspaceFingerprint, prepareRollbackWorkspacePreflight } from '../../../../../admin/plugins/rollback-workspaces';

export default defineEventHandler(async (event) => {
    await requireAdminApiContext(event, { ownerOnly: true, superAdminOnly: true });
    setResponseHeader(event, 'Cache-Control', 'no-store');
    const pluginId = getRouterParam(event, 'pluginId');
    if (!pluginId || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(pluginId)) throw createError({ statusCode: 400, statusMessage: 'Invalid plugin' });
    const services = pluginPackageServices(getWorkspaceSettingsStore(event));
    const pointer = await services.pointers.readPointer(pluginId);
    if (!pointer?.current || !pointer.previous) throw createError({ statusCode: 409, statusMessage: 'No previous version is available to restore.' });
    try {
        await services.packages.verifyStoredPackage(pluginId, pointer.previous.packageDigest);
        const [current, previous, check] = await Promise.all([
            readPackageManifest(services.packages.packagePath(pluginId, pointer.current.packageDigest)),
            readPackageManifest(services.packages.packagePath(pluginId, pointer.previous.packageDigest)),
            prepareRollbackWorkspacePreflight(event, services, pluginId, pointer.previous),
        ]);
        const impact = await check({ current: pointer.current, previous: pointer.previous });
        return { ok: impact.blocking.length === 0, pluginId, currentVersion: current.version, previousVersion: previous.version,
            currentDigest: pointer.current.packageDigest, previousDigest: pointer.previous.packageDigest,
            pointerRevision: pointer.revision, enabledWorkspaces: impact.checked,
            enabledWorkspaceIds: impact.enabledWorkspaceIds,
            enabledWorkspaceSha256: enabledWorkspaceFingerprint(impact.enabledWorkspaceIds),
            blocking: impact.blocking };
    } catch {
        throw createError({ statusCode: 409, statusMessage: 'The previous release cannot be verified for rollback.' });
    }
});
