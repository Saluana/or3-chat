# Thread history extensions

This document explains how to register custom actions (buttons) for thread history entries.

These actions appear in the thread history UI (the actions popover on each thread in the sidebar/history views).

Core ideas

-   Expose a small registration API from `app/composables/ui-extensions/threads/useThreadHistoryActions.ts`.
-   Plugins can call `registerThreadHistoryAction()` with an object implementing the `ThreadHistoryAction` interface.
-   Actions are ordered by `order` (lower numbers appear earlier). Built-in actions are kept at low order; pick >= 200 for external actions.
-   The handler receives a context with the thread object and can show toasts, open modals, or perform DB operations.

Example

See `app/plugins/examples/thread-history-test.client.ts` for a runnable example. It registers two actions:

-   `test:inspect-thread` — logs thread details to the console and shows a toast.
-   `test:dump-thread` — logs the full thread object to the console for debugging.

API contract

-   registerThreadHistoryAction(action: ThreadHistoryAction)
    -   action.id: string — unique id for the action
    -   action.icon: string — icon name passed to buttons
    -   action.label: string — button label
    -   action.order?: number — numeric order (default 200)
    -   action.handler(ctx) — invoked when user clicks the action; receives { thread }

Edge cases & tips

-   The handler should be robust against missing or partial thread objects.
-   Prefer showing a toast for visual feedback, but fall back to console logs when UI helpers aren't available during testing.
-   Unregister actions during plugin cleanup in dev to avoid duplicate registrations on HMR.

Debugging

-   Use `listRegisteredThreadHistoryActionIds()` to inspect currently registered ids from the console.
-   The sample plugin uses `useToast()` where available; if not, it still logs to the console.

Notes

-   This API mirrors the document history actions API. For examples of document actions, see `app/plugins/examples/document-history-test.client.ts`.
