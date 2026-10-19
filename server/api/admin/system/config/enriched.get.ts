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

import { useRuntimeConfig } from '#imports';
import { readSiteSettings, siteSettingValues, siteThemes } from '../../../../admin/config/site-settings';
import { siteSettingKeys } from '../../../../../shared/admin/configuration';

export default defineEventHandler(async (event) => {
    await requireAdminApi(event);
    setResponseHeader(event, 'Cache-Control', 'no-store');

    const site = await readSiteSettings();
    const activeValues = siteSettingValues(useRuntimeConfig(event));
    const entries = await readEnrichedConfigEntries();
    const lifecycle = hasRestartController() ? await readRestartStatus() : null;
    for (const entry of entries) {
        if (siteSettingKeys.has(entry.key)) {
            entry.value = site.values[entry.key] ?? activeValues[entry.key] ?? null;
            entry.editable = true;
        }
        if (entry.key === 'OR3_ADMIN_ALLOW_RESTART' && lifecycle?.savedSettings) {
            entry.value = String(lifecycle.savedSettings.allowRestart);
            entry.editable = lifecycle.capability.applySaved;
        }
        if (entry.key === 'OR3_AUTH_REGISTRATION_MODE' && lifecycle?.savedSettings) entry.value = lifecycle.savedSettings.registrationMode;
    }

    return { entries, siteRevision: site.revision, themes: siteThemes, savedRevision: lifecycle?.savedRevision ?? null };
});
