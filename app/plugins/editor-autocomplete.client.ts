import {
    registerEditorToolbarButton,
    listRegisteredEditorToolbarButtonIds,
    registerEditorExtension,
} from '~/composables';
import type { Editor } from '@tiptap/vue-3';
import AutocompleteState from './EditorAutocomplete/state';
import { computed } from 'vue';
import type { EditorExtension } from '~/composables/editor/useEditorNodes';

export default defineNuxtPlugin(() => {
    try {
        // Note: The AutocompleteExtension is now registered dynamically and will be
        // automatically included in all editors. It checks AutocompleteState.value.isEnabled
        // internally to determine if it should be active.

        if (import.meta.client) {
            // Register the TipTap extension lazily to keep TipTap/ProseMirror out of entry
            registerEditorExtension({
                id: 'editor-autocomplete:extension',
                order: 100, // Load before most plugins but after core
                factory: async () => {
                    const mod = await import(
                        /* @vite-ignore */ './EditorAutocomplete/TiptapExtension'
                    );
                    return (mod as any).AutocompleteExtension as any;
                },
            } as EditorExtension);

            // Register toolbar button to toggle autocomplete
            registerEditorToolbarButton({
                id: 'editor-autocomplete:toggle',
                icon: 'pixelarticons:zap',
                tooltip: computed(() =>
                    AutocompleteState.value.isEnabled
                        ? 'Disable Autocomplete'
                        : 'Enable Autocomplete'
                ) as any,
                order: 300,
                isActive: (editor: Editor) => AutocompleteState.value.isEnabled,
                onClick: (editor: Editor) => {
                    AutocompleteState.value.isEnabled =
                        !AutocompleteState.value.isEnabled;
                },
            });
        }
    } catch (e) {
        console.error('[editor-autocomplete] plugin failed to initialize', e);
    }
});
