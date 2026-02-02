/**
 * @module composables/chat/useChatInputBridge
 *
 * **Purpose**
 * Provides a lightweight bridge for programmatic message injection into existing ChatInputDropper
 * instances. Allows pane plugin API to set input text and invoke native send flow without
 * re-hydrating thread history or duplicating user messages. Reuses exact UI pipeline.
 *
 * **Responsibilities**
 * - Maintain registry of chat input instances keyed by paneId
 * - Allow registration/unregistration of input APIs
 * - Provide `programmaticSend()` to inject text and trigger send
 * - Check for pane existence via `hasPane()`
 *
 * **Non-responsibilities**
 * - Does NOT manage thread history or message persistence (see useAi.ts)
 * - Does NOT send messages directly (delegates to native ChatInputDropper send handler)
 * - Does NOT handle editor content beyond text (attachments managed by ChatInputDropper)
 * - Does NOT validate pane permissions or thread access
 *
 * **Registry Pattern (Singleton)**
 * - Module-scoped ref (`registry`) ensures all callers share state
 * - Registry is NOT persisted (ephemeral session state)
 * - Each pane registers its input API on mount (ChatContainer)
 * - Unregister on pane close or HMR cleanup
 *
 * **Lifecycle & Cleanup**
 * - `registerPaneInput(paneId, api)` called by ChatContainer (client only)
 * - `unregisterPaneInput(paneId)` called on pane close or HMR dispose
 * - **HMR safety**: Re-registering same paneId replaces existing entry (no duplicates)
 * - **Memory leak risk**: Stale entries accumulate if unregister is not called
 * - **Cleanup expectation**: Callers MUST call `unregisterPaneInput` on unmount
 *
 * **Usage Pattern**
 * ```ts
 * // In ChatContainer.vue (register on mount)
 * onMounted(() => registerPaneInput(paneId, inputApi));
 * onBeforeUnmount(() => unregisterPaneInput(paneId));
 *
 * // In pane plugin (programmatic send)
 * if (programmaticSend(paneId, 'Hello!')) {
 *   console.log('Message sent');
 * }
 * ```
 *
 * **Error Handling**
 * - `programmaticSend()` catches exceptions from input API and returns false
 * - Dev-mode logs send failures (console.debug)
 * - Returns false if pane not found or send fails
 * - Does NOT throw (safe for plugin code)
 */

/**
 * Lightweight bridge allowing programmatic message injection to existing ChatInputDropper instances
 * without re-hydrating thread history or duplicating user messages. Each ChatContainer will register
 * its input + send handler keyed by paneId. The pane plugin API can then set the input text and invoke
 * the native onSend path (which already drives useChat/sendMessage and streaming) for a given pane.
 *
 * This avoids: (1) re-loading thread history, (2) re-sending duplicate user message content, and
 * (3) bypassing internal hook ordering. It reuses the exact UI pipeline.
 *
 * Contract:
 * registerPaneInput(paneId, api)   -> called by ChatContainer (client only)
 * unregisterPaneInput(paneId)      -> cleanup (HMR / pane close)
 * programmaticSend(paneId, text)   -> sets editor text + triggers native send
 * hasPane(paneId)                  -> helper
 *
 * The ChatInputDropper exposes a minimal imperative API (setText, send). We attach it via ref binding.
 */

import { ref } from 'vue';

interface ChatInputImperativeApi {
    setText(t: string): void;
    triggerSend(): void; // send current text/attachments
}

interface RegisteredPaneInput {
    paneId: string;
    api: ChatInputImperativeApi;
}

const registry = ref<RegisteredPaneInput[]>([]);

/**
 * Internal helper to find registered pane by ID.
 *
 * @param paneId - Pane identifier
 * @returns Registered pane input or null
 */
function find(paneId: string) {
    return registry.value.find((r) => r.paneId === paneId) || null;
}

/**
 * Registers a chat input API for a pane.
 *
 * **Behavior**
 * - Adds pane to registry or replaces existing entry (HMR-safe)
 * - Should be called by ChatContainer on mount
 * - **Must be paired with `unregisterPaneInput` on unmount**
 *
 * @param paneId - Unique pane identifier
 * @param api - Imperative API (setText, triggerSend)
 */
export function registerPaneInput(paneId: string, api: ChatInputImperativeApi) {
    const existing = find(paneId);
    if (existing) existing.api = api; // HMR / re-mount
    else registry.value.push({ paneId, api });
}

/**
 * Unregisters a chat input API for a pane.
 *
 * **Behavior**
 * - Removes pane from registry
 * - Should be called on pane close or HMR cleanup
 * - **Required to prevent memory leaks**
 *
 * @param paneId - Unique pane identifier
 */
export function unregisterPaneInput(paneId: string) {
    registry.value = registry.value.filter((r) => r.paneId !== paneId);
}

/**
 * Programmatically sends a message to a pane.
 *
 * **Behavior**
 * - Sets input text via `api.setText(text)`
 * - Triggers native send flow via `api.triggerSend()`
 * - Returns true on success, false if pane not found or send fails
 *
 * **Error Handling**
 * - Catches exceptions from input API
 * - Logs failures in dev mode (console.debug)
 * - Does NOT throw
 *
 * @param paneId - Unique pane identifier
 * @param text - Message text to send
 * @returns true if send succeeded, false otherwise
 */
export function programmaticSend(paneId: string, text: string): boolean {
    const r = find(paneId);
    if (!r) return false;
    try {
        r.api.setText(text);
        r.api.triggerSend();
        return true;
    } catch (e) {
        if (import.meta.dev)
            console.debug('[useChatInputBridge] send failed', e);
        return false;
    }
}

/**
 * Checks if a pane is registered.
 *
 * @param paneId - Unique pane identifier
 * @returns true if pane is registered, false otherwise
 */
export function hasPane(paneId: string) {
    return !!find(paneId);
}
