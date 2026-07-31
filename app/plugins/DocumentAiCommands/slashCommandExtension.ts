import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion from '@tiptap/suggestion';
import type { SuggestionOptions } from '@tiptap/suggestion';
import type { DocumentAiScope } from '~/composables/editor/useDocumentAiActions';
import type { DocumentAiAction } from '~/composables/editor/useDocumentAiActions';

export interface DocumentAiPromptAction {
    id: string;
    label: string;
    prompt: string;
    defaultScope?: DocumentAiScope;
    source: 'saved' | 'plugin';
}

export function searchDocumentAiPromptActions(
    query: string,
    savedActions: readonly DocumentAiAction[],
    pluginActions: readonly DocumentAiAction[],
) {
    const normalized = query.trim().toLocaleLowerCase();
    const matches = (action: DocumentAiAction) =>
        !normalized
        || action.label.toLocaleLowerCase().includes(normalized)
        || action.prompt.toLocaleLowerCase().includes(normalized);
    return [
        ...savedActions.filter(matches).map((action) => ({ ...action, source: 'saved' as const })),
        ...pluginActions.filter(matches).map((action) => ({ ...action, source: 'plugin' as const })),
    ];
}

export const DocumentAiSlashCommandPluginKey = new PluginKey(
    'documentAiSlashCommandSuggestion',
);

export interface DocumentAiSlashCommandOptions {
    suggestion: Omit<SuggestionOptions<DocumentAiPromptAction>, 'editor'>;
}

export const DocumentAiSlashCommand =
    Extension.create<DocumentAiSlashCommandOptions>({
        name: 'documentAiSlashCommand',

        addOptions() {
            return {
                suggestion: {
                    char: '/',
                    pluginKey: DocumentAiSlashCommandPluginKey,
                } as Omit<
                    SuggestionOptions<DocumentAiPromptAction>,
                    'editor'
                >,
            };
        },

        addProseMirrorPlugins() {
            return [
                Suggestion({
                    editor: this.editor,
                    ...this.options.suggestion,
                }),
            ];
        },
    });
