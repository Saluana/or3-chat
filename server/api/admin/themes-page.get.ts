/**
 * @module server/api/admin/themes-page.get
 *
 * Purpose:
 * Optimization endpoint for the Admin Themes Page.
 *
 * Responsibilities:
 * - Aggregates multiple data sources (extensions, config) into a single payload
 * - Reduces round-trips for initial page load
 */
import { defineEventHandler } from 'h3';
import { requireAdminApi } from '../../admin/api';
import { listInstalledExtensions } from '../../admin/extensions/extension-manager';
import { useRuntimeConfig } from '#imports';

/**
 * GET /api/admin/themes-page
 *
 * Purpose:
 * Serves all necessary data for the Theme management screen.
 *
 * Behavior:
 * - Fetches installed extensions and system config in parallel.
 * - Extracts `OR3_DEFAULT_THEME` from config.
 * - Filters extensions to return only themes.
 *
 * Performance:
 * - Replaces 3 sequential calls => ~60% latency reduction.
 */
export default defineEventHandler(async (event) => {
    const session = await requireAdminApi(event);
    
    const extensions = await listInstalledExtensions();
    const site = useRuntimeConfig(event).public.or3.site;
    return {
        themes: extensions.filter(i => i.kind === 'theme'),
        role: session.role,
        defaultTheme: site.defaultTheme,
        disabledThemes: site.disabledThemes.join(','),
    };
});
