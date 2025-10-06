// Early load & apply of persisted theme customization settings.
// Runs on client only; relies on HMR-safe singleton inside useThemeSettings.
import { defineNuxtPlugin } from '#app';
import { useThemeSettings } from '~/core/theme/useThemeSettings';

export default defineNuxtPlugin(() => {
    // Access composable to trigger lazy load + immediate apply.
    const { reapply } = useThemeSettings();
    // In case variant classes are added slightly later, schedule a microtask reapply.
    queueMicrotask(() => reapply());
});
