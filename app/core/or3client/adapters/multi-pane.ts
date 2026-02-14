/**
 * Multi-Pane Manager Adapter
 *
 * Wraps the multi-pane service for workspace pane management.
 * This is a stateful service with Dexie integration.
 */

import { useMultiPane, type UseMultiPaneApi } from '~/composables/core/useMultiPane';
import { clientOnlyServiceAdapter } from '../utils';
import type { ServiceAdapter } from '../utils';

/**
 * Creates the multi-pane manager adapter.
 */
function createMultiPaneAdapterImpl(): ServiceAdapter<UseMultiPaneApi> {
    return {
        use: useMultiPane,
    };
}

// SSR fallback - minimal no-op API
function createMultiPaneFallback(): UseMultiPaneApi {
    return {
        panes: { value: [] } as any,
        activePaneIndex: { value: 0 } as any,
        canAddPane: { value: false } as any,
        newWindowTooltip: { value: '' } as any,
        addPane: () => {},
        closePane: async () => {},
        setActive: () => {},
        setPaneThread: async () => {},
        loadMessagesFor: async () => [],
        ensureAtLeastOne: () => {},
        newPaneForApp: async () => {},
        setPaneApp: async () => {},
        updatePane: () => {},
        focusPrev: () => {},
        focusNext: () => {},
        getPaneWidth: () => '100%',
        handleResize: () => {},
        persistPaneWidths: () => {},
        recalculateWidthsForContainer: () => {},
        paneWidths: { value: [] } as any,
    };
}

/**
 * SSR-safe multi-pane adapter factory.
 */
export function createMultiPaneAdapter(): ServiceAdapter<UseMultiPaneApi> {
    return clientOnlyServiceAdapter(createMultiPaneAdapterImpl, createMultiPaneFallback);
}

