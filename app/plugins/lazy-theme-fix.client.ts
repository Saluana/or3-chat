import { defineNuxtPlugin, useNuxtApp } from '#app';
import { watch } from 'vue';

export default defineNuxtPlugin((nuxtApp) => {
    const theme = (nuxtApp as any).$theme;
    
    // Only setup if theme plugin is available
    if (!theme || !theme.activeTheme) return;

    // Use a Set to track lazy components (regular Set, not WeakSet)
    // This allows us to iterate and force update when theme changes
    const lazyComponents = new Set<any>();

    const globalUnwatch = watch(
        () => theme.activeTheme.value,
        () => {
            // Force update all tracked lazy components when theme changes
            requestAnimationFrame(() => {
                lazyComponents.forEach((component) => {
                    // Check if component is still mounted
                    if (component && component.$forceUpdate) {
                        component.$forceUpdate();
                    }
                });
            });
        }
    );

    nuxtApp.vueApp.mixin({
        beforeMount() {
            const opts = this.$options;

            // Vue adds __asyncLoader to any component created through defineAsyncComponent
            // This targets Nuxt's <lazy-...> components
            if (typeof opts.__asyncLoader !== 'function') {
                return;
            }

            // Track lazy component for theme updates
            lazyComponents.add(this);
        },
        beforeUnmount() {
            // Clean up when component unmounts
            lazyComponents.delete(this);
        },
    });

    // Cleanup global watcher on hot reload
    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            globalUnwatch();
            lazyComponents.clear();
        });
    }
});
