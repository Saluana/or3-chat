import type { ThemePlugin } from '~/plugins/90.theme.client';

declare module '#app' {
    interface NuxtApp {
        $theme: ThemePlugin;
    }
}

declare module 'vue' {
    interface ComponentCustomProperties {
        $theme: ThemePlugin;
    }
}

export {};
