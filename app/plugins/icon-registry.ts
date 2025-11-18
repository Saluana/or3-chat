import { defineNuxtPlugin } from '#app';
import { iconRegistry, IconRegistry } from '~/theme/_shared/icon-registry';

export default defineNuxtPlugin((nuxtApp) => {
    // We can use the singleton exported from the module,
    // or create a new one here if we wanted strict isolation per request (for SSR).
    // Since the registry is mostly static config, the singleton is fine,
    // but let's ensure we have a clean state if needed.

    return {
        provide: {
            iconRegistry: iconRegistry,
        },
    };
});
