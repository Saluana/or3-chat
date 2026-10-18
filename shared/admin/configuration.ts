/** Only these non-secret settings have verified runtime activation. */
export const restartSettingKeys = new Set(['OR3_AUTH_REGISTRATION_MODE', 'OR3_ADMIN_ALLOW_RESTART']);
export type ConfigurationApplication = 'runtime' | 'restart' | 'build' | 'unsupported';
export function configurationApplication(key: string): ConfigurationApplication {
    if (restartSettingKeys.has(key)) return 'restart';
    if (/^OR3_(DEFAULT_THEME|DISABLED_THEMES|SITE_|THEME_|UI_|FEATURE_)/.test(key)) return 'build';
    return 'unsupported';
}
