/**
 * Chat Input Bridge Adapter
 *
 * Wraps the chat input bridge service for programmatic message sending.
 */

import {
    registerPaneInput,
    unregisterPaneInput,
    programmaticSend,
    hasPane,
} from '~/composables/chat/useChatInputBridge';
import type { ChatInputBridgeAdapter } from '../client';

/**
 * Creates the chat input bridge adapter.
 */
export function createChatInputBridgeAdapter(): ChatInputBridgeAdapter {
    return {
        register: registerPaneInput,
        unregister: unregisterPaneInput,
        send: programmaticSend,
        hasPane,
    };
}
