import type { ThemePlugin } from '~/theme/_shared/types';

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
