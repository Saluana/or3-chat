# implementation-guide.md

artifact_id: 1d84d57c-7725-4a4d-b72b-7c233c19d0dd

This guide is for the *hard / high-risk* tasks in [tasks.md](tasks.md). It is intentionally practical: step-by-step sequencing, checklists, and “how not to break things”.

Non-goal: cover the straightforward “add JSDoc header” tasks—those can be done inline with the checklist.

---

## Guide A — `useAi` refactor (non-breaking facade)

Applies to: Tasks 6.1–6.3 in [tasks.md](tasks.md).

### A0. Goal and invariants

Goal: Reduce `app/composables/chat/useAi.ts` (3k+ lines) into smaller internal modules **without changing runtime behavior** and **without breaking imports**.

Hard invariants:

- The public import path stays the same: `~/composables/chat/useAi`.
- `useAi()` return shape and behavior stay the same.
- Any exported types that are used elsewhere remain exported from the facade.
- No new required dependencies.
- SSR/static safety stays intact (don’t introduce server-only imports in client code).

### A1. Preparation: lock down the public surface

1) Inventory exports and usage.

- Search for imports of `useAi` and named exports from that file.
- Search for string path imports (some repos import via `#imports` aliases).

2) Create a “public surface snapshot” list in your PR notes.

- Exported functions
- Exported types
- Any constants that appear imported elsewhere

3) Run tests once before refactor to ensure you can detect regressions:

- `bun run test`

### A2. Choose the extraction shape (internal modules)

Create a private folder adjacent to `useAi.ts`:

- `app/composables/chat/useAi/`

Recommended internal modules (keep them boring and responsibility-focused):

- `app/composables/chat/useAi/types.ts`
  - Types/interfaces currently defined in `useAi.ts` that are internal-only.
  - If a type is imported by other files today, re-export it from the facade.

- `app/composables/chat/useAi/backgroundJobs.ts`
  - Background job tracker map, polling, subscribe/unsubscribe.
  - Should expose pure-ish functions that accept dependencies.

- `app/composables/chat/useAi/streaming.ts`
  - Stream loop glue (openRouterStream integration, accumulator wiring).

- `app/composables/chat/useAi/tools.ts`
  - Tool registry calls and tool execution glue.

- `app/composables/chat/useAi/persistence.ts`
  - Dexie mutations (create/upsert/tx), file hash merging, message writes.

- `app/composables/chat/useAi/hooks.ts`
  - Hook emission wrappers (typed keys, payload building), so main orchestration reads clean.

### A3. The “extract without changing behavior” method

This is the safest sequence; do it in small steps.

#### Step 1 — Extract types first

- Move type aliases/interfaces that are *not exported* to `useAi/types.ts`.
- Leave exported types where they are initially (or re-export them explicitly from `useAi.ts`).

Rule: don’t rename types yet; just relocate.

#### Step 2 — Extract a *pure* helper cluster

Pick one cluster with minimal coupling. Good candidates:

- “background job tracker” utilities (they mostly operate on the tracker map)
- “message persistence” helpers (they mostly operate on DB records)

Mechanics:

- In `useAi.ts`, keep the original function signature.
- Move the body into the new module.
- Have `useAi.ts` call the extracted function.

Example pattern:

```ts
// useAi.ts (facade)
import { persistAssistantMessage } from './useAi/persistence';

// ... inside send flow
await persistAssistantMessage({ db, message, threadId, /* ... */ });
```

Make extracted functions receive dependencies as arguments rather than importing everything internally. This reduces cyclic imports and keeps SSR boundaries explicit.

#### Step 3 — Extract streaming loop next

The streaming logic is usually the most regression-prone.

Guidelines:

- Keep the abort/cancel contract identical.
- Do not change chunk handling order.
- Preserve hook emission timing (see docs/core-hook-map.md).
- Preserve error reporting via `reportError` and abort suppression rules.

Recommended signature:

- `runForegroundStream({ openRouterStream, accumulator, hooks, ... })`
- `runBackgroundStream({ startBackgroundStream, subscribeBackgroundJobStream, ... })`

