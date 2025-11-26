import { VueRenderer } from '@tiptap/vue-3';
import { useDebounceFn } from '@vueuse/core';
import MentionsPopover from './MentionsPopover.vue';

interface MentionItem {
    id: string;
    source: 'document' | 'chat';
    label: string;
    subtitle?: string;
}

export function createMentionSuggestion(
    searchFn: (query: string) => Promise<MentionItem[]>,
    debounceMs = 100
) {
    // Create debounced search function
    const debouncedSearch = useDebounceFn(searchFn, debounceMs);

    return {
        char: '@',
        items: async ({ query }: { query: string }) => {
            const results = await debouncedSearch(query);
            return results || [];
        },
        render: () => {
            let component: VueRenderer;
            const closeHandler: (() => void) | null = null;

            return {
                onStart: (props: any) => {
                    // Mount a Popover wrapper that uses Nuxt UI instead of tippy
                    component = new VueRenderer(MentionsPopover, {
                        editor: props.editor,
                        props: {
                            items: props.items,
                            command: props.command,
                            getReferenceClientRect: props.clientRect,
                            open: true,
                            onClose: () => {
                                console.log(
                                    '[suggestions] Close event from popover'
                                );
                                // Delete the @ trigger and query to exit suggestion mode
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

                    // Ensure the TipTap editor retains focus so typing continues there
                    try {
                        // Slight delay to run after popover's own focus handling
                        setTimeout(() => {
                            props.editor?.commands?.focus?.();
                        }, 0);
                    } catch {}
                },

                onUpdate(props: any) {
                    component.updateProps({
                        items: props.items,
                        command: props.command,
                        getReferenceClientRect: props.clientRect,
                        open: true,
                        onClose: () => {
                            console.log(
                                '[suggestions] Close event from popover'
                            );
                            // Delete the @ trigger and query to exit suggestion mode
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

                    // Keep focus with editor during updates as well
                    try {
                        setTimeout(() => {
                            props.editor?.commands?.focus?.();
                        }, 0);
                    } catch {}
                },

                onKeyDown(props: any) {
                    // VueUse onKeyStroke in MentionsPopover handles Escape now
                    // Just forward other keys to the list component
                    return component.ref?.onKeyDown?.(props);
                },

                onExit() {
                    if (component?.element?.parentNode) {
                        component.element.parentNode.removeChild(
                            component.element
                        );
                    }
                    component.destroy();
                },
            };
        },
    };
}
