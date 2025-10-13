# hook-types

TypeScript toolkit describing hook names, payload interfaces, and inference helpers for the OR3 hook engine.

---

## What does it do?

-   Defines structured payload interfaces for AI, UI panes, sidebar, branching, DB entities, and more.
-   Exposes string literal unions for action/filter hook names, including DB template literals.
-   Derives argument tuples and return types for every hook via `HookPayloadMap`.
-   Provides utility types for plugins to validate hook names and callback signatures.

---

## Payload interfaces

Notable groups:

-   **AI** — `AiSendBeforePayload`, `AiStreamDeltaPayload`, `AiRetryAfterPayload`.
-   **Pane/UI** — `UiPaneActivePayload`, `UiPaneMsgSentPayload`, `UiSidebarSelectPayload`.
-   **Branching** — `BranchForkOptions`, `BranchContextAfterPayload`.
-   **DB entities** — Lightweight mirror types (`MessageEntity`, `FileEntity`, `PromptEntity`, …).
-   **Utility** — `DbCreatePayload<T>`, `DbUpdatePayload<T>`, `DbDeletePayload<T>`.

These interfaces power typed composables, doc tables, and hook filters.

---

## Hook name unions

| Type               | Description                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `ActionHookName`   | Literal union matching `*:action:*` hooks (core + DB + extensions).                                                       |
| `FilterHookName`   | Literal union matching `*:filter:*` hooks (core + DB + extensions).                                                       |
| `HookName`         | Combined action + filter union used across the app.                                                                       |
| `DbActionHookName` | Template literal union for DB action hooks, including delete phases and custom cases (`db.files.refchange:action:after`). |
| `DbFilterHookName` | Template literal union for DB filters, including specialized titles/hash validators.                                      |

Plugin authors can augment `Or3ActionHooks` / `Or3FilterHooks` globally to extend these unions.

---

## Inference utilities

| Type                          | Purpose                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------- |
| `InferHookParams<K>`          | Tuple of callback parameters for hook `K`.                                   |
| `InferHookReturn<K>`          | Return type a callback must produce (`void` for actions, value for filters). |
| `InferHookCallback<K>`        | Full function signature expected for hook `K`.                               |
| `IsAction<K>` / `IsFilter<K>` | Type-level booleans.                                                         |
| `ExtractHookPayload<K>`       | First parameter payload, handy for documentation.                            |
| `MatchingHooks<'pattern'>`    | Narrow hooks by template literal pattern (`'db.files.*'`).                   |
| `InferDbEntity<'db.files.*'>` | Maps hook strings back to entity interfaces.                                 |

These utilities are heavily used by `typed-hooks.ts` and composables like `useHookEffect`.

---

## Error helpers

-   `ValidateHookName<'bad.name'>` produces string literal diagnostics suggesting similar hooks.
-   `CallbackMismatch<Expected, Got>` formats readable error messages for mismatched callbacks.
-   Temporary guard `__hook_name_checks__` keeps frequently-used names anchored in the type system.

---

## Usage tips

-   When adding new hooks, update `CoreHookPayloadMap` (or appropriate DB unions) first; inference and docs will follow automatically.
-   For plugin ecosystems, augment `Or3ActionHooks`/`Or3FilterHooks` in a `.d.ts` file to make your hooks discoverable.
-   Use `InferHookCallback<'ui.pane.msg:action:sent'>` in unit tests to ensure mocks stay in sync with payload evolution.

---

## Related

-   `hook-keys.ts` — Convenience `typedOn` helper that leans on these types.
-   `typed-hooks.ts` — Runtime wrapper applying `InferHookCallback` signatures to the hook engine.
-   `useHookEffect` — Composable that uses `InferHookCallback` for DX.
