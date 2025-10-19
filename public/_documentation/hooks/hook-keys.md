# hook-keys

Catalog of high-signal hook keys and typed helpers for ergonomically registering listeners.

---

## What does it do?

-   Defines string literal unions for well-known UI/AI/DB hook names.
-   Provides the `typedOn` helper, returning a type-safe `on()` wrapper around the hook engine.
-   Exposes utility return types to clarify filter semantics.

---

## Key unions

| Type           | Description                                                                  |
| -------------- | ---------------------------------------------------------------------------- |
| `KnownHookKey` | Enumerated list of frequently-used hooks (chat, pane, files).                |
| `DbFamily`     | Union of DB entity families (`'messages'`, `'documents'`, …).                |
| `DbHookKey`    | Template literal `db.${DbFamily}.${string}` covering table-specific hooks.   |
| `HookKey`      | Final public union combining known keys, DB hooks, and open string fallback. |

These unions power editor autocomplete while remaining permissive for plugin authors.

---

## Hook payload mapping

`HookPayloads` maps each `KnownHookKey` to a tuple of arguments expected by handlers. Examples:

-   `'ai.chat.stream:action:delta'` → `[requestId: string, payload: AiStreamDeltaPayload]`
-   `'ui.pane.thread:filter:select'` → `[threadId, pane, previousId]`
-   `'files.attach:filter:input'` → `[FilesAttachInputPayload | false]`

This mapping feeds the `typedOn` helper.

---

## `typedOn(hooks)`

```ts
import { typedOn } from '~/core/hooks/hook-keys';

const on = typedOn(useHooks()._engine);
on('ui.pane.msg:action:sent', (payload) => {
    console.log(payload.message.length);
});
```

-   Narrows `key` to `KnownHookKey` entries.
-   Infers callback parameters from `HookPayloads`.
-   Delegates to the underlying `hooks.on` and returns its disposer.

---

## Utility return types

-   `ChatOutgoingFilterReturn` — `string | false` (veto sending by returning `false`).
-   `ChatIncomingFilterReturn` — Always `string`.
-   `FilesAttachFilterReturn` — `FilesAttachInputPayload | false`.

Use these aliases in docs and tests to clarify expectations.

---

## Usage tips

-   Add new hooks by extending `KnownHookKey`/`HookPayloads` incrementally to keep compile times low.
-   Prefer `typedOn` in modules that need maximum inference but still interact with the untyped engine instance.
-   For custom plugin hooks, rely on `HookKey`’s permissiveness and extend via `hook-types` global augmentation.
