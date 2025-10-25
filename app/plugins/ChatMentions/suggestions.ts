import { VueRenderer } from '@tiptap/vue-3';
import tippy, { type Instance as TippyInstance } from 'tippy.js';
import MentionsList from './MentionsList.vue';

interface MentionItem {
    id: string;
    source: 'document' | 'chat';
    label: string;
    subtitle?: string;
}

export function createMentionSuggestion(searchFn: (query: string) => Promise<MentionItem[]>) {
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
            let popup: TippyInstance[];

            return {
                onStart: (props: any) => {
                    console.log('[mentions] onStart called with items:', props.items);

                    component = new VueRenderer(MentionsList, {
                        props,
                        editor: props.editor,
                    });

                    if (!props.clientRect) {
                        return;
                    }

                    popup = tippy('body', {
                        getReferenceClientRect: props.clientRect,
                        appendTo: () => document.body,
                        content: component.element,
                        showOnCreate: true,
                        interactive: true,
                        trigger: 'manual',
                        placement: 'bottom-start',
                        theme: 'mentions',
                    });

                    console.log('[mentions] Popup created');
                },

                onUpdate(props: any) {
                    console.log('[mentions] onUpdate called');
                    component.updateProps(props);

                    if (!props.clientRect) {
                        return;
                    }

                    popup[0].setProps({
                        getReferenceClientRect: props.clientRect,
                    });
                },

                onKeyDown(props: any) {
                    if (props.event.key === 'Escape') {
                        popup[0].hide();
                        return true;
                    }

                    return component.ref?.onKeyDown(props);
                },

                onExit() {
                    console.log('[mentions] onExit called');
                    popup[0].destroy();
                    component.destroy();
                },
            };
        },
    };
}
