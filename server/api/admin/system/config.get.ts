/**
 * @module server/api/admin/system/config.get
 *
 * Purpose:
 * Retrieves raw system configuration values.
 */
import { defineEventHandler } from 'h3';
import { requireAdminApi } from '../../../admin/api';
import { readConfigEntries } from '../../../admin/config/config-manager';

/**
 * GET /api/admin/system/config
 *
 * Purpose:
 * Fetch current config values without schema metadata.
 *
 * Behavior:
 * - Lightweight alternative to `/enriched`.
 * - Used for programmatic access or simple displays.
 */
export default defineEventHandler(async (event) => {
    await requireAdminApi(event);

    const entries = await readConfigEntries();

    return { entries };
});
