# Source document editor extensions

This guide covers trusted source extensions in an editable OR3 checkout.
The chat composer has a separate
[hook-based extension flow](../../public/_documentation/hooks/chat-editor-extensions.md).
Installable packages use the [SDK](../../public/_documentation/plugins/plugin-sdk.md)
and its admitted surfaces.

## Choose a registry

| Contribution | Source owner | Registration lifetime |
| --- | --- | --- |
| Toolbar control | [useEditorToolbar](../../app/composables/editor/useEditorToolbar.ts) | Legacy register returns void; unregister by exclusive ID |
| TipTap node, mark, or generic extension | [useEditorNodes](../../app/composables/editor/useEditorNodes.ts) | Legacy register returns void; use matching unregister helper |
| Lazy extension resolution | [useEditorExtensionLoader](../../app/composables/editor/useEditorExtensionLoader.ts) | Editor initialization owns resolution |
| Inspector panel | [useEditorInspectorPanels](../../app/composables/editor/useEditorInspectorPanels.ts) | Register returns an owned handle |
| Document AI prompt action | [useDocumentAiActions](../../app/composables/editor/useDocumentAiActions.ts) | Register returns an owned handle |

Import contracts from their defining modules instead of copying interfaces.
Definitions support `pluginId` and `access` where the host must gate availability.
Registries do not grant server authorization.

## Add a toolbar control

Create `app/plugins/editor-strikethrough.client.ts`:

```ts
import { defineNuxtPlugin } from '#app';
import {
    registerEditorToolbarButton,
    unregisterEditorToolbarButton,
} from '~/composables/editor/useEditorToolbar';

export default defineNuxtPlugin(() => {
    const id = 'example:strikethrough';
    registerEditorToolbarButton({
        id,
        icon: 'tabler:strikethrough',
        tooltip: 'Strikethrough',
        order: 300,
        responsive: 'overflow',
        isActive: editor => editor.isActive('strike'),
        onClick: editor => { editor.chain().focus().toggleStrike().run(); },
    });
    if (import.meta.hot) {
        import.meta.hot.dispose(() => { unregisterEditorToolbarButton(id); });
    }
});
```

Toolbar buttons without responsive metadata default to the plugin overflow
group. Use `group`, `priority`, and `responsive` for placement; preserve
access through overflow in narrow panes. Registered order defaults to 200,
but built-in controls have their own layout.

## Extend TipTap

Use `registerEditorNode()` or `registerEditorMark()` for schema additions,
and `registerEditorExtension()` for behavior. A generic extension descriptor
can supply an `extension` or a lazy `factory`; inspect the loader contract
before authoring a factory. Do not add the same TipTap extension name twice.

Extensions are resolved when an editor is created. Registering or removing a
descriptor does not reconfigure an already-created editor. Recreate it or reload
to verify changes. A schema extension must also preserve saved document and
revision compatibility; do not assume its custom nodes are automatically
accepted by the document AI validator.

These legacy helpers unregister by ID. Use exclusive namespaced IDs and dispose
before replacement; component registrations need unmount cleanup too. The
registries survive HMR, which makes cleanup necessary. Avoid a barrel import
from the nonexistent `~/composables` module.

## Add a document AI action

Create `app/plugins/editor-house-style.client.ts`:

```ts
import { defineNuxtPlugin } from '#app';
import { registerDocumentAiAction } from '~/composables/editor/useDocumentAiActions';

export default defineNuxtPlugin(() => {
    const handle = registerDocumentAiAction({
        id: 'example:house-style',
        label: 'Apply house style',
        prompt: 'Use short, clear sentences while preserving all facts.',
        defaultScope: 'section',
        order: 300,
    });
    if (import.meta.hot) {
        import.meta.hot.dispose(() => { handle.dispose(); });
    }
});
```

AI contributions supply a prompt and default scope. The host still owns
credential checks, frozen snapshots, proposal validation, review, stale-result
protection, and acceptance. See
[document AI proposals](../../public/_documentation/database/documents.md#document-ai-proposals).
Inspector panels use a Vue component receiving `editor` and `documentId`;
a `defineAsyncComponent()` wrapper can keep optional UI lazy. Retain and dispose
the panel's returned handle.

## Verify the behavior

Check the control on an empty and populated document, in narrow and wide panes,
after HMR, and with a second editor open. Recreate editors when changing schema
extensions. For AI actions, verify scope selection, rejection, stale-result
refusal, and explicit acceptance. Existing source examples live in
[editor-toolbar-test](../../app/plugins/examples/editor-toolbar-test.client.ts)
and the [editor architecture](premium-document-editor.md) describes persistence.
