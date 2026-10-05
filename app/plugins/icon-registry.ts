import { defineNuxtPlugin } from '#app';
import {
    IconRegistry,
    iconRegistry,
} from '~/theme/_shared/icon-registry';

export default defineNuxtPlugin((nuxtApp) => {
    const requestRegistry = import.meta.server
        ? ((nuxtApp as unknown as { $iconRegistry?: IconRegistry })
              .$iconRegistry ?? new IconRegistry())
        : iconRegistry;

    // Client hydration runs before theme loading in 90.theme.client.ts.
    if (import.meta.server) {
        nuxtApp.hook('app:rendered', () => {
            nuxtApp.payload.iconRegistry = requestRegistry.state;
        });
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
