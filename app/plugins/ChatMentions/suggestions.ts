import { VueRenderer } from '@tiptap/vue-3';
import MentionsPopover from './MentionsPopover.vue';

interface MentionItem {
    id: string;
    source: 'document' | 'chat';
    label: string;
    subtitle?: string;
}

export function createMentionSuggestion(
    searchFn: (query: string) => Promise<MentionItem[]>
) {
    return {
        char: '@',
        items: async ({ query }: { query: string }) => {
            console.log('[mentions] Searching for:', query);
            const results = await searchFn(query);
            console.log('[mentions] Search results:', results);
            return results;
        },
        render: () => {
            let component: VueRenderer;

            return {
                onStart: (props: any) => {
                    console.log(
                        '[mentions] onStart called with items:',
                        props.items
                    );

                    // Mount a Popover wrapper that uses Nuxt UI instead of tippy
                    component = new VueRenderer(MentionsPopover, {
                        editor: props.editor,
                        props: {
                            items: props.items,
                            command: props.command,
                            getReferenceClientRect: props.clientRect,
                            open: true,
                        },
                    });

                    if (component.element) {
                        document.body.appendChild(component.element);
                    }
                    console.log('[mentions] Popover mounted');

                    // Ensure the TipTap editor retains focus so typing continues there
                    try {
                        // Slight delay to run after popover's own focus handling
                        setTimeout(() => {
                            props.editor?.commands?.focus?.();
                        }, 0);
                    } catch {}
                },

                onUpdate(props: any) {
                    console.log('[mentions] onUpdate called');
                    component.updateProps({
                        items: props.items,
                        command: props.command,
                        getReferenceClientRect: props.clientRect,
                        open: true,
                    });

                    // Keep focus with editor during updates as well
                    try {
                        setTimeout(() => {
                            props.editor?.commands?.focus?.();
                        }, 0);
                    } catch {}
                },

                onKeyDown(props: any) {
                    if (props.event.key === 'Escape') {
                        // Keep API parity; Popover closes when TipTap calls onExit
                        component.ref?.hide?.();
                        return true;
                    }

                    return component.ref?.onKeyDown?.(props);
                },

                onExit() {
                    console.log('[mentions] onExit called');
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
