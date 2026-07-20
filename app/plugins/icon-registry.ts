import { defineNuxtPlugin } from '#app';
import {
    IconRegistry,
    iconRegistry,
    type IconRegistryState,
} from '~/theme/_shared/icon-registry';

export default defineNuxtPlugin((nuxtApp) => {
    const requestRegistry = import.meta.server
        ? ((nuxtApp as unknown as { $iconRegistry?: IconRegistry })
              .$iconRegistry ?? new IconRegistry())
        : iconRegistry;

    // Hydrate icon registry state from server to client to prevent hydration mismatches
    if (import.meta.server) {
        nuxtApp.hook('app:rendered', () => {
            nuxtApp.payload.iconRegistry = requestRegistry.state;
        });
    } else if (import.meta.client && nuxtApp.payload.iconRegistry) {
        requestRegistry.hydrate(
            nuxtApp.payload.iconRegistry as IconRegistryState
        );
    }

    if (
        import.meta.server &&
        (nuxtApp as unknown as { $iconRegistry?: IconRegistry }).$iconRegistry
    ) {
        return;
    }

    return {
        provide: {
            iconRegistry: requestRegistry,
        },
    };
});
