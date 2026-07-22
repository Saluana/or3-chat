import type { SuggestionOptions, SuggestionProps } from '@tiptap/suggestion';
import DocumentAiActionPopover from './DocumentAiActionPopover.vue';
import {
    createSuggestionItemsLoader,
    createSuggestionRenderLifecycle,
} from '../shared/suggestion-popover';
import {
    DocumentAiSlashCommandPluginKey,
    type DocumentAiPromptAction,
} from './slashCommandExtension';

export function createDocumentAiActionSuggestion(
    search: (query: string) => Promise<DocumentAiPromptAction[]>,
    select: (action: DocumentAiPromptAction) => void,
): Partial<SuggestionOptions<DocumentAiPromptAction>> {
    return {
        char: '/',
        allowedPrefixes: [null] as unknown as string[],
        pluginKey: DocumentAiSlashCommandPluginKey,
        allow: ({ range }) => range.from === 1,
        command: ({ editor, range, props }) => {
            const action = props as DocumentAiPromptAction;
            const content = action.prompt.split('\n').flatMap((line, index) => [
                ...(index ? [{ type: 'hardBreak' }] : []),
                ...(line ? [{ type: 'text', text: line }] : []),
            ]);
            editor
                .chain()
                .focus()
                .deleteRange(range)
                .insertContent(content)
                .run();
            select(action);
        },
        items: createSuggestionItemsLoader(search, 40),
        render: createSuggestionRenderLifecycle(
            DocumentAiActionPopover,
            (props: SuggestionProps<DocumentAiPromptAction>) => ({
                items: props.items,
                command: props.command,
                getReferenceClientRect: props.clientRect,
                open: true,
            }),
        ),
    };
}
