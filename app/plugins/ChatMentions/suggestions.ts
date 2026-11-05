import type { SuggestionProps } from '@tiptap/suggestion';
import MentionsPopover from './MentionsPopover.vue';
import { subscribeMentionInvalidation } from './useChatMentions';
import {
    createSuggestionItemsLoader,
    createSuggestionRenderLifecycle,
} from '../shared/suggestion-popover';

declare module '@tiptap/core' {
    interface Storage {
        /** Installed by the chat composer; other editors omit this bridge. */
        or3MentionAttachments?: {
            attachImage: (id: string) => Promise<void>;
        };
    }
}

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
        render() {
            let current: SuggestionProps<MentionItem> | null = null;
            let popupQuery: string | null = null;
            let token = 0;
            let timer: ReturnType<typeof setTimeout> | undefined;
            let stop: (() => void) | undefined;
            const refresh = () => {
                const props = current;
                if (!props) return;
                const mine = ++token;
                clearTimeout(timer);
                lifecycle.onUpdate({ ...props, items: [] });
                timer = setTimeout(async () => {
                    const items = await searchFn(popupQuery ?? props.query).catch(() => []);
                    if (mine === token && current === props && !props.editor.isDestroyed) {
                        lifecycle.onUpdate({ ...props, items });
                    }
                }, debounceMs);
            };
            const lifecycle = createSuggestionRenderLifecycle<MentionItem>(
                MentionsPopover,
                (props: SuggestionProps<MentionItem>) => ({
                    items: props.items,
                    search: (query: string) => { popupQuery = query; refresh(); },
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
            )();
            return {
                onStart(props: SuggestionProps<MentionItem>) {
                    current = props;
                    lifecycle.onStart(props);
                    stop = subscribeMentionInvalidation(refresh);
                },
                onUpdate(props: SuggestionProps<MentionItem>) {
                    token += 1;
                    clearTimeout(timer);
                    if (current?.query !== props.query) popupQuery = null;
                    current = props;
                    if (popupQuery !== null) refresh();
                    else lifecycle.onUpdate(props);
                },
                onKeyDown: lifecycle.onKeyDown,
                onExit() {
                    token += 1;
                    current = null;
                    clearTimeout(timer);
                    stop?.();
                    lifecycle.onExit();
                },
            };
        },
    };
}
