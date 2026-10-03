import type { SuggestionProps } from '@tiptap/suggestion';
import MentionsPopover from './MentionsPopover.vue';
import {
    createSuggestionItemsLoader,
    createSuggestionRenderLifecycle,
} from '../shared/suggestion-popover';

interface MentionItem {
    id: string;
    source: 'document' | 'chat' | 'file';
    label: string;
    subtitle?: string;
    imageHash?: string;
}

export function createMentionSuggestion(
    searchFn: (query: string) => Promise<MentionItem[]>,
    debounceMs = 100
) {
    return {
        char: '@',
        items: createSuggestionItemsLoader(searchFn, debounceMs),
        render: createSuggestionRenderLifecycle(
            MentionsPopover,
            (props: SuggestionProps<MentionItem>) => ({
                items: props.items,
                command: (item: MentionItem) => {
                    const attach = props.editor.storage.or3MentionAttachments?.attachImage;
                    if (item.source === 'file' && item.imageHash && typeof attach === 'function') {
                        props.editor.chain().focus().deleteRange(props.range).run();
                        void attach(item.id);
                    } else {
                        props.command(item);
                    }
                },
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
