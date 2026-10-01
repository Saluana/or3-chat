/**
 * @module server/api/admin/plugins/workspace-enable.post
 *
 * Purpose:
 * Toggles a plugin's active state for a specific workspace.
 */
import { defineEventHandler, readBody, createError } from 'h3';
import { z } from 'zod';
import { requireAdminApiContext } from '../../../admin/api';
import { getWorkspaceSettingsStore } from '../../../admin/stores/registry';
import { setPluginEnabled } from '../../../admin/plugins/workspace-plugin-store';
import { assertExpectedAdminWorkspace, resolveAdminWorkspaceTarget } from '../../../admin/workspace-target';
import { revokeHostActivationsForPluginWorkspace } from '../../../utils/plugins/isolation/activation-registry';
import { ImmutablePluginPackageStore } from '../../../admin/plugins/package-store';
import { PluginPackagePointerStore } from '../../../admin/plugins/package-pointer-store';
import { PluginPackageRouteCatalog } from '../../../admin/plugins/package-route-catalog';
import { readLocalAdmission } from '../../../admin/plugins/local-admission';
import { readAdminUploadProvenance } from '../../../admin/plugins/admin-upload-provenance';
import { approvedSiteRelease } from '../../../admin/plugins/site-policy-service';
import { SitePluginPolicyStore } from '../../../admin/plugins/site-policy';
import { listInstalledExtensions } from '../../../admin/extensions/extension-manager';

const BodySchema = z.object({
    pluginId: z.string().min(1),
    enabled: z.boolean(),
    workspaceId: z.string().min(1).optional(),
    expectedWorkspaceId: z.string().min(1).optional(),
});

/**
 * POST /api/admin/plugins/workspace-enable
 *
 * Purpose:
 * Enable/Disable a plugin.
 *
 * Behavior:
 * - Updates the workspace-specific implementation of plugin state (e.g. `enabled_plugins` setting).
 * - Emits `admin.plugin:action:enabled` or `disabled`.
 * - Returns the updated list of enabled plugins.
 */
export default defineEventHandler(async (event) => {
    const context = await requireAdminApiContext(event, {
        ownerOnly: true,
        mutation: true,
        allowWorkspaceAdmin: true,
    });

    const body = BodySchema.safeParse(await readBody(event));
    if (!body.success) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid request' });
    }

    assertExpectedAdminWorkspace(context, body.data.expectedWorkspaceId);

    const workspaceId = resolveAdminWorkspaceTarget(
        context,
        body.data.workspaceId
    );

    const store = getWorkspaceSettingsStore(event);
    const packages = new ImmutablePluginPackageStore();
    const pointers = new PluginPackagePointerStore(undefined, packages);
    const initialSelection = await pointers.readStartupSelection(body.data.pluginId).catch(() => {
        if (body.data.enabled) throw createError({ statusCode: 503, statusMessage: 'The plugin selection could not be checked. Retry before enabling it.' });
        return null;
    });
    const initialDigest = initialSelection?.selected?.packageDigest;
    if (body.data.enabled && (initialSelection?.status !== 'ready' || initialSelection.selectedSlot !== 'current' || !initialDigest)) {
        const sourceInstalled = initialSelection?.status === 'inactive' && !initialSelection.pointer &&
            (await listInstalledExtensions()).some((extension) => extension.kind === 'plugin' && extension.id === body.data.pluginId);
        if (!sourceInstalled) throw createError({ statusCode: 409, statusMessage: 'Install and verify the selected plugin version before enabling it.' });
    }
    const localAdmission = initialDigest
        ? await readLocalAdmission(body.data.pluginId, initialDigest) || await readAdminUploadProvenance(body.data.pluginId, initialDigest)
        : null;
    let reviewedPolicy = null;
    if (body.data.enabled && initialDigest && !localAdmission) {
        const manifest = await new PluginPackageRouteCatalog(packages, pointers)
            .readManifest(body.data.pluginId, initialDigest).catch(() => null);
        reviewedPolicy = manifest?.status === 'ready'
            ? await approvedSiteRelease(body.data.pluginId, manifest.manifest.version).catch(() => {
                throw createError({ statusCode: 503, statusMessage: 'Site approval could not be verified. Retry after checking the marketplace registry.' });
            })
            : null;
        if (!reviewedPolicy || reviewedPolicy.approvedRelease.packageTreeSha256 !== initialDigest) {
            throw createError({ statusCode: 409, statusMessage: 'This release needs site approval before it can be enabled in a new workspace.', data: { code: 'site-approval-required' } });
        }
    }
    const apply = async () => {
        if (body.data.enabled && initialDigest) {
            const current = await pointers.readStartupSelection(body.data.pluginId);
            if (current.selected?.packageDigest !== initialDigest || current.status !== 'ready') {
                throw createError({ statusCode: 409, statusMessage: 'The selected plugin version changed. Review it again.' });
            }
            if (reviewedPolicy) {
                const policy = await new SitePluginPolicyStore().read(body.data.pluginId);
                if (!policy?.catalogVisible || policy.revision !== reviewedPolicy.revision) {
                    throw createError({ statusCode: 409, statusMessage: 'Site approval changed. Review it again.' });
                }
            }
        }
        return setPluginEnabled(store, workspaceId, body.data.pluginId, body.data.enabled);
    };
    const enabledList = initialDigest
        ? await packages.runPluginOperation(body.data.pluginId, apply)
        : await apply();

    if (!body.data.enabled) {
        // Disable ends execution immediately: revoke live handles and abort
        // their in-flight capability calls instead of letting them run until
        // the next call lazily notices the disable.
        revokeHostActivationsForPluginWorkspace(
            body.data.pluginId,
            workspaceId,
            'plugin-disabled'
        );
    }

    await event.context.adminHooks?.doAction(
        body.data.enabled
            ? 'admin.plugin:action:enabled'
            : 'admin.plugin:action:disabled',
        {
            id: body.data.pluginId,
            workspaceId,
        }
    );

    return { ok: true, enabled: enabledList };
});
