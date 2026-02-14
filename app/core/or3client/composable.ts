/**
 * OR3 Client Composable
 *
 * Use this composable to access the OR3 Client in Vue components.
 * The client is injected by the Nuxt plugin and provides access to all extension points.
 *
 * @example
 * const or3 = useOR3Client();
 * or3.ui.sidebar.pages.register({ ... });
 */

import { useNuxtApp } from '#app';
import type { OR3Client } from './client';

/**
 * Returns the OR3 Client instance.
 * Must be called within a Nuxt plugin or Vue component context.
 *
 * @throws Error if OR3Client is not available (plugin not loaded)
 */
export function useOR3Client(): OR3Client {
    const nuxt = useNuxtApp();

    // The client is provided by the or3client.ts plugin
    const client = nuxt.$or3client as OR3Client | undefined;

    if (!client) {
        throw new Error(
            '[useOR3Client] OR3Client not available. ' +
                'Ensure the or3client plugin is loaded before accessing.'
        );
    }

    return client;
}
