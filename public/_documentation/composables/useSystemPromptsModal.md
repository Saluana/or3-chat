# useSystemPromptsModal

`useSystemPromptsModal` is the shared controller for the system prompt library.
PageShell renders one modal host, while chat settings and the command palette
open it with the appropriate entry state and chat context.

## Usage

```ts
const promptsModal = useSystemPromptsModal();

promptsModal.open({ mode: 'home', threadId, paneId });
promptsModal.open({ mode: 'edit', promptId: 'prompt-id' });
promptsModal.open({ mode: 'new' });
```

## API

- `isOpen`: writable computed state for the shared modal.
- `request`: the current `home`, `edit`, or `new` request and optional prompt,
  thread, and pane identifiers.
- `open(options)`: replaces the current request and opens the modal.
- `close()`: closes the modal and clears transient request state.
- `notifySelected(promptId)`: notifies an optional selection callback supplied
  by the opener.

An `edit` request without a prompt id safely falls back to the library home.
The controller stores only transient UI state; prompt content, tags, and
favorites remain in the workspace database.
