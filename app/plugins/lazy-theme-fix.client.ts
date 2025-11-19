import { defineNuxtPlugin, useNuxtApp } from '#app';
import { watch } from 'vue';

export default defineNuxtPlugin((nuxtApp) => {
    const unwatchers = new WeakMap<any, () => void>();

    nuxtApp.vueApp.mixin({
        beforeMount() {
            const opts = this.$options;

            // Vue adds __asyncLoader to any component created through defineAsyncComponent
            // This targets Nuxt's <lazy-...> components
            if (typeof opts.__asyncLoader !== 'function') {
                return;
            }

            const theme = (nuxtApp as any).$theme;
            if (!theme || !theme.resolversVersion) return;

            // Watch for changes in the theme resolvers (e.g. when a theme finishes loading)
            // and force the component to update. This fixes issues where lazy components
            // render before the theme is fully ready.
            const unwatch = watch(theme.resolversVersion, () => {
                this.$forceUpdate();
            });

            unwatchers.set(this, unwatch);
        },
        beforeUnmount() {
            const unwatch = unwatchers.get(this);
            if (unwatch) {
                unwatch();
                unwatchers.delete(this);
            }
        },
    });
});
