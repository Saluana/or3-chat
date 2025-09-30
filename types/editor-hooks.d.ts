// Type augmentation for editor lifecycle hooks

import type { Editor } from '@tiptap/vue-3';

declare global {
    interface Or3ActionHooks {
        'editor.created:action:after': [{ editor: Editor }];
        'editor.updated:action:after': [{ editor: Editor }];
    }
}

export {};
