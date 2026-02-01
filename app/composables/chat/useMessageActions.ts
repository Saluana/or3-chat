/**
 * @module composables/chat/useMessageActions
 *
 * **Purpose**
 * Provides an extensible registry for chat message action buttons. Allows plugins and
 * core features to register custom actions (edit, copy, retry, etc.) that appear on
 * user or assistant messages. Uses a global registry pattern to ensure all components
 * see the same action set.
 *
 * **Responsibilities**
 * - Maintain a global registry of message actions
 * - Filter actions by message role (user/assistant/both)
 * - Support registration and unregistration of actions
 * - Provide reactive computed list of actions for UI consumption
 * - Support ordering via `order` property
 *
 * **Non-responsibilities**
 * - Does NOT render action buttons (see ChatMessage.vue)
 * - Does NOT implement action handlers (caller provides handler function)
 * - Does NOT persist action registry (ephemeral session state)
 * - Does NOT validate action uniqueness beyond ID (caller must not duplicate IDs)
 *
 * **Registry Pattern**
 * - Uses global symbol-keyed registry (`__or3MessageActionsRegistry`)
 * - Registry is shared across all components and plugin contexts
 * - Actions are deduplicated by `id` (re-registering same ID replaces existing)
 * - Unregistration removes action by ID
 * - Registry is NOT cleared on HMR (requires manual unregister or page reload)
 *
 * **Action Ordering**
 * - Built-in actions (in ChatMessage.vue) have implicit order 0-100
 * - Plugin actions default to order 200 (appear after built-ins)
 * - Lower order values appear earlier in the UI
 * - Actions with same order are sorted by registration order
 *
 * **Extensibility**
 * - Plugins register actions via `registerMessageAction(action)`
 * - Actions can be role-specific (`showOn: 'user' | 'assistant'`) or universal (`'both'`)
 * - Handler receives context: `{ message, threadId }`
 * - Handler can be async (caller manages loading state)
 *
 * **Lifecycle**
 * - Actions are registered during plugin initialization (e.g., in Nuxt plugins)
 * - Actions persist across component mount/unmount (session lifetime)
 * - Unregister actions in plugin cleanup if needed (rare)
 */

import { computed } from 'vue';
import type { UiChatMessage } from '~/utils/chat/uiMessages';
import { createRegistry } from '../_registry';

/** Definition for an extendable chat message action button. */
export interface ChatMessageAction {
    /** Unique id (stable across reloads). */
    id: string;
    /** Icon name (passed to UButton icon prop). */
    icon: string;
    /** Tooltip text. */
    tooltip: string;
    /** Where to show the action. */
    showOn: 'user' | 'assistant' | 'both';
    /** Optional ordering (lower = earlier). Defaults to 200 (after built-ins). */
    order?: number;
    /** Handler invoked on click. */
    handler: (ctx: {
        message: UiChatMessage;
        threadId?: string;
    }) => void | Promise<void>;
}

const registry = createRegistry<ChatMessageAction>(
    '__or3MessageActionsRegistry'
);

/**
 * Registers (or replaces) a message action in the global registry.
 *
 * **Behavior**
 * - Adds action to global registry keyed by `action.id`
 * - If ID already exists, replaces existing action
 * - Action becomes immediately available to all components
 *
 * **Usage**
 * ```ts
 * registerMessageAction({
 *   id: 'my-custom-action',
 *   icon: 'i-carbon-copy',
 *   tooltip: 'My Action',
 *   showOn: 'both',
 *   order: 250,
 *   handler: async ({ message, threadId }) => { ... }
 * });
 * ```
 *
 * @param action - Action definition
 */
export function registerMessageAction(action: ChatMessageAction) {
    registry.register(action);
}

/**
 * Unregisters an action by ID from the global registry.
 *
 * **Behavior**
 * - Removes action with matching ID
 * - No-op if ID not found
 * - Action is immediately unavailable to all components
 *
 * @param id - Action ID to remove
 */
export function unregisterMessageAction(id: string) {
    registry.unregister(id);
}

/**
 * Composable that returns actions applicable to a specific message.
 *
 * **Behavior**
 * - Returns reactive computed list of actions
 * - Filters by message role (user/assistant/both)
 * - Actions are ordered by `order` property (lower first)
 *
 * **Usage**
 * ```ts
 * const actions = useMessageActions({ role: 'assistant' });
 * // renders: actions filtered for assistant messages
 * ```
 *
 * @param message - Message with `role` property
 * @returns Computed ref of applicable actions
 */
export function useMessageActions(message: { role: 'user' | 'assistant' }) {
    const allActions = registry.useItems();
    return computed(() =>
        allActions.value.filter(
            (a) => a.showOn === 'both' || a.showOn === message.role
        )
    );
}

/**
 * Lists all registered action IDs (for debugging/inspection).
 *
 * **Behavior**
 * - Returns array of action IDs currently in registry
 * - Useful for plugin authors to check for ID conflicts
 *
 * @returns Array of action IDs
 */
export function listRegisteredMessageActionIds(): string[] {
    return registry.listIds();
}

// Note: Core (built-in) actions remain hard-coded in ChatMessage.vue so they always appear;
// external plugins should use order >= 200 to appear after them unless intentionally overriding.
