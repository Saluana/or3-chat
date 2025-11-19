import { defineNuxtPlugin } from '#app';
import { useUserThemeOverrides } from '~/core/theme/useUserThemeOverrides';

export default defineNuxtPlugin((nuxtApp) => {
    if (import.meta.server) return;

    const themeOverrides = useUserThemeOverrides();

    // Ensure current overrides are applied once Nuxt finishes mounting
    nuxtApp.hook('app:mounted', () => {
        themeOverrides.reapply();
    });
});
