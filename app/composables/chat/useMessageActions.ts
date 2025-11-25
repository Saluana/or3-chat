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

/** Register (or replace) a message action. */
export function registerMessageAction(action: ChatMessageAction) {
    registry.register(action);
}

/** Unregister an action by id (optional utility). */
export function unregisterMessageAction(id: string) {
    registry.unregister(id);
}

/** Accessor for actions applicable to a specific message. */
export function useMessageActions(message: { role: 'user' | 'assistant' }) {
    const allActions = registry.useItems();
    return computed(() =>
        allActions.value.filter(
            (a) => a.showOn === 'both' || a.showOn === message.role
        )
    );
}

/** Convenience for plugin authors to check existing action ids. */
export function listRegisteredMessageActionIds(): string[] {
    return registry.listIds();
}

// Note: Core (built-in) actions remain hard-coded in ChatMessage.vue so they always appear;
// external plugins should use order >= 200 to appear after them unless intentionally overriding.
