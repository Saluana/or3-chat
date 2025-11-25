import { defineNuxtPlugin } from '#app';
import {
    iconRegistry,
    type IconRegistryState,
} from '~/theme/_shared/icon-registry';

export default defineNuxtPlugin((nuxtApp) => {
    // Hydrate icon registry state from server to client to prevent hydration mismatches
    if (import.meta.server) {
        nuxtApp.hook('app:rendered', () => {
            nuxtApp.payload.iconRegistry = iconRegistry.state;
        });
    } else if (import.meta.client && nuxtApp.payload.iconRegistry) {
        iconRegistry.hydrate(nuxtApp.payload.iconRegistry as IconRegistryState);
    }

    return {
        provide: {
            iconRegistry: iconRegistry,
        },
    };
});
