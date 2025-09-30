import {
    registerEditorToolbarButton,
    listRegisteredEditorToolbarButtonIds,
} from '~/composables';
import type { Editor } from '@tiptap/vue-3';
import AutocompleteState from './EditorAutocomplete/state';
import { computed } from 'vue';

export default defineNuxtPlugin(() => {
    try {
        console.info('[editor-autocomplete] plugin starting');

        // Note: The AutocompleteExtension needs to be manually added to editors that want it
        // It checks AutocompleteState.value.isEnabled internally to determine if it should be active

        // Wait for next tick to ensure composables are ready
        if (process.client) {
            console.info('[editor-autocomplete] registering toolbar button');

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
                    console.log(
                        '[editor-autocomplete] toggled, now',
                        AutocompleteState.value.isEnabled
                            ? 'ENABLED'
                            : 'DISABLED'
                    );
                },
            });

            console.info(
                '[editor-autocomplete] toolbar button registered successfully'
            );
            console.info(
                '[editor-autocomplete] all registered buttons:',
                listRegisteredEditorToolbarButtonIds()
            );
        }
    } catch (e) {
        console.error('[editor-autocomplete] plugin failed to initialize', e);
    }
});
