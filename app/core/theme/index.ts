// Barrel export for core/theme module
export { applyToRoot } from './theme-apply';
export {
    DEFAULT_THEME_SETTINGS,
    DEFAULT_THEME_SETTINGS_LIGHT,
    DEFAULT_THEME_SETTINGS_DARK,
    THEME_SETTINGS_STORAGE_KEY,
    THEME_SETTINGS_STORAGE_KEY_LIGHT,
    THEME_SETTINGS_STORAGE_KEY_DARK,
} from './theme-defaults';
export {
    useThemeSettings,
    sanitize,
    detectModeFromHtml,
} from './useThemeSettings';
export type { ThemeSettings, ThemeMode } from './theme-types';
