/**
 * @module composables/chat/useActivePrompt
 *
 * **Purpose**
 * Manages the currently active system prompt for chat interactions. Provides a singleton
 * state that is shared across all components and composables to ensure consistent prompt
 * selection and application during message sending.
 *
 * **Responsibilities**
 * - Track the currently selected prompt ID and its content (TipTap document)
 * - Load prompt content from DB when a prompt ID is selected
 * - Emit hooks when prompts are selected/cleared
 * - Provide readonly reactive state for UI consumption
 * - Clear active prompt when user deselects or prompt is deleted
 *
 * **Non-responsibilities**
 * - Does NOT persist selection (ephemeral session state only)
 * - Does NOT manage the prompts database table (see db/prompts)
 * - Does NOT apply prompts to messages (see useAi.ts for message construction)
 * - Does NOT provide UI for prompt selection (see PromptSelector.vue)
 *
 * **Singleton State Pattern**
 * - Module-scoped refs (`_activePromptId`, `_activePromptContent`) ensure all callers share state
 * - Previous implementation created new refs per invocation, causing selection in modal
 *   to be invisible to chat sending logic
 * - Readonly exports prevent external mutation while allowing reactive subscriptions
 * - State persists across component mount/unmount (session lifetime)
 *
 * **Lifecycle**
 * - State is initialized to `null` (no prompt selected)
 * - `setActivePrompt(id)` loads prompt from DB and updates state
 * - `clearActivePrompt()` resets state to `null`
 * - State is NOT cleared on HMR (requires manual clear or page reload)
 *
 * **Hook Emission**
 * - Fires `chat.systemPrompt.select:action:after` when a prompt is selected
 * - Does NOT fire hook on clear (hook receives null payload if needed)
 *
 * **Error Handling**
 * - If prompt ID is not found in DB, state is set to `null` (graceful degradation)
 * - No errors thrown; safe for UI autocomplete flows
 */

import { ref, readonly } from 'vue';
import { getPrompt } from '~/db/prompts';
import { useHooks } from '#imports';
import type { TipTapDocument } from '~/types/database';

export interface ActivePromptState {
    activePromptId: string | null;
    activePromptContent: TipTapDocument | null;
}

// NOTE: Must be module-singleton so different composables/components share state.
// Previously each invocation created new refs, so selection in modal was not
// visible to chat sending logic. We lift refs to module scope.
const _activePromptId = ref<string | null>(null);
const _activePromptContent = ref<TipTapDocument | null>(null);

/**
 * Composable for managing active system prompt selection.
 *
 * **Behavior**
 * - Returns readonly reactive state for `activePromptId` and `activePromptContent`
 * - Provides functions to set/clear the active prompt
 * - Shares singleton state across all callers
 *
 * @returns Object with reactive state and control functions
 * @returns {Readonly<Ref<string | null>>} activePromptId - Currently selected prompt ID
 * @returns {Readonly<Ref<TipTapDocument | null>>} activePromptContent - Prompt content (TipTap JSON)
 * @returns {(id: string | null) => Promise<void>} setActivePrompt - Select a prompt by ID
 * @returns {() => void} clearActivePrompt - Clear the active prompt
 * @returns {() => TipTapDocument | null} getActivePromptContent - Get current prompt content
 */
export function useActivePrompt() {
    const hooks = useHooks();

    /**
     * Sets the active system prompt by ID.
     *
     * **Behavior**
     * - Loads prompt content from DB via `getPrompt(id)`
     * - Updates module-scoped state (shared across all callers)
     * - Emits `chat.systemPrompt.select:action:after` hook on success
     * - Sets state to `null` if prompt not found
     *
     * **Error Handling**
     * - If prompt not found, state is cleared (no error thrown)
     * - Hook is only fired on successful selection
     *
     * @param id - Prompt ID to activate, or `null` to clear
     */
    async function setActivePrompt(id: string | null): Promise<void> {
        if (!id) {
            _activePromptId.value = null;
            _activePromptContent.value = null;
            return;
        }

        const prompt = await getPrompt(id);
        if (prompt) {
            _activePromptId.value = prompt.id;
            _activePromptContent.value = prompt.content;
            await hooks.doAction('chat.systemPrompt.select:action:after', {
                id: prompt.id,
                content: prompt.content,
            });
        } else {
            _activePromptId.value = null;
            _activePromptContent.value = null;
        }
    }

    /**
     * Clears the active system prompt.
     *
     * **Behavior**
     * - Equivalent to `setActivePrompt(null)`
     * - Resets module-scoped state
     */
    function clearActivePrompt(): void {
        void setActivePrompt(null);
    }

    /**
     * Gets the current active prompt content.
     *
     * @returns Current prompt content (TipTap JSON) or null
     */
    function getActivePromptContent(): TipTapDocument | null {
        return _activePromptContent.value;
    }

    return {
        activePromptId: readonly(_activePromptId),
        activePromptContent: readonly(_activePromptContent),
        setActivePrompt,
        clearActivePrompt,
        getActivePromptContent,
    };
}
