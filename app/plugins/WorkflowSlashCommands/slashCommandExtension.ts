/**
 * Workflow Slash Commands - TipTap Extension
 *
 * Creates a TipTap extension that triggers workflow suggestions on `/`.
 * When a workflow is selected, it inserts a styled workflow node.
 */

import { Extension, Node, mergeAttributes } from '@tiptap/core';
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
 * WorkflowNode - An inline node representing a selected workflow.
 * Renders as a styled chip with the workflow name.
 */
export const WorkflowNode = Node.create({
    name: 'workflow',
    group: 'inline',
    inline: true,
    atom: true, // Treated as a single unit (can't cursor into it)

    addAttributes() {
        return {
            id: { default: null },
            label: { default: null },
        };
    },

    parseHTML() {
        return [{ tag: 'span[data-workflow]' }];
    },

    renderHTML({ node, HTMLAttributes }) {
        return [
            'span',
            mergeAttributes(HTMLAttributes, {
                'data-workflow': '',
                'data-workflow-id': node.attrs.id,
                class: 'workflow-tag',
            }),
            `/${node.attrs.label}`,
        ];
    },

    // Plain text serialization for sending to AI
    renderText({ node }) {
        return `/${node.attrs.label}`;
    },
});

/**
 * Create the Slash Command extension.
 *
 * This extension uses TipTap's Suggestion utility to show a popover
 * when the user types `/`. On selection, it inserts a styled workflow node.
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
                    // Delete the `/query` text and insert workflow node + space
                    const item = props as WorkflowItem;
                    editor
                        .chain()
                        .focus()
                        .deleteRange(range)
                        .insertContent([
                            {
                                type: 'workflow',
                                attrs: {
                                    id: item.id,
                                    label: item.label,
                                },
                            },
                            { type: 'text', text: ' ' },
                        ])
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
