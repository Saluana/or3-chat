# branching

Utilities for forking threads, retry-branching assistant replies, and building merged conversation contexts across Dexie tables.

---

## What does it do?

-   Provides `forkThread`, `retryBranch`, and `buildContext` helpers that run inside Dexie transactions.
-   Normalizes branch modes (`reference` vs `copy`) and message roles for consistent downstream handling.
-   Clones ancestor messages when in copy mode and keeps indexes dense.
-   Merges ancestor + local messages for context building while respecting hook-driven filtering.

---

## Key types

| Type                             | Description                                                                 |
| -------------------------------- | --------------------------------------------------------------------------- |
| `ForkMode`                       | Alias of `BranchMode` (either `'reference'` or `'copy'`).                   |
| `ForkThreadParams`               | Required `sourceThreadId`, `anchorMessageId`, optional mode/title override. |
| `RetryBranchParams`              | Assistant message to branch from plus optional mode/title.                  |
| `BranchForkBeforePayload`        | Hook payload describing source thread, anchor message, and options.         |
| `MessageEntity` / `ThreadEntity` | Lightweight shapes passed through the hook engine.                          |

---

## API surface

| Function       | Signature                                                                                   | Description                                                                           |
| -------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `forkThread`   | `({ sourceThreadId, anchorMessageId, mode, titleOverride }) => Promise<{ thread, anchor }>` | Forks a thread at a specific message, optionally copying ancestor messages.           |
| `retryBranch`  | `({ assistantMessageId, mode, titleOverride }) => Promise<{ thread, anchor }>`              | Finds the preceding user message and delegates to `forkThread`.                       |
| `buildContext` | `({ threadId }) => Promise<Message[]>`                                                      | Builds the playable context for a thread, stitching ancestors for reference branches. |

---

## Hook integration

-   `branch.fork:filter:options` to mutate incoming fork parameters.
-   `branch.fork:action:before/after` around thread creation.
-   `branch.retry:*` sequence around retry-based forks.
-   `branch.context:filter:messages` lets extensions rewrite the merged entity list before final merging.

---

## Implementation notes

1. **Transactions** — Forking and context building happen within Dexie transactions touching `threads` and `messages` tables to avoid race conditions.
2. **Indexing** — Copied messages normalize indexes starting at `0` to keep order stable in fresh forks.
3. **Role normalization** — Any non-assistant/system role becomes `user` so AI context stays predictable.
4. **Perf** — `buildContext` batches ancestor and local queries in parallel and dedupes via `Map` before merging.

---

## Usage tips

-   Use `mode: 'copy'` when you need historical messages physically duplicated for offline tweaks; otherwise the cheaper reference mode keeps storage down.
-   Customize `branch.fork:filter:options` to auto-name forks (e.g., prepend emoji or include anchor timestamp).
-   When building custom prompts, call `buildContext` to get the exact message list that the composer expects.
