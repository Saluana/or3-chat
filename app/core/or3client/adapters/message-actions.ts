/**
 * Message Actions Adapter
 *
 * Wraps the message actions registry for chat message context menus.
 */

import { computed } from 'vue';
import {
    registerMessageAction,
    unregisterMessageAction,
    listRegisteredMessageActionIds,
    useMessageActions,
    type ChatMessageAction,
} from '~/composables/chat/useMessageActions';
import { createRegistry } from '~/composables/_registry';
import type { RegistryAdapter } from '../utils';

// Get the underlying registry (same key as in useMessageActions.ts)
const registry = createRegistry<ChatMessageAction>('__or3MessageActionsRegistry');

/**
 * Creates the message actions adapter.
 * This is a simple createRegistry-based adapter.
 */
export function createMessageActionsAdapter(): RegistryAdapter<ChatMessageAction> {
    return {
        register: registerMessageAction,
        unregister: unregisterMessageAction,
        get: (id) => registry.snapshot().find((a) => a.id === id),
        list: () => registry.snapshot(),
        useItems: () => registry.useItems(),
        listIds: listRegisteredMessageActionIds,
    };
}
