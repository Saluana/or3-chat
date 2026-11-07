/**
 * @module server/api/admin/system/status.get
 *
 * Purpose:
 * Aggregates health metrics and configuration status from all active providers.
 */
import { defineEventHandler } from 'h3';
import { requireAdminApi } from '../../../admin/api';
import { readProviderStatuses } from '../../../admin/providers/checks';
import { getBackgroundRecoveryObservation } from '../../../utils/background-jobs/recovery';

/**
 * GET /api/admin/system/status
 *
 * Purpose:
 * Dashboard "Control Panel" data source.
 *
 * Behavior:
 * - Queries Auth, Sync, and Storage providers concurrently for their status.
 * - Collects warnings (e.g. "Storage not connected", "Sync lagging").
 * - Returns feature flags for admin capabilities (rebuild/restart).
 *
 * Response:
 * - `status`: { auth, sync, storage, ... }
 * - `warnings`: Flat list of all warnings.
 * - `session`: Context info.
 */
export default defineEventHandler(async (event) => {
    const session = await requireAdminApi(event);

    const config = useRuntimeConfig();

    const { auth, sync, storage } = await readProviderStatuses(event, config);

    const status = {
        auth,
        sync,
        storage,
        backgroundStreaming: {
            enabled: Boolean(config.backgroundJobs.enabled),
            storageProvider: config.backgroundJobs.storageProvider,
            recovery: getBackgroundRecoveryObservation(),
        },
        admin: {
            allowRestart: Boolean(config.admin.allowRestart),
            allowRebuild: Boolean(config.admin.allowRebuild),
        },
    };

    const warnings = [
        ...auth.warnings,
        ...sync.warnings,
        ...storage.warnings,
    ];

    return {
        status,
        warnings,
        session: {
            workspaceId: session.workspace?.id,
            role: session.role,
        },
    };
});
