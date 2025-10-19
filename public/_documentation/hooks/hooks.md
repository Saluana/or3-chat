# hooks

Lightweight hook engine that powers OR3’s action/filter system with priority scheduling, async support, and diagnostics.

---

## What does it do?

-   Registers callbacks as **actions** (fire-and-forget) or **filters** (value transformers).
-   Supports wildcard subscriptions with glob patterns (`ai.chat.*`).
-   Executes listeners in priority order, tracking the current priority stack.
-   Provides both async (`doAction`, `applyFilters`) and sync variants.
-   Captures timing and error metrics for introspection.

---

## Core concepts

| Concept   | Details                                                                           |
| --------- | --------------------------------------------------------------------------------- |
| Action    | Side-effect listeners, return `void`/`Promise<void>`. Run via `doAction`.         |
| Filter    | Transform a value and return the next value in the chain. Run via `applyFilters`. |
| Priority  | Lower numbers execute first (default `10`). Ties fall back to insertion order.    |
| Wildcards | Use `*` to match multiple hook names (`db.*.delete:action:after`).                |

---

## API surface

| Function                | Signature                              | Notes                                                  |
| ----------------------- | -------------------------------------- | ------------------------------------------------------ |
| `addAction`             | `(name, fn, priority?, acceptedArgs?)` | Registers an action listener.                          |
| `removeAction`          | `(name, fn, priority?)`                | Removes a specific action listener.                    |
| `doAction`              | `(name, ...args) => Promise<void>`     | Runs all action listeners async.                       |
| `doActionSync`          | `(name, ...args) => void`              | Synchronous variant.                                   |
| `addFilter`             | `(name, fn, priority?, acceptedArgs?)` | Registers filter listener.                             |
| `removeFilter`          | `(name, fn, priority?)`                | Removes filter listener.                               |
| `applyFilters`          | `(name, value, ...args) => Promise<T>` | Runs filters async, returning the final value.         |
| `applyFiltersSync`      | `(name, value, ...args) => T`          | Synchronous variant.                                   |
| `on`                    | `(name, fn, opts?) => disposer`        | Ergonomic wrapper picking `action` vs `filter`.        |
| `off`                   | `(disposer) => void`                   | Safely invokes disposers (with error reporting).       |
| `onceAction`            | `(name, fn, priority?) => disposer`    | Auto-removes listener after first fire.                |
| `hasAction / hasFilter` | `(name?, fn?)`                         | Returns `false`/priority/boolean for existence checks. |
| `removeAllCallbacks`    | `(priority?)`                          | Drops all callbacks, optionally by priority.           |
| `currentPriority`       | `() => number \| false`                | Reports the priority currently executing.              |

Diagnostics live under `_diagnostics` with per-hook timing arrays and error counts.

---

## Execution flow

1. **Lookup** — Gathers exact matches plus wildcard entries, then sorts by priority/id.
2. **Timing** — Measures each callback using `performance.now` when available.
3. **Errors** — Logs console errors and increments `_diagnostics.errors[name]` without interrupting other listeners.
4. **Filters** — Thread the transformed value through the chain, returning the final result.

---

## Wildcards

-   Register with `hooks.addAction('ui.pane.*', handler)` to observe entire families.
-   Stored with a compiled `RegExp` for quick matching, still respecting priority.
-   Removal requires the original glob string + callback reference.

---

## Usage tips

-   Favor the typed wrapper (`createTypedHookEngine`) or composable (`useHooks`) for better DX.
-   Always return the transformed value from filters; returning `undefined` will propagate.
-   Use `onceAction` for analytics pings or onboarding to avoid manual cleanup.
-   Inspect `hooks._diagnostics.timings` in devtools to spot slow listeners.

---

## Related

-   `hook-types.ts` — Type system describing hook names and payloads.
-   `typed-hooks.ts` — Zero-cost typed wrapper around this engine.
-   `useHookEffect` — Vue composable for lifecycle-aware subscriptions.
