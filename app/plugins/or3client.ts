/**
 * OR3 Client Nuxt Plugin
 *
 * Injects the OR3 Client as `$or3client` into the Nuxt app context.
 * The client is a singleton on the client side and per-request on the server.
 *
 * @example
 * // In a plugin or component
 * const { $or3client } = useNuxtApp();
 * $or3client.ui.sidebar.pages.register({ ... });
 */

import { createOR3Client, type OR3Client } from '~/core/or3client';

export default defineNuxtPlugin({
    name: 'or3client',
    enforce: 'pre', // Load early so other plugins can use it
    setup() {
        // Create a new client instance
        // On server: one instance per request (SSR isolation)
        // On client: singleton instance (persists across navigation)
        const client = createOR3Client();

        return {
            provide: {
                or3client: client,
            },
        };
    },
});

// Type augmentation for Nuxt app
declare module '#app' {
    interface NuxtApp {
        $or3client: OR3Client;
    }
}

declare module 'vue' {
    interface ComponentCustomProperties {
        $or3client: OR3Client;
    }
}
