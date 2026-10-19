/** Public app settings that can be applied to each newly loaded page. */
export const siteSettingPaths = {
    OR3_SITE_NAME: ['or3', 'site', 'name'],
    OR3_SITE_DESCRIPTION: ['or3', 'site', 'description'],
    OR3_LOGO_URL: ['or3', 'site', 'logoUrl'],
    OR3_FAVICON_URL: ['or3', 'site', 'faviconUrl'],
    OR3_DEFAULT_THEME: ['or3', 'site', 'defaultTheme'],
    OR3_DISABLED_THEMES: ['or3', 'site', 'disabledThemes'],
    OR3_DEFAULT_PANE_COUNT: ['or3', 'ui', 'defaultPaneCount'],
    OR3_MAX_PANES: ['or3', 'ui', 'maxPanes'],
    OR3_SIDEBAR_COLLAPSED: ['or3', 'ui', 'sidebarCollapsedByDefault'],
    OR3_TERMS_URL: ['or3', 'legal', 'termsUrl'],
    OR3_PRIVACY_URL: ['or3', 'legal', 'privacyUrl'],
    OR3_WORKFLOWS_ENABLED: ['features', 'workflows', 'enabled'],
    OR3_WORKFLOWS_EDITOR: ['features', 'workflows', 'editor'],
    OR3_WORKFLOWS_SLASH_COMMANDS: ['features', 'workflows', 'slashCommands'],
    OR3_WORKFLOWS_EXECUTION: ['features', 'workflows', 'execution'],
    OR3_DOCUMENTS_ENABLED: ['features', 'documents', 'enabled'],
    OR3_BACKUP_ENABLED: ['features', 'backup', 'enabled'],
    OR3_MENTIONS_ENABLED: ['features', 'mentions', 'enabled'],
    OR3_MENTIONS_DOCUMENTS: ['features', 'mentions', 'documents'],
    OR3_MENTIONS_CONVERSATIONS: ['features', 'mentions', 'conversations'],
    OR3_DASHBOARD_ENABLED: ['features', 'dashboard', 'enabled'],
} as const;
export type SiteSettingKey = keyof typeof siteSettingPaths;
export const siteSettingKeys = new Set<string>(Object.keys(siteSettingPaths));
export const restartSettingKeys = new Set(['OR3_AUTH_REGISTRATION_MODE', 'OR3_ADMIN_ALLOW_RESTART']);
export type ConfigurationApplication = 'runtime' | 'restart' | 'build' | 'unsupported';
export function configurationApplication(key: string): ConfigurationApplication {
    if (siteSettingKeys.has(key)) return 'runtime';
    if (restartSettingKeys.has(key)) return 'restart';
    return 'unsupported';
}
