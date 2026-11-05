import { ref, readonly } from 'vue';
import { getPrompt } from '~/db/prompts';
import { getDb, getWorkspaceGeneration, subscribeActiveWorkspaceDb } from '~/db/client';
import { useHooks } from '#imports';
import type { TipTapDocument } from '~/types/database';

export interface ActivePromptState {
    activePromptId: string | null;
    activePromptContent: TipTapDocument | null;
}

// Shared by prompt selection and chat preparation within the active workspace.
const activePromptId = ref<string | null>(null);
const activePromptContent = ref<TipTapDocument | null>(null);
let selectionRevision = 0;
let stopWorkspace: (() => void) | undefined;

function clearActivePrompt(): void {
    selectionRevision++;
    activePromptId.value = null;
    activePromptContent.value = null;
}

if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        stopWorkspace?.();
        clearActivePrompt();
    });
}

/** Ephemeral, workspace-owned prompt selection. Only the latest selection may publish. */
export function useActivePrompt() {
    const hooks = useHooks();
    if (typeof window !== 'undefined' && !stopWorkspace) {
        stopWorkspace = subscribeActiveWorkspaceDb(clearActivePrompt);
    }

    async function setActivePrompt(id: string | null): Promise<void> {
        if (!id) {
            clearActivePrompt();
            return;
        }
        const revision = ++selectionRevision;
        const db = getDb();
        const generation = getWorkspaceGeneration();
        const prompt = await getPrompt(id);
        if (revision !== selectionRevision || db !== getDb() || generation !== getWorkspaceGeneration()) return;
        activePromptId.value = prompt?.id ?? null;
        activePromptContent.value = prompt?.content ?? null;
        if (prompt) await hooks.doAction('chat.systemPrompt.select:action:after', {
            id: prompt.id,
            content: prompt.content,
        });
    }

    return {
        activePromptId: readonly(activePromptId),
        activePromptContent: readonly(activePromptContent),
        setActivePrompt,
        clearActivePrompt,
        getActivePromptContent: (): TipTapDocument | null => activePromptContent.value,
    };
}
