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
import { projectConfigSources } from '../../../../admin/config/config-projection';

export default defineEventHandler(async (event) => {
    await requireAdminApi(event);
    setResponseHeader(event, 'Cache-Control', 'no-store');

    const site = await readSiteSettings();
    const activeValues = siteSettingValues(useRuntimeConfig(event));
    const runtime = useRuntimeConfig(event);
    const entries = projectConfigSources(await readEnrichedConfigEntries(), {
        siteKeys: siteSettingKeys, savedSite: site.values, activeSite: activeValues,
        hostedBilling: runtime.public.hostedBillingEnabled === true,
        // Read the same resolved values consumed by admission and request policy.
        // Only these fixed non-secret fields cross the projection boundary.
        effectiveValues: {
            OR3_BACKGROUND_STREAMING_ENABLED: String(runtime.backgroundJobs.enabled),
            OR3_BACKGROUND_STREAMING_PROVIDER: String(runtime.backgroundJobs.storageProvider),
            OR3_BACKGROUND_MAX_JOBS: String(runtime.backgroundJobs.maxConcurrentJobs),
            OR3_BACKGROUND_MAX_JOBS_PER_USER: String(runtime.backgroundJobs.maxConcurrentJobsPerUser),
            OR3_BACKGROUND_JOB_TIMEOUT: String(runtime.backgroundJobs.jobTimeoutMs / 1000),
            OR3_OPENROUTER_REQUIRE_USER_KEY: String(runtime.openrouterRequireUserKey),
            OR3_OPENROUTER_ALLOW_USER_OVERRIDE: String(runtime.openrouterAllowUserOverride),
            OR3_LIMITS_ENABLED: String(runtime.limits.enabled),
            OR3_LIMITS_STORAGE_PROVIDER: String(runtime.limits.storageProvider),
            OR3_REQUESTS_PER_MINUTE: String(runtime.limits.requestsPerMinute),
            OR3_AUTH_REGISTRATION_MODE: String(runtime.auth.registrationMode),
        },
    });
    const lifecycle = hasRestartController() ? await readRestartStatus() : null;
    for (const entry of entries) {
        if (entry.key === 'OR3_ADMIN_ALLOW_RESTART' && lifecycle?.savedSettings) {
            entry.value = String(lifecycle.savedSettings.allowRestart);
            entry.editable = lifecycle.capability.applySaved;
        }
        if (entry.key === 'OR3_AUTH_REGISTRATION_MODE' && lifecycle?.savedSettings) entry.value = lifecycle.savedSettings.registrationMode;
    }

    return { entries, siteRevision: site.revision, themes: siteThemes, savedRevision: lifecycle?.savedRevision ?? null };
});
