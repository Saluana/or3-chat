// PWA types augmentation for Nuxt config and app injection
import type { PwaModuleOptions } from '@vite-pwa/nuxt';

declare module 'nuxt/schema' {
    interface NuxtConfig {
        pwa?: PwaModuleOptions;
    }
    interface NuxtOptions {
        pwa?: PwaModuleOptions;
    }
}

declare module '#app' {
    interface NuxtApp {
        $pwa: any;
    }
}

export {};
