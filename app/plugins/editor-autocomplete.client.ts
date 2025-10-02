import {
    registerEditorToolbarButton,
    listRegisteredEditorToolbarButtonIds,
    registerEditorExtension,
} from '~/composables';
import type { Editor } from '@tiptap/vue-3';
import AutocompleteState from './EditorAutocomplete/state';
import { AutocompleteExtension } from './EditorAutocomplete/TiptapExtension';
import { computed } from 'vue';

export default defineNuxtPlugin(() => {
    try {
        // Note: The AutocompleteExtension is now registered dynamically and will be
        // automatically included in all editors. It checks AutocompleteState.value.isEnabled
        // internally to determine if it should be active.

        if (import.meta.client) {
            // Register the TipTap extension
            registerEditorExtension({
                id: 'editor-autocomplete:extension',
                extension: AutocompleteExtension,
                order: 100, // Load before most plugins but after core
            });

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
