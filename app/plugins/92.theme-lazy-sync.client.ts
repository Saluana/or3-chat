import { defineNuxtPlugin } from '#app';
import { watch } from 'vue';

export default defineNuxtPlugin((nuxtApp) => {
    const theme = (nuxtApp as any).$theme;
    
    // Only setup if theme plugin is available
    if (!theme || !theme.activeTheme) return;

    // Use a Set to track lazy components (regular Set, not WeakSet)
    // This allows us to iterate and force update when theme changes
    const MAX_TRACKED_COMPONENTS = 1000;
    const lazyComponents = new Set<any>();
    let scheduledFrame: number | null = null;

    const isComponentStale = (component: any) => {
        if (!component) return true;
        const instance = component.$;
        if (instance?.isUnmounted) return true;
        const el = component.$el as HTMLElement | undefined;
        return Boolean(el && !el.isConnected);
    };

    const pruneLazyComponents = () => {
        for (const component of lazyComponents) {
            if (isComponentStale(component)) {
                lazyComponents.delete(component);
            }
        }
    };

    const getUpdateToken = () => {
        const version = theme.resolversVersion?.value ?? 0;
        return `${theme.activeTheme.value}:${version}`;
    };

    const scheduleForceUpdate = () => {
        if (scheduledFrame !== null) {
            return;
        }

        scheduledFrame = requestAnimationFrame(() => {
            scheduledFrame = null;
            pruneLazyComponents();
            lazyComponents.forEach((component) => {
                // Check if component is still mounted
                if (component && component.$forceUpdate) {
                    component.$forceUpdate();
                }
            });
        });
    };

    const globalUnwatch = watch(
        getUpdateToken,
        () => {
            // Force update all tracked lazy components when theme changes
            scheduleForceUpdate();
        },
        { flush: 'post' }
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
            if (lazyComponents.size >= MAX_TRACKED_COMPONENTS) {
                pruneLazyComponents();
            }
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
            if (scheduledFrame !== null) {
                cancelAnimationFrame(scheduledFrame);
            }
            globalUnwatch();
            lazyComponents.clear();
        });
    }
});
