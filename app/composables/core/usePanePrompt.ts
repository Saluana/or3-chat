import { reactive } from 'vue';
import { useHooks } from '../../core/hooks/useHooks';

// In-memory map: paneId -> pending prompt id (applied on first thread creation)
const pendingByPane: Record<string, string | null> = reactive({});

/**
 * Flag to ensure hook handler is registered only once globally.
 */
let hookHandlerRegistered = false;

/**
 * Setup automatic cleanup of pending prompts when panes close.
 * This should be called once globally, preferably in app setup or plugin initialization.
 * 
 * @internal
 */
export function setupPanePromptCleanup() {
    if (hookHandlerRegistered) return;
    if (typeof window === 'undefined') return; // SSR safety

    try {
        const hooks = useHooks();
        
        hooks.addAction(
            'ui.pane.close:action:after',
            ({ pane }) => {
                if (pane.id) {
                    clearPanePendingPrompt(pane.id);
                }
            },
            10
        );
        
        hookHandlerRegistered = true;
    } catch (error) {
        if (import.meta.dev) {
            console.warn('[usePanePrompt] Failed to setup cleanup hook:', error);
        }
    }
}

// Auto-setup on client
if (import.meta.client) {
    setupPanePromptCleanup();
}

export function setPanePendingPrompt(paneId: string, promptId: string | null) {
    pendingByPane[paneId] = promptId;
}

export function getPanePendingPrompt(
    paneId: string
): string | null | undefined {
    return pendingByPane[paneId];
}

export function clearPanePendingPrompt(paneId: string) {
    delete pendingByPane[paneId];
}

// Debug helper
if (import.meta.dev) {
    const g = globalThis as typeof globalThis & {
        __or3PanePendingPrompts?: Record<string, string | null>;
    };
    g.__or3PanePendingPrompts = pendingByPane;
}

// HMR cleanup
if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        hookHandlerRegistered = false;
    });
}
