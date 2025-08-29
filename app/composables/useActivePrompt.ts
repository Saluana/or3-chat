import { ref, readonly } from 'vue';
import { getPrompt } from '~/db/prompts';
import { useHooks } from './useHooks';

export interface ActivePromptState {
    activePromptId: string | null;
    activePromptContent: any | null;
}

// NOTE: Must be module-singleton so different composables/components share state.
// Previously each invocation created new refs, so selection in modal was not
// visible to chat sending logic. We lift refs to module scope.
const _activePromptId = ref<string | null>(null);
const _activePromptContent = ref<any | null>(null);

export function useActivePrompt() {
    const hooks = useHooks();

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

    function clearActivePrompt(): void {
        setActivePrompt(null);
    }

    function getActivePromptContent(): any | null {
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
