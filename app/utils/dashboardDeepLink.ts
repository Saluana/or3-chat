/**
 * @module app/utils/dashboardDeepLink
 *
 * Purpose:
 * The supported deep link for dashboard apps: `?dashboard=<pluginId>&page=<pageId>`.
 * A link that nothing reads is not a deep link, so parsing lives here and the
 * app shell is the only place that opens the modal.
 *
 * Behavior:
 * - A missing or malformed `dashboard` value is not a link.
 * - A missing `page` resolves to the app's first registered page.
 *
 * Constraints:
 * - Pure: no router, no DOM, no dashboard registry import.
 *
 * Non-Goals:
 * - Knowing which dashboard apps exist (the caller supplies the resolved state).
 */

export interface DashboardDeepLink {
    readonly pluginId: string;
    /** Present only when the link names one. */
    readonly pageId: string | null;
}

const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const PAGE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;

/** Read a dashboard deep link out of a route query, or null when there is none. */
export function parseDashboardDeepLink(
    query: Readonly<Record<string, unknown>>
): DashboardDeepLink | null {
    const pluginId = query.dashboard;
    if (typeof pluginId !== 'string' || !PLUGIN_ID_PATTERN.test(pluginId)) return null;
    const page = query.page;
    const pageId =
        typeof page === 'string' && PAGE_ID_PATTERN.test(page) ? page : null;
    return { pluginId, pageId };
}

/**
 * The page to open for a link: the named page when the link has one, otherwise
 * the app's first registered page.
 */
export function dashboardDeepLinkPageId(
    link: DashboardDeepLink,
    registeredPageIds: readonly string[]
): string | null {
    if (link.pageId) return link.pageId;
    return registeredPageIds[0] ?? null;
}
