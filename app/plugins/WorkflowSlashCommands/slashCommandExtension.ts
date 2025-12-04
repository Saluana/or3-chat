/**
 * Workflow Slash Commands - TipTap Extension
 *
 * Creates a TipTap extension that triggers workflow suggestions on `/`.
 * When a workflow is selected, it inserts `/WorkflowName ` as plain text.
 */

import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion from '@tiptap/suggestion';
import type { SuggestionOptions } from '@tiptap/suggestion';
import type { WorkflowItem } from './useWorkflowSlashCommands';

// Unique plugin key for slash command suggestions
export const SlashCommandPluginKey = new PluginKey('slashCommandSuggestion');

export interface SlashCommandOptions {
    suggestion: Omit<SuggestionOptions<WorkflowItem>, 'editor'>;
}

/**
 * Create the Slash Command extension.
 *
 * This extension uses TipTap's Suggestion utility to show a popover
 * when the user types `/`. On selection, it replaces the typed `/query`
 * with `/WorkflowName ` (with trailing space for the prompt).
 */
export const SlashCommand = Extension.create<SlashCommandOptions>({
    name: 'slashCommand',

    addOptions() {
        return {
            suggestion: {
                char: '/',
                allowedPrefixes: [null, ' ', '\n'],
                pluginKey: SlashCommandPluginKey,
                command: ({ editor, range, props }) => {
                    // Delete the `/query` text and insert `/WorkflowName `
                    const item = props as WorkflowItem;
                    editor
                        .chain()
                        .focus()
                        .deleteRange(range)
                        .insertContent(`/${item.label} `)
                        .run();
                },
            } as Omit<SuggestionOptions<WorkflowItem>, 'editor'>,
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
