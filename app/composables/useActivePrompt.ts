import { ref, readonly } from 'vue';
import { getPrompt } from '~/db/prompts';
import { useHooks } from './useHooks';

export interface ActivePromptState {
    activePromptId: string | null;
    activePromptContent: any | null;
}

export function useActivePrompt() {
    const activePromptId = ref<string | null>(null);
    const activePromptContent = ref<any | null>(null);
    const hooks = useHooks();

    async function setActivePrompt(id: string | null): Promise<void> {
        if (!id) {
            activePromptId.value = null;
            activePromptContent.value = null;
            return;
        }

        const prompt = await getPrompt(id);
        if (prompt) {
            activePromptId.value = prompt.id;
            activePromptContent.value = prompt.content;

            await hooks.doAction('chat.systemPrompt.select:action:after', {
                id: prompt.id,
                content: prompt.content,
            });
        } else {
            // Prompt was deleted or not found, clear state
            activePromptId.value = null;
            activePromptContent.value = null;
        }
    }

    function clearActivePrompt(): void {
        setActivePrompt(null);
    }

    function getActivePromptContent(): any | null {
        return activePromptContent.value;
    }

    return {
        activePromptId: readonly(activePromptId),
        activePromptContent: readonly(activePromptContent),
        setActivePrompt,
        clearActivePrompt,
        getActivePromptContent,
    };
}
