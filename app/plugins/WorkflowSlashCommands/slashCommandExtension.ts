/**
 * Workflow Slash Commands - TipTap Extension
 *
 * Creates a TipTap extension that triggers workflow suggestions on `/`.
 * When a workflow is selected, it inserts a styled workflow node.
 *
 * Constraints:
 * - Only triggers when `/` is typed at the very start of input
 * - Does not trigger if a workflow node already exists in the editor
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
 * Check if the editor already contains a workflow node.
 * Exported for use by the suggestion configuration.
 */
export function hasWorkflowNode(editor: any): boolean {
    let found = false;
    try {
        editor.state.doc.descendants((node: any) => {
            if (node.type.name === 'workflow') {
                found = true;
                return false; // Stop traversal
            }
            return true;
        });
    } catch {
        // Silently handle traversal errors
    }
    return found;
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
 *
 * The actual constraints (only at start, no duplicates) are enforced in
 * the suggestion configuration created by createSlashCommandSuggestion().
 */
export const SlashCommand = Extension.create<SlashCommandOptions>({
    name: 'slashCommand',

    addOptions() {
        return {
            suggestion: {
                char: '/',
                pluginKey: SlashCommandPluginKey,
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
