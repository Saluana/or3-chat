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

import { VueRenderer } from '@tiptap/vue-3';
import { useDebounceFn } from '@vueuse/core';
import type { SuggestionOptions, SuggestionProps } from '@tiptap/suggestion';
import type { WorkflowItem } from './useWorkflowSlashCommands';
import WorkflowPopover from './WorkflowPopover.vue';
import {
    SlashCommandPluginKey,
    hasWorkflowNode,
} from './slashCommandExtension';

/**
 * Create the render lifecycle for the workflow suggestion popover.
 *
 * @returns TipTap suggestion render configuration
 */
function createRenderLifecycle() {
    let component: VueRenderer | null = null;

    return {
        onStart: (props: SuggestionProps<WorkflowItem>) => {
            // Mount the popover component
            component = new VueRenderer(WorkflowPopover, {
                editor: props.editor,
                props: {
                    items: props.items,
                    command: props.command,
                    getReferenceClientRect: props.clientRect,
                    open: true,
                    onClose: () => {
                        // Delete the / trigger and query to exit suggestion mode
                        props.editor
                            ?.chain()
                            .focus()
                            .deleteRange({
                                from: props.range.from,
                                to: props.range.to,
                            })
                            .run();
                    },
                },
            });

            if (component.element) {
                document.body.appendChild(component.element);
            }

            // Keep editor focused
            try {
                setTimeout(() => {
                    props.editor?.commands?.focus?.();
                }, 0);
            } catch {}
        },

        onUpdate(props: SuggestionProps<WorkflowItem>) {
            if (!component) return;

            component.updateProps({
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
            });

            // Keep editor focused during updates
            try {
                setTimeout(() => {
                    props.editor?.commands?.focus?.();
                }, 0);
            } catch {}
        },

        onKeyDown(props: { event: KeyboardEvent }) {
            // Forward key events to the popover component
            return component?.ref?.onKeyDown?.(props) ?? false;
        },

        onExit() {
            // Clean up the popover
            if (component?.element?.parentNode) {
                component.element.parentNode.removeChild(component.element);
            }
            component?.destroy();
            component = null;
        },
    };
}

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
    // Debounced search to avoid excessive queries while typing
    const debouncedSearch = useDebounceFn(searchFn, debounceMs);

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
        items: async ({ query }: { query: string }) => {
            const results = await debouncedSearch(query);
            return results || [];
        },

        // Render lifecycle for the popover
        render: createRenderLifecycle,
    };
}
