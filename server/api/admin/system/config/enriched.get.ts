/**
 * @module server/api/admin/system/config/enriched.get
 *
 * Purpose:
 * Retrieves the system configuration with metadata (descriptions, types, defaults).
 */
import { defineEventHandler, setResponseHeader } from 'h3';
import { requireAdminApi } from '../../../../admin/api';
import { readEnrichedConfigEntries } from '../../../../admin/config/config-manager';
import { hasRestartController, readRestartStatus } from '../../../../admin/system/server-control';

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
    setResponseHeader(event, 'Cache-Control', 'no-store');

    const entries = await readEnrichedConfigEntries();
    const lifecycle = hasRestartController() ? await readRestartStatus() : null;
    for (const entry of entries) {
        if (entry.key === 'OR3_ADMIN_ALLOW_RESTART' && lifecycle?.savedSettings) {
            entry.value = String(lifecycle.savedSettings.allowRestart);
            entry.editable = lifecycle.capability.applySaved;
        }
        if (entry.key === 'OR3_AUTH_REGISTRATION_MODE' && lifecycle?.savedSettings) entry.value = lifecycle.savedSettings.registrationMode;
    }

    return { entries, savedRevision: lifecycle?.savedRevision ?? null };
});
