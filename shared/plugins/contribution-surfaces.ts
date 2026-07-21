export const PLUGIN_CONTRIBUTION_SURFACES = [
    'message-actions',
    'header-actions',
    'composer-actions',
    'sidebar-footer-actions',
    'document-history-actions',
    'thread-history-actions',
    'project-tree-actions',
    'editor-toolbar',
    'editor-inspector-panels',
    'document-ai-actions',
    'sidebar-sections',
    'pane-apps',
    'sidebar-pages',
    'dashboard',
    'dashboard-navigation',
    'editor-extensions',
    'admin-extensions',
    'client-tools',
    'server-tools',
] as const;

export type PluginContributionSurfaceId = (typeof PLUGIN_CONTRIBUTION_SURFACES)[number];

const SURFACE_IDS = new Set<string>(PLUGIN_CONTRIBUTION_SURFACES);

export function normalizePluginContributionSurfaces(
    values: readonly string[] | null | undefined
): readonly PluginContributionSurfaceId[] {
    return Object.freeze(
        Array.from(
            new Set(
                (values ?? [])
                    .map((value) => value.trim())
                    .filter((value): value is PluginContributionSurfaceId => SURFACE_IDS.has(value))
            )
        ).sort()
    );
}
