import { reactive } from 'vue';
import { useHooks } from '../../core/hooks/useHooks';

// In-memory map: paneId -> pending prompt id (applied on first thread creation)
const pendingByPane: Record<string, string | null> = reactive({});

/**
 * Flag to ensure hook handler is registered only once globally.
 */
let hookHandlerRegistered = false;

/**
 * `setupPanePromptCleanup`
 *
 * Purpose:
 * Ensures pending prompts are cleared when panes close.
 *
 * Behavior:
 * Registers a single hook handler that clears pending prompts on pane close.
 *
 * Constraints:
 * - Client-only; no-op on the server
 * - Intended to be called once during app setup
 *
 * Non-Goals:
 * - Does not create or apply prompts
 *
 * @example
 * ```ts
 * // In a client-only plugin
 * setupPanePromptCleanup();
 * ```
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

/**
 * `setPanePendingPrompt`
 *
 * Purpose:
 * Associates a pending prompt id with a pane.
 *
 * Behavior:
 * Stores the prompt id in a reactive in-memory map.
 *
 * Constraints:
 * - Data is not persisted across reloads
 *
 * Non-Goals:
 * - Does not validate prompt ids
 *
 * @example
 * ```ts
 * setPanePendingPrompt(paneId, 'prompt-123');
 * ```
 */
export function setPanePendingPrompt(paneId: string, promptId: string | null) {
    pendingByPane[paneId] = promptId;
}

/**
 * `getPanePendingPrompt`
 *
 * Purpose:
 * Reads the pending prompt id for a pane.
 *
 * Behavior:
 * Returns the stored id, `null` if cleared, or `undefined` if never set.
 *
 * Constraints:
 * - Data is in-memory only
 *
 * Non-Goals:
 * - Does not resolve or load prompt content
 *
 * @example
 * ```ts
 * const promptId = getPanePendingPrompt(paneId);
 * ```
 */
export function getPanePendingPrompt(
    paneId: string
): string | null | undefined {
    return pendingByPane[paneId];
}

/**
 * `clearPanePendingPrompt`
 *
 * Purpose:
 * Removes any pending prompt id for a pane.
 *
 * Behavior:
 * Deletes the entry from the in-memory map.
 *
 * Constraints:
 * - No-op if the pane has no entry
 *
 * Non-Goals:
 * - Does not notify listeners beyond reactive updates
 *
 * @example
 * ```ts
 * clearPanePendingPrompt(paneId);
 * ```
 */
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
