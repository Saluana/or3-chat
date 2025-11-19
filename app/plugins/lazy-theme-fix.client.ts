import { defineNuxtPlugin, useNuxtApp } from '#app';
import { watch } from 'vue';

export default defineNuxtPlugin((nuxtApp) => {
    const unwatchers = new WeakMap<any, () => void>();
    const theme = (nuxtApp as any).$theme;
    
    // Only setup if theme plugin is available
    if (!theme || !theme.activeTheme) return;

    // Use a single global watcher instead of per-component watchers
    // This dramatically reduces memory usage
    let pendingUpdate = false;
    const lazyComponents = new WeakSet();

    const globalUnwatch = watch(
        () => theme.activeTheme.value,
        () => {
            // Debounce updates to avoid excessive re-renders
            if (pendingUpdate) return;
            pendingUpdate = true;
            
            requestAnimationFrame(() => {
                pendingUpdate = false;
                // Force update will be triggered by next mount/update cycle
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

            // Mark as lazy component
            lazyComponents.add(this);
            
            // Only force update if theme recently changed
            if (pendingUpdate) {
                this.$forceUpdate();
            }
        },
        beforeUnmount() {
            lazyComponents.delete(this);
        },
    });

    // Cleanup global watcher on hot reload
    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            globalUnwatch();
        });
    }
});
