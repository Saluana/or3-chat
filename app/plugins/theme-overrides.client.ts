import { defineNuxtPlugin } from '#app';
import { useUserThemeOverrides } from '~/core/theme/useUserThemeOverrides';
import { useThemeAccessibilityPreferences } from '~/core/theme/useThemeAccessibilityPreferences';

export default defineNuxtPlugin(() => {
    if (import.meta.server) return;
    useUserThemeOverrides();
    useThemeAccessibilityPreferences();
});
