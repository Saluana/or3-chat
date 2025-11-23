import type { UseMultiPaneApi } from '~/composables/core/useMultiPane';

type GlobalMultiPane = typeof globalThis & {
    __or3MultiPaneApi?: UseMultiPaneApi;
};

export function getGlobalMultiPaneApi(): UseMultiPaneApi | undefined {
    return (globalThis as GlobalMultiPane).__or3MultiPaneApi;
}

export function setGlobalMultiPaneApi(
    api: UseMultiPaneApi | undefined
): void {
    (globalThis as GlobalMultiPane).__or3MultiPaneApi = api;
}
