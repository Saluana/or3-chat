import type { Editor } from '@tiptap/vue-3';
import type { Ref } from 'vue';

export function useChatInputContainerFocus(
    editor: Ref<Editor | null>,
    dropZoneRef: Ref<HTMLElement | null>
) {
    const interactiveTags = new Set([
        'BUTTON',
        'INPUT',
        'TEXTAREA',
        'SELECT',
        'A',
        'LABEL',
    ]);

    const interactiveRoles = new Set([
        'button',
        'link',
        'menuitem',
        'option',
        'tab',
        'textbox',
        'combobox',
        'listbox',
    ]);

    const handleContainerClick = (event: MouseEvent) => {
        const target = event.target as HTMLElement | null;
        if (!target) return;

        let el: HTMLElement | null = target;
        while (el && el !== dropZoneRef.value) {
            if (interactiveTags.has(el.tagName)) return;
            const role = el.getAttribute('role');
            if (role && interactiveRoles.has(role)) return;
            if (el.classList.contains('ProseMirror') || el.classList.contains('tiptap')) {
                return;
            }
            if (el.isContentEditable) return;
            if (el.hasAttribute('data-radix-collection-item')) return;
            el = el.parentElement;
        }

        editor.value?.commands.focus('end');
    };

    return {
        handleContainerClick,
    };
}
