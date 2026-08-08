# useDocumentEditorToolbar

Toolbar builder for the document editor. It defines the core button set and wires each button to TipTap commands.

## Purpose

`useDocumentEditorToolbar(options, icons)` returns a computed `toolbarButtons` array. Each item carries `id`, `icon` or `text`, `label`, `getActive()`, and `onActivate()`.

The `options` argument provides the command plumbing:

```ts
{
    isActive: (name) => boolean;          // e.g. isActive('bold')
    isActiveHeading: (level) => boolean;
    toggleHeading: (level) => void;
    cmd: (name) => void;                  // runs a TipTap chain command
}
```

`icons` supplies the code/list/minus/undo/redo icon names.

`useDocumentEditorCommands()` is a companion helper returning a ready-made command object: `{ cmd, isActive, isActiveHeading, toggleHeading, getButtonActive, handleButtonClick }`, with `handleButtonClick` guarding errors per button.

## Usage

```ts
import { useDocumentEditorToolbar } from '~/composables/documents/useDocumentEditorToolbar';

const commands = useDocumentEditorCommands(); // editor-backed
const toolbar = useDocumentEditorToolbar(commands, {
    code: 'carbon:code',
    list: 'carbon:list',
    minus: 'carbon:subtract',
    undo: 'carbon:undo',
    redo: 'carbon:redo',
});
```

## Notes

-   The core set covers bold, italic, code, H1/H2 headings, lists, blockquote, horizontal rule, undo, and redo.
-   Plugin buttons are added separately through `useEditorToolbar`.

## Related

-   `useEditorToolbar` — the plugin-facing toolbar registry.
-   `DocumentEditor.vue` — main consumer.
