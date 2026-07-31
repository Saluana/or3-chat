/**
 * @module app/utils/multiPaneApi
 *
 * Purpose:
 * Stores and retrieves the global multi-pane API instance.
 *
 * Constraints:
 * - This is a global singleton stored on `globalThis`.
 */

import type { UseMultiPaneApi } from '~/composables/core/useMultiPane';

type GlobalMultiPane = typeof globalThis & {
    __or3MultiPaneApi?: UseMultiPaneApi;
};

/**
 * `getGlobalMultiPaneApi`
 *
 * Purpose:
 * Returns the global multi-pane API instance if available.
 */
export function getGlobalMultiPaneApi(): UseMultiPaneApi | undefined {
    return (globalThis as GlobalMultiPane).__or3MultiPaneApi;
}

/**
 * `setGlobalMultiPaneApi`
 *
 * Purpose:
 * Sets the global multi-pane API instance.
 */
export function setGlobalMultiPaneApi(api: UseMultiPaneApi | undefined): void {
    (globalThis as GlobalMultiPane).__or3MultiPaneApi = api;
}
