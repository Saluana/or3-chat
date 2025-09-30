import { registerEditorToolbarButton } from '~/composables';
import type { Editor } from '@tiptap/vue-3';
import AutocompleteState from './state';
import { computed } from 'vue';

export default defineNuxtPlugin(() => {
    try {
        console.info('[editor-autocomplete] registering toolbar button');

        // Note: The AutocompleteExtension needs to be manually added to editors that want it
        // It checks AutocompleteState.value.isEnabled internally to determine if it should be active

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
                    AutocompleteState.value.isEnabled ? 'ENABLED' : 'DISABLED'
                );
            },
        });
    } catch (e) {
        console.error('[editor-autocomplete] plugin failed to initialize', e);
    }
});
