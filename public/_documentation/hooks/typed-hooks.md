# typed-hooks

Typed wrapper around the hook engine that preserves runtime behavior while delivering full TypeScript inference.

---

## What does it do?

-   Wraps a `HookEngine` with strongly typed methods for registering/executing hooks.
-   Infers callback signatures from `hook-types.ts` using `InferHookCallback` utilities.
-   Normalizes `hooks.on` to pick `action` vs `filter` automatically when the name contains `:filter:`.
-   Exposes diagnostics and the underlying engine for advanced use.

---

## API

`createTypedHookEngine(engine: HookEngine): TypedHookEngine`

Returns an object implementing:

-   `addAction`, `removeAction`, `doAction`, `doActionSync`
-   `addFilter`, `removeFilter`, `applyFilters`, `applyFiltersSync`
-   `on`, `off`, `onceAction`
-   `hasAction`, `hasFilter`, `removeAllCallbacks`, `currentPriority`
-   `_engine`, `_diagnostics`

### Example

```ts
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';

const engine = createHookEngine();
const hooks = createTypedHookEngine(engine);

hooks.addFilter('ui.chat.message:filter:outgoing', (text) => text.trim());
const sanitized = await hooks.applyFilters(
    'ui.chat.message:filter:outgoing',
    message
);
```

TypeScript enforces that callbacks return the correct value (`string` above) and that the hook name exists.

---

## Kind inference

-   `on(name, callback, opts?)` automatically sets `opts.kind` to `'filter'` when the name includes `':filter:'`.
-   You can still override `opts.kind` to handle custom naming schemes.

---

## Passthrough utilities

-   `hasAction` / `hasFilter` — Useful for tests or debugging.
-   `removeAllCallbacks` — Clear listeners by priority (e.g., during teardown).
-   `currentPriority` — Inspect priority during nested hook execution.
-   `_diagnostics` — Direct access to timing/error aggregates from the base engine.

---

## Usage tips

-   Use `useHooks()` (which already wraps the injected engine) instead of building a new typed engine in most components.
-   Export the typed instance when building plugins so consumers benefit from strong typing.
-   When extending hook payloads via declaration merging, the typed engine automatically reflects the new signatures.
