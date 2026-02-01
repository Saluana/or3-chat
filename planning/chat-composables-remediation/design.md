# design.md

artifact_id: 8a174006-6cc8-4371-8af2-894e4c6d188d

## Overview

This design implements a **non-breaking remediation** for chat composables and the mentions indexing plugin:

- Add doc-maker compliant `@module` headers and JSDoc for public APIs.
- Improve type safety (remove `any` hotspots, especially in mentions).
- Make failures observable using the repo’s unified error API (`reportError`) while preserving existing return values (`[]`/`null`) to avoid breaking call sites.
- Split the “monster” useAi.ts into internal modules while keeping the public `useAi` export stable.

Key constraint: preserve existing import paths and public shapes (no breaking changes).

## Architecture

### High-level remediation flow

```mermaid
flowchart TD
  A[Inventory public APIs + usages] --> B[Add module headers + JSDoc]
  B --> C[Type-safety pass (mentions first)]
  C --> D[Error observability (reportError + hooks)]
  D --> E[Refactor useAi into internal modules]
  E --> F[Add/extend tests + run suite]
  F --> G[Align doc site pages + docmap]
```

### Documentation strategy (code + doc site)

- Code-level docs:
  - Each targeted TypeScript module begins with an `@module` block including:
    - Purpose
    - Responsibilities
    - Non-responsibilities
    - SSR notes (`import.meta.client`, dynamic imports, no server deps)
    - Performance notes (e.g., Orama index size, RAF batching)
    - Extension points and relevant hooks (see docs/core-hook-map.md)
    - Error contract (what is thrown vs returned)

- Doc-site alignment:
  - The doc site already has entries for many composables in public/_documentation/docmap.json.
  - As code-level docs become authoritative, the doc-site pages should be reviewed and updated to match.
  - If a doc page claims features not present, adjust the page rather than code.

### Error handling strategy (non-breaking)

The codebase has a unified error API (docs/error-handling.md). To avoid breaking callers:

- Preserve existing return conventions:
  - `searchMentions()` continues to return `MentionItem[]` and returns `[]` on failure.
  - `resolveMention()` continues to return `string | null` and returns `null` on failure.
  - Index update helpers remain best-effort.

- Add observability without altering behavior:
  - Replace `console.error` / `console.warn` with `reportError(err(...), { toast?: false })`.
  - Use tags to allow filtering and debugging:
    - `{ domain: 'chat', feature: 'mentions', stage: 'init'|'search'|'resolve'|'index' }`
    - include `threadId/docId` where available.

- Optional: add a lightweight internal hook emission (if patterns exist) but do not require callers.

### Type safety strategy (mentions)

Most `any` usage in mentions indexing falls into three buckets:

1) Dexie rows
2) Orama hit/search results
3) ProseMirror/Tiptap JSON nodes used in `collectMentions`

Design approach:

- Introduce minimal, local interfaces that reflect only the fields used:

```ts
export type DeletedFlag = boolean | 0 | 1 | undefined | null;

export interface DocPostRow {
  id: string;
  postType: 'doc' | string;
  title?: string | null;
  deleted?: DeletedFlag;
  content?: unknown;
}

export interface ThreadRow {
  id: string;
  title?: string | null;
  deleted?: DeletedFlag;
}

export interface MessageRow {
  thread_id: string;
  index: number;
  role: string;
  data?: { content?: unknown };
}

export interface MentionNode {
  type: string;
  attrs?: { id?: string; source?: 'document'|'chat'; label?: string };
  content?: MentionNode[];
}
```

- If better canonical types exist (e.g., exported from db schema/types), prefer importing them.
- Isolate Orama typing behind a narrow adapter:
  - `type OramaHit = { id?: string; score?: number; document?: Partial<IndexRecord> }`
  - No `any` in business logic.

### useAi refactor strategy (non-breaking facade)

We refactor by extracting internal modules while keeping the file path and the `useAi` export stable:

- Keep: app/composables/chat/useAi.ts
  - Becomes a facade that wires dependencies and re-exports `useAi`.
  - Keeps all existing exported types/exports.

- Add internal modules (examples):
  - app/composables/chat/useAi/streaming.ts
  - app/composables/chat/useAi/backgroundJobs.ts
  - app/composables/chat/useAi/tools.ts
  - app/composables/chat/useAi/persistence.ts
  - app/composables/chat/useAi/hooks.ts
  - app/composables/chat/useAi/types.ts

Key rule: internal modules are not imported directly by outside code.

If tests or callers import internal types from useAi.ts today:
- Re-export from facade to avoid breaking.

### Workflow accumulator documentation design

For app/composables/chat/useWorkflowStreamAccumulator.ts:

- Add an `@module` header describing:
  - Event inputs (engine events, tool calls, HITL)
  - State outputs (WorkflowStreamingState)
  - Key invariants:
    - Stable keys for branches and subflows
    - Ordering (`executionOrder` semantics)
    - Last-active node tracking
  - Performance:
    - Why state updates are batched or not
    - Constraints on frequent updates

### Cleanup / lifecycle documentation

For registry composables (e.g., useChatInputBridge):

- Document:
  - Who calls register/unregister
  - Pane lifecycle hooks that should call unregister
  - HMR behavior and how stale entries are prevented

Non-breaking enhancement option:
- Keep existing exports but add a `withRegistration()` helper that returns a disposer function.

### Handling “unused export” safely

For `export type { StreamingState as UnifiedStreamingState }`:

- First, search for usage across workspace.
- If unused:
  - Mark as `/** @deprecated Use StreamingState instead. */` for one cycle.
  - Remove only after deprecation window.
- If used:
  - Add explicit doc comment describing when to use it (e.g., cross-module compatibility alias).

## Interfaces / Contracts

### Mentions module public API (documented contract)

- `setMentionsConfig(opts)`
  - Pure config setter.
  - Non-goal: validate runtime config beyond basic guards.

- `initMentionsIndex()`
  - Best-effort, idempotent-ish.
  - Failure: reports error; index remains not-ready.

- `searchMentions(query)`
  - Returns `[]` if index not ready or errors.
  - Fair grouping per source.

- `collectMentions(doc)`
  - Pure extraction from editor JSON.

- `resolveMention(mention)`
  - Returns string context capped by MAX_CONTEXT_BYTES or `null`.

- Incremental updates (`upsertDocument`, `updateDocument`, `removeDocument`, etc.)
  - Best-effort; no throws to callers.

### Error reporting tags

Adopt a consistent tag set:

- `domain: 'chat'`
- `feature: 'mentions' | 'ai' | 'workflow'`
- `stage: 'init'|'search'|'resolve'|'index'|'persist'|'stream'`
- context ids: `docId`, `threadId`, `messageId`, `streamId`, `modelId`

## Testing strategy

### Unit tests

- Mentions:
  - `collectMentions()` dedupe behavior and parsing.
  - `truncateBytes()` boundary behavior (multi-byte UTF-8).
  - `searchMentions()` grouping logic (docs vs chats cap).

- Stream accumulator:
  - Ensure `finalize()` flushes pending deltas.
  - Deprecation alias presence (if kept) documented.

### Integration tests

- Mentions index init/search with stubbed Dexie rows.
- useAi facade integrity:
  - A minimal “send” path uses same hooks and error behavior.

### Non-goals

- No new E2E coverage is required unless a regression is found.

## Rollout / migration

- All refactors land behind stable export surfaces.
- Any behavior changes (like adding toasts) are avoided by default; use `toast:false` unless an existing UI expects it.
- Deprecations are documented and delayed.
