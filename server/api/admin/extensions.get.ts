/**
 * @module server/api/admin/extensions.get
 *
 * Purpose:
 * Lists all installed extensions (plugins and themes) available in the system.
 */
import { defineEventHandler } from 'h3';
import { requireAdminApi } from '../../admin/api';
import { listInstalledExtensions } from '../../admin/extensions/extension-manager';

/**
 * GET /api/admin/extensions
 *
 * Purpose:
 * Retrieves a registry of all installed extensions.
 *
 * Behavior:
 * - Scans extension directories or registry
 * - Returns metadata for both plugins and themes
 *
 * Security:
 * - Gated by `requireAdminApi`
 */
export default defineEventHandler(async (event) => {
    await requireAdminApi(event);

    const items = await listInstalledExtensions();

    return { items };
});
