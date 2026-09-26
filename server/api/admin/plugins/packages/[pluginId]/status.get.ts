import { createError, defineEventHandler, getQuery, getRouterParam } from 'h3';
import { requireAdminApiContext } from '../../../../../admin/api';
import { resolveAdminWorkspaceTarget } from '../../../../../admin/workspace-target';
import { getWorkspaceSettingsStore } from '../../../../../admin/stores/registry';
import { getEnabledPlugins } from '../../../../../admin/plugins/workspace-plugin-store';
import { ImmutablePluginPackageStore } from '../../../../../admin/plugins/package-store';
import { PluginPackagePointerStore } from '../../../../../admin/plugins/package-pointer-store';
import { readLocalAdmission } from '../../../../../admin/plugins/local-admission';

/** Read-only operator status. It deliberately returns identities and lifecycle
 * slots, never package files, settings, grants, or canary state snapshots. */
export default defineEventHandler(async (event) => {
    const context = await requireAdminApiContext(event, {
        ownerOnly: true,
        superAdminOnly: true,
    });
    const pluginId = getRouterParam(event, 'pluginId');
    if (!pluginId) {
        throw createError({ statusCode: 400, statusMessage: 'Missing plugin id' });
    }
    const query = getQuery(event);
    const workspaceId = resolveAdminWorkspaceTarget(
        context,
        typeof query.workspaceId === 'string' ? query.workspaceId : undefined
    );
    const packages = new ImmutablePluginPackageStore();
    const pointers = new PluginPackagePointerStore(undefined, packages);
    const [pointer, selection, enabled] = await Promise.all([
        pointers.readPointer(pluginId),
        pointers.readStartupSelection(pluginId),
        getEnabledPlugins(getWorkspaceSettingsStore(event), workspaceId),
    ]);
    // Local-development provenance is explicit per digest: a locally admitted
    // candidate is labeled and never presented as a marketplace release.
    const [currentAdmission, candidateAdmission] = await Promise.all([
        pointer?.current?.packageDigest
            ? readLocalAdmission(pluginId, pointer.current.packageDigest)
            : null,
        pointer?.candidate?.packageDigest
            ? readLocalAdmission(pluginId, pointer.candidate.packageDigest)
            : null,
    ]);
    return {
        pluginId,
        workspaceId,
        workspaceEnabled: enabled.includes(pluginId),
        pointer,
        startup: {
            status: selection.status,
            selectedSlot: selection.selectedSlot,
            selectedDigest: selection.selected?.packageDigest ?? null,
            issueCodes: selection.issues.map((issue) => issue.code),
        },
        localAdmission: {
            current: currentAdmission
                ? { provenance: 'local-development', receiptSha256: currentAdmission.receiptSha256, admittedAt: currentAdmission.admittedAt }
                : null,
            candidate: candidateAdmission
                ? { provenance: 'local-development', receiptSha256: candidateAdmission.receiptSha256, admittedAt: candidateAdmission.admittedAt }
                : null,
        },
    };
});