Return a structured result (rather than throwing), to match existing behavior.

#### Step 4 — Extract tool execution glue

Tools often have subtle coupling (message persistence, UI message shaping). Keep the glue, not the policy:

- Extract “call tool” helpers.
- Keep overall orchestration decisions (when to call tools, how to interleave tool messages) in the facade until the end.

#### Step 5 — Only then clean up `useAi.ts`

After 2–4 extraction passes, reduce `useAi.ts` to:

- Module header + exported public API
- Dependency wiring
- High-level orchestration steps
- Re-exports for compatibility

Do *not* do large renames in the same PR; that increases break risk.

### A4. Anti-regression checklist (run after each extraction)

After each extracted module:

- `bun run test` (or at minimum, the relevant unit tests if there are specific ones)
- Ensure no new circular dependency warnings (watch dev console output)
- Ensure no server-only imports leaked into client modules

### A5. How to validate “no breaking changes”

- Build-time: TypeScript compile and tests.
- Runtime sanity:
  - Send a message
  - Cancel mid-stream
  - Retry
  - Trigger a tool call (if available)
  - If background streaming is enabled, trigger a background job and confirm it still updates

### A6. Doc requirements for extracted modules

Each internal module needs an `@module` header, but keep it short:

- Purpose
- Responsibilities
- Non-responsibilities
- Notes on dependencies and error behavior

The public-facing docs remain on `useAi.ts`.

---

## Guide B — Mentions module typing + Orama constraints

Applies to: Tasks 2.3–2.4 in [tasks.md](tasks.md).

### B1. What makes this “hard”

- Orama’s hit typing can be loose depending on version and options.
- Dexie rows are app-defined; you only need a minimal slice.
- `collectMentions()` walks editor JSON that is not strongly typed.

### B2. Safe typing approach (minimal interfaces)

Use minimal interfaces for:

- Doc posts: `id`, `postType`, `title`, `deleted`, `content`
- Threads: `id`, `title`, `deleted`
- Messages: `thread_id`, `index`, `role`, `data.content`
- Mention nodes: `type`, `attrs`, `content`

Avoid pulling in huge schema types unless they exist and are stable.

### B3. Orama identity foot-gun (document and enforce)

The module already comments:

- “Do not include `id` in the schema to avoid clashes with Orama’s identity field.”

Implementation guidance:

- Keep the schema exactly as `title/source/snippet`.
- Keep your record type `IndexRecord` with `id`, but treat it as metadata used by Orama identity, not a stored/indexed field.
- Document the nuance in the module header.

### B4. Error reporting without changing caller behavior

Replace `console.*` with `reportError` but keep:

- `searchMentions()` returning `[]` on failure
- `resolveMention()` returning `null` on failure

Use tags:

- `domain:'chat'`, `feature:'mentions'`, `stage:'init'|'search'|'resolve'|'index'`

---

## Guide C — Workflow stream accumulator doc pass

Applies to: Task 3.1 in [tasks.md](tasks.md).

### C1. What the docs must explain (minimum viable)

In the `@module` header, add sections that answer:

- What events are ingested (workflow engine events, tool call events, HITL events)
- What state is produced and how it is consumed by the UI
- How subflow scoping works (`sf:` prefix + `|` separator)
- How branch keys are formed
- Ordering and “current node” semantics
- Performance characteristics (event rate expectations)
- Error handling contract (what sets `error`, what sets `failedNodeId`)

### C2. Keep code unchanged

This task is documentation-only unless you discover an actual bug. Avoid refactors here.

---

## Guide D — How to handle the `UnifiedStreamingState` alias safely

Applies to: Tasks 4.1–4.3 in [tasks.md](tasks.md).

Observation:

- The doc site already documents `UnifiedStreamingState` as a legacy migration alias.

Implementation guidance:

1) Treat it as public API (for now).
2) If you still want to remove it later:
   - Add `@deprecated` JSDoc first and update docs to point to `StreamingState`.
   - Only remove after a deprecation window.

This avoids breaking any downstream plugin code.
