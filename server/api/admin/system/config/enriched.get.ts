/**
 * @module server/api/admin/system/config/enriched.get
 *
 * Purpose:
 * Retrieves the system configuration with metadata (descriptions, types, defaults).
 */
import { defineEventHandler } from 'h3';
import { requireAdminApi } from '../../../../admin/api';
import { readEnrichedConfigEntries } from '../../../../admin/config/config-manager';

/**
 * GET /api/admin/system/config/enriched
 *
 * Purpose:
 * Provides configuration schema and current values for the Admin UI settings editor.
 *
 * Behavior:
 * - Reads `or3.config.json` (or equivalent).
 * - Merges with static schema definitions (labels, tooltips).
 * - Masks sensitive values if configured (though usually admin sees all).
 */
export default defineEventHandler(async (event) => {
    await requireAdminApi(event);

    const entries = await readEnrichedConfigEntries();

    return { entries };
});
