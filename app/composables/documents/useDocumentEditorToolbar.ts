import { computed, type Ref } from 'vue';
import type { EditorToolbarButton } from '~/composables';

interface CoreToolbarItem {
    id: string;
    icon?: string;
    text?: string;
    label: string;
    getActive?: () => boolean;
    onActivate: () => void;
}

export function useDocumentEditorCommands(
    editor: Ref<any>,
    emitContent: () => void
) {
    const commands: Record<string, () => void> = {
        toggleBold: () => (editor.value as any)?.chain().focus().toggleBold().run(),
        toggleItalic: () => (editor.value as any)?.chain().focus().toggleItalic().run(),
        toggleCode: () => (editor.value as any)?.chain().focus().toggleCode().run(),
        toggleBulletList: () =>
            (editor.value as any)?.chain().focus().toggleBulletList().run(),
        toggleOrderedList: () =>
            (editor.value as any)?.chain().focus().toggleOrderedList().run(),
        setHorizontalRule: () =>
            (editor.value as any)?.chain().focus().setHorizontalRule().run(),
        undo: () => (editor.value as any)?.commands.undo(),
        redo: () => (editor.value as any)?.commands.redo(),
    };

    function cmd(name: string) {
        commands[name]?.();
        emitContent();
    }

    function isActive(name: string) {
        return (editor.value as any)?.isActive(name) || false;
    }

    function isActiveHeading(level: number) {
        return (editor.value as any)?.isActive('heading', { level }) || false;
    }

    function toggleHeading(level: number) {
        (editor.value as any)
            ?.chain()
            .focus()
            .toggleHeading({ level: level as any })
            .run();
        emitContent();
    }

    function getButtonActive(btn: EditorToolbarButton): boolean {
        const ed = editor.value;
        if (!ed || !btn.isActive) return false;
        try {
            return btn.isActive(ed as any);
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
            btn.onClick(ed as any);
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
