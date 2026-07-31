/**
 * Workflow Slash Commands - TipTap Suggestion Configuration
 *
 * Creates a TipTap suggestion configuration for `/` workflow triggers.
 * This is used by the SlashCommand extension to render the popover UI.
 *
 * Constraints:
 * - Only triggers when `/` is at position 1 (start of document)
 * - Does not trigger if a workflow node already exists in the editor
 */

import type { SuggestionOptions, SuggestionProps } from '@tiptap/suggestion';
import type { WorkflowItem } from './useWorkflowSlashCommands';
import WorkflowPopover from './WorkflowPopover.vue';
import {
    createSuggestionItemsLoader,
    createSuggestionRenderLifecycle,
} from '../shared/suggestion-popover';
import {
    SlashCommandPluginKey,
    hasWorkflowNode,
} from './slashCommandExtension';

/**
 * Create a TipTap suggestion configuration for workflow slash commands.
 *
 * @param searchFn - Function to search workflows by query
 * @param debounceMs - Debounce delay for search (default: 100ms)
 * @returns Partial suggestion configuration (to be merged with extension options)
 */
export function createSlashCommandSuggestion(
    searchFn: (query: string) => Promise<WorkflowItem[]>,
    debounceMs = 100
): Partial<SuggestionOptions<WorkflowItem>> {
    return {
        // Trigger character
        char: '/',

        // Only trigger at start of input (null = start of document)
        allowedPrefixes: [null] as unknown as string[],

        // Use consistent plugin key
        pluginKey: SlashCommandPluginKey,

        // Custom allow function to enforce constraints:
        // - Only trigger if `/` is at position 1 (very start of input)
        // - Don't trigger if there's already a workflow node (no duplicates)
        allow: ({ editor, range }) => {
            // Position 1 means: doc(0) > paragraph(1) > text starts at 1
            if (range.from !== 1) {
                return false;
            }
            // Don't trigger if there's already a workflow node
            if (hasWorkflowNode(editor)) {
                return false;
            }
            return true;
        },

        // Command to insert the selected workflow
        command: ({ editor, range, props }) => {
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

        // Fetch matching items
        items: createSuggestionItemsLoader(searchFn, debounceMs),

        // Render lifecycle for the popover
        render: createSuggestionRenderLifecycle(
            WorkflowPopover,
            (props: SuggestionProps<WorkflowItem>) => ({
                items: props.items,
                command: props.command,
                getReferenceClientRect: props.clientRect,
                open: true,
                onClose: () => {
                    props.editor
                        ?.chain()
                        .focus()
                        .deleteRange({
                            from: props.range.from,
                            to: props.range.to,
                        })
                        .run();
                },
            })
        ),
    };
}
