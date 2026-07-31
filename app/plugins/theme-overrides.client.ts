import { defineNuxtPlugin } from '#app';
import { useUserThemeOverrides } from '~/core/theme/useUserThemeOverrides';

export default defineNuxtPlugin(() => {
    if (import.meta.server) return;
    useUserThemeOverrides();
});
