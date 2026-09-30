/**
 * @module server/api/admin/workspaces/[id].get
 *
 * Purpose:
 * Retrieves detailed information about a specific workspace from the super admin perspective.
 */
import { defineEventHandler, getRouterParam, createError } from 'h3';
import { requireAdminApiContext } from '../../../admin/api';
import {
    getWorkspaceAccessStore,
    getWorkspaceSettingsStore,
} from '../../../admin/stores/registry';
import { isAdminEnabled } from '../../../utils/admin/is-admin-enabled';
import { enforceGenericAdminRateLimit } from '../../../admin/auth/rate-limit';
import { PLUGIN_PROVISIONING_REPAIRS_KEY, type PluginProvisioningRepair } from '../../../workspaces/provisioning';

/**
 * GET /api/admin/workspaces/:id
 *
 * Purpose:
 * Fetch full workspace metadata + member list.
 *
 * Behavior:
 * - Rate limited.
 * - Requires super admin context (via `requireAdminApiContext` and typically `super_admin` role implied by route).
 * - Returns 404 if not found.
 */
export default defineEventHandler(async (event) => {
    // Admin must be enabled
    if (!isAdminEnabled(event)) {
        throw createError({
            statusCode: 404,
            statusMessage: 'Not Found',
        });
    }

    // Rate limit check
    enforceGenericAdminRateLimit(event);

    // Require admin context
    await requireAdminApiContext(event, { superAdminOnly: true });

    // Get workspace ID
    const workspaceId = getRouterParam(event, 'id');
    if (!workspaceId) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Workspace ID is required',
        });
    }

    // Get workspace store
    const store = getWorkspaceAccessStore(event);

    // Get workspace
    const workspace = await store.getWorkspace({ workspaceId });

    if (!workspace) {
        throw createError({
            statusCode: 404,
            statusMessage: 'Workspace not found',
        });
    }

    const settingsStore = getWorkspaceSettingsStore(event);
    const [members, guestAccessValue, repairsRaw] = await Promise.all([
        store.listMembers({ workspaceId }),
        settingsStore.get(workspaceId, 'admin.guest_access.enabled'),
        settingsStore.get(workspaceId, PLUGIN_PROVISIONING_REPAIRS_KEY),
    ]);

    let pluginProvisioningRepairs: PluginProvisioningRepair[] = [];
    if (repairsRaw) {
        try {
            const parsed: unknown = JSON.parse(repairsRaw);
            if (Array.isArray(parsed)) {
                pluginProvisioningRepairs = parsed.slice(0, 100).filter((repair): repair is PluginProvisioningRepair =>
                    repair !== null && typeof repair === 'object' &&
                    typeof repair.message === 'string' &&
                    (repair.pluginId === null || typeof repair.pluginId === 'string') &&
                    (repair.operationId === null || typeof repair.operationId === 'string')
                );
            }
        } catch { /* A corrupt repair note does not hide the workspace. */ }
    }

    return {
        ...workspace,
        members,
        guestAccessEnabled: guestAccessValue === 'true',
        pluginProvisioningRepairs,
    };
});
