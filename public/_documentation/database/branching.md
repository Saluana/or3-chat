# Branch conversations

Utilities for forking threads, retry-branching assistant replies, and building canonical conversation contexts across Dexie tables.

The chat's **Branch conversation** action opens the saved child in a workspace tab and keeps the source tab available. Navigation checks the originating workspace generation and thread so a completed branch cannot redirect a different conversation after a workspace switch.

---

## What does it do?

-   Provides transactional `forkThread`, a delegating `retryBranch`, and a read-based `buildContext`.
-   Normalizes branch modes (`reference` vs `copy`) and message roles for consistent downstream handling.
-   Clones ancestor messages when in copy mode and keeps indexes dense.
-   Merges ancestor + local messages for context building while respecting hook-driven filtering.

---

## Key types

| Type                             | Description                                                                 |
| -------------------------------- | --------------------------------------------------------------------------- |
| `ForkMode`                       | `Exclude<BranchMode, 'compacted'>`: `'reference'` or `'copy'`.                   |
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
-   `branch.context:action:after` reports the merged context counts after building.

---

## Implementation notes

1. **Transactions** — `forkThread` runs inside a Dexie transaction touching `threads` and `messages` to avoid race conditions; `buildContext` resolves recursive canonical history and is not a write transaction.
2. **Indexing** — Copied messages normalize indexes starting at `0` to keep order stable in fresh forks.
3. **Role normalization** — Canonical `user`, `assistant`, `system` and `tool` roles are preserved; unknown legacy roles normalize to `user`.
4. **Perf** — `buildContext` follows reference ancestors through canonical anchor boundaries. A compacted boundary contributes its saved summary and local messages, without rehydrating raw ancestors. Missing or cyclic lineage fails explicitly.

---

## Usage tips

-   Use `mode: 'copy'` when you need historical messages physically duplicated for offline tweaks; otherwise the cheaper reference mode keeps storage down.
-   Customize `branch.fork:filter:options` to auto-name forks (e.g., prepend emoji or include anchor timestamp).
-   Import these anchor-aware helpers from `~/db/branching`. The same-named `forkThread` in `~/db/threads` is a different metadata/optional-copy API.

Compacted forks use the validated atomic compaction writer; neither public fork helper accepts `compacted` as an ordinary mode. The writer preserves the source and commits the child, summary, captured history recipe and lineage together after rechecking the captured source. See [manual context compaction](/documentation/utils/manual-context-compaction) for retrieval and navigation across that boundary.
