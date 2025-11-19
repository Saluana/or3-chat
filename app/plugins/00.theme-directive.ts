/**
 * Theme Directive Plugin (Universal - SSR Safe)
 * 
 * Registers the v-theme directive as a no-op for SSR.
 * The actual implementation is in auto-theme.client.ts which only runs on the client.
 * 
 * This prevents the "Failed to resolve directive: theme" warning during SSR.
 */

export default defineNuxtPlugin((nuxtApp) => {
    // Register a no-op directive for SSR
    // The client-side plugin will override this with the real implementation
    nuxtApp.vueApp.directive('theme', {
        // SSR no-op hooks
        getSSRProps() {
            // Return empty props for SSR - no props are added during SSR
            return {};
        },
    });
});
