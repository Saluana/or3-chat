import type { SuggestionProps } from '@tiptap/suggestion';
import MentionsPopover from './MentionsPopover.vue';
import {
    createSuggestionItemsLoader,
    createSuggestionRenderLifecycle,
} from '../shared/suggestion-popover';

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
    return {
        char: '@',
        items: createSuggestionItemsLoader(searchFn, debounceMs),
        render: createSuggestionRenderLifecycle(
            MentionsPopover,
            (props: SuggestionProps<MentionItem>) => ({
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
