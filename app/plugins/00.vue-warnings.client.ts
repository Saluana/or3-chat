/**
 * Vue Warning Filter Plugin
 * 
 * Suppresses specific Vue warnings that are expected and don't indicate problems.
 */

export default defineNuxtPlugin((nuxtApp) => {
    const app = nuxtApp.vueApp;

    // Store the original warn handler
    const originalWarn = app.config.warnHandler;

    // Custom warning handler
    app.config.warnHandler = (msg, instance, trace) => {
        // Suppress the "Runtime directive used on component with non-element root node" warning
        // This is expected when using v-theme on Nuxt UI components and doesn't indicate a problem
        if (msg.includes('Runtime directive used on component with non-element root node')) {
            return;
        }

        // Suppress known theme runtime SSR/client class drift on Nuxt UI controls.
        // v-theme and client-side theme enrichment can reorder/append classes after hydration.
        const isThemeHydrationClassMismatch =
            msg.includes('Hydration class mismatch') &&
            (msg.includes('theme-btn') ||
                msg.includes('theme-shadow') ||
                msg.includes('retro-press'));
        if (isThemeHydrationClassMismatch) {
            return;
        }

        // Call original handler for other warnings
        if (originalWarn) {
            originalWarn(msg, instance, trace);
        } else if (import.meta.dev) {
            console.warn(`[Vue warn]: ${msg}`, trace);
        }
    };
});
