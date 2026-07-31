import { computed, type Ref } from 'vue';
import type { Editor } from '@tiptap/vue-3';
import { redo, undo } from '@tiptap/pm/history';
import type { EditorToolbarButton } from '~/composables';

interface CoreToolbarItem {
    id: string;
    icon?: string;
    text?: string;
    label: string;
    getActive?: () => boolean;
    onActivate: () => void;
}

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

function isHeadingLevel(level: number): level is HeadingLevel {
    return Number.isInteger(level) && level >= 1 && level <= 6;
}

export function useDocumentEditorCommands(
    editor: Ref<Editor | null>,
    emitContent: () => void
) {
    const commands: Record<string, () => void> = {
        toggleBold: () => editor.value?.chain().focus().toggleMark('bold').run(),
        toggleItalic: () => editor.value?.chain().focus().toggleMark('italic').run(),
        toggleCode: () => editor.value?.chain().focus().toggleMark('code').run(),
        toggleBulletList: () =>
            editor.value?.chain().focus().toggleList('bulletList', 'listItem').run(),
        toggleOrderedList: () =>
            editor.value?.chain().focus().toggleList('orderedList', 'listItem').run(),
        setHorizontalRule: () =>
            editor.value?.chain().focus().insertContent({ type: 'horizontalRule' }).run(),
        undo: () => {
            const current = editor.value;
            if (!current) return;
            undo(current.state, current.view.dispatch);
        },
        redo: () => {
            const current = editor.value;
            if (!current) return;
            redo(current.state, current.view.dispatch);
        },
    };

    function cmd(name: string) {
        commands[name]?.();
        emitContent();
    }

    function isActive(name: string) {
        return editor.value?.isActive(name) ?? false;
    }

    function isActiveHeading(level: number) {
        if (!isHeadingLevel(level)) return false;
        return editor.value?.isActive('heading', { level }) ?? false;
    }

    function toggleHeading(level: number) {
        if (!isHeadingLevel(level)) return;
        editor.value?.chain().focus().toggleNode('heading', 'paragraph', { level }).run();
        emitContent();
    }

    function getButtonActive(btn: EditorToolbarButton): boolean {
        const ed = editor.value;
        if (!ed || !btn.isActive) return false;
        try {
            return btn.isActive(ed);
        } catch (error) {
            if (import.meta.dev) {
                console.error(
                    `[DocumentEditor] isActive() threw for button ${btn.id}:`,
                    error
                );
            }
            return false;
        }
    }

    function handleButtonClick(btn: EditorToolbarButton): void {
        const ed = editor.value;
        if (!ed) return;
        try {
            void btn.onClick(ed);
        } catch (error) {
            if (import.meta.dev) {
                console.error(
                    `[DocumentEditor] onClick() threw for button ${btn.id}:`,
                    error
                );
            }
        }
    }

    return {
        cmd,
        isActive,
        isActiveHeading,
        toggleHeading,
        getButtonActive,
        handleButtonClick,
    };
}

export function useDocumentEditorToolbar(
    options: {
        isActive: (name: string) => boolean;
        isActiveHeading: (level: number) => boolean;
        toggleHeading: (level: number) => void;
        cmd: (name: string) => void;
    },
    icons: {
        code: string;
        list: string;
        minus: string;
        undo: string;
        redo: string;
    }
) {
    const toolbarButtons = computed<CoreToolbarItem[]>(() => [
        {
            id: 'bold',
            icon: 'carbon:text-bold',
            label: 'Bold (⌘B)',
            getActive: () => options.isActive('bold'),
            onActivate: () => options.cmd('toggleBold'),
        },
        {
            id: 'italic',
            icon: 'carbon:text-italic',
            label: 'Italic (⌘I)',
            getActive: () => options.isActive('italic'),
            onActivate: () => options.cmd('toggleItalic'),
        },
        {
            id: 'code',
            icon: icons.code,
            label: 'Code',
            getActive: () => options.isActive('code'),
            onActivate: () => options.cmd('toggleCode'),
        },
        {
            id: 'h1',
            text: 'H1',
            label: 'H1',
            getActive: () => options.isActiveHeading(1),
            onActivate: () => options.toggleHeading(1),
        },
        {
            id: 'h2',
            text: 'H2',
            label: 'H2',
            getActive: () => options.isActiveHeading(2),
            onActivate: () => options.toggleHeading(2),
        },
        {
            id: 'h3',
            text: 'H3',
            label: 'H3',
            getActive: () => options.isActiveHeading(3),
            onActivate: () => options.toggleHeading(3),
        },
        {
            id: 'bulletList',
            icon: icons.list,
            label: 'Bullet list',
            getActive: () => options.isActive('bulletList'),
            onActivate: () => options.cmd('toggleBulletList'),
        },
        {
            id: 'orderedList',
            icon: 'carbon:list-numbered',
            label: 'Ordered list',
            getActive: () => options.isActive('orderedList'),
            onActivate: () => options.cmd('toggleOrderedList'),
        },
        {
            id: 'horizontalRule',
            icon: icons.minus,
            label: 'Horizontal Rule',
            getActive: () => false,
            onActivate: () => options.cmd('setHorizontalRule'),
        },
        {
            id: 'undo',
            icon: icons.undo,
            label: 'Undo',
            getActive: () => false,
            onActivate: () => options.cmd('undo'),
        },
        {
            id: 'redo',
            icon: icons.redo,
            label: 'Redo',
            getActive: () => false,
            onActivate: () => options.cmd('redo'),
        },
    ]);

    return {
        toolbarButtons,
    };
}
