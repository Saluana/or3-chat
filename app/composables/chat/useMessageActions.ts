import { computed, reactive } from 'vue';
import type { UiChatMessage } from '~/utils/chat/uiMessages';

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

interface MessageActionsRegistryGlobal {
    __or3MessageActionsRegistry?: Map<string, ChatMessageAction>;
}

// Global singleton registry (survives HMR) stored on globalThis to avoid duplication.
const registryHost = globalThis as MessageActionsRegistryGlobal;
const registry: Map<string, ChatMessageAction> =
    registryHost.__or3MessageActionsRegistry ||
    (registryHost.__or3MessageActionsRegistry = new Map());

// Reactive wrapper list we maintain for computed filtering (Map itself not reactive).
const reactiveList = reactive<{ items: ChatMessageAction[] }>({ items: [] });

function syncReactiveList() {
    reactiveList.items = Array.from(registry.values());
}

/** Register (or replace) a message action. */
export function registerMessageAction(action: ChatMessageAction) {
    registry.set(action.id, action);
    syncReactiveList();
}

/** Unregister an action by id (optional utility). */
export function unregisterMessageAction(id: string) {
    if (registry.delete(id)) syncReactiveList();
}

/** Accessor for actions applicable to a specific message. */
export function useMessageActions(message: { role: 'user' | 'assistant' }) {
    return computed(() =>
        reactiveList.items
            .filter((a) => a.showOn === 'both' || a.showOn === message.role)
            .sort((a, b) => (a.order ?? 200) - (b.order ?? 200))
    );
}

/** Convenience for plugin authors to check existing action ids. */
export function listRegisteredMessageActionIds(): string[] {
    return Array.from(registry.keys());
}

// Note: Core (built-in) actions remain hard-coded in ChatMessage.vue so they always appear;
// external plugins should use order >= 200 to appear after them unless intentionally overriding.
