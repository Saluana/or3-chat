// Type augmentation for editor lifecycle hooks

import type { Editor } from '@tiptap/vue-3';
import type { Extension } from '@tiptap/core';

declare global {
    interface Or3ActionHooks {
        'editor.created:action:after': [{ editor: Editor }];
        'editor.updated:action:after': [{ editor: Editor }];
    }

    interface Or3FilterHooks {
        'ui.chat.editor:filter:extensions': [Extension[]];
    }
}

export {};
