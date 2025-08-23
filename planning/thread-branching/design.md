---
artifact_id: 0d9bf3f2-7206-4ca0-84a1-7a404ad45551
name: Conversation Branching Design
---

# Overview

We enable hierarchical branching of chat threads using existing Dexie schema (`threads.parent_thread_id`, `threads.forked`). Two fork modes: (1) **Full Copy Fork** (copy messages up to anchor) and (2) **Light Fork** (no copy; ancestor history rendered read-only & used only for model context). The design focuses on: atomic fork creation, efficient context assembly, lazy lineage traversal, UI affordances, and minimal schema churn.

# Architecture

```mermaid
flowchart TD
  U[User selects Branch from Message] --> M{Mode?}
  M -- Full Copy --> TX[Dexie Transaction]
  M -- Light Fork --> TX
  TX -->|Create new thread (forked=true,parent=source)| T[Fork Thread]
  M -- Full Copy --> C[Copy ancestor messages <= anchor]
  M -- Light Fork --> A[Persist anchor meta]
  C --> IDX[Normalize indexes if needed]
  A --> IDX
  IDX --> DONE[Emit hooks & return thread id]
  DONE --> UI[Open new thread view]
  UI --> CTX[Assemble AI Context]
  CTX --> AI[Send Prompt]

  subgraph Context Assembly
    P1[Local fork messages]\n(excluding ancestor copies) --> P2
    P0[If light fork: fetch ancestor messages up to anchor] --> P2[Merge + dedupe]
    P2 --> TKN[Truncate by token budget]
  end
```

# Components

-   BranchService (new module `app/db/branching.ts`): core creation, metadata parsing, context assembly.
-   Branch Explorer UI: tree navigation panel (new component group `app/components/threads/branching/*`).
-   Message Action Menu Extension: adds "Branch from here" and "Retry as Branch".
-   ContextAssembler: merges messages for AI invocation (hook-in to `useChat.sendMessage`).
-   Metadata Cache: in-memory Map<threadId, AnchorMeta> for light forks.

# Data Structures

```ts
export interface AnchorMeta {
    anchorMessageId: string; // message id in parent thread
    mode: 'light' | 'full';
    parentThreadId: string; // redundancy for quick checks
}

// Stored encoding strategy v1: prefix JSON + '|' + (user visible title)
// Example title in DB: '{"anchor":"m_123","mode":"light"}|Exploring alt'
```

Helper to parse:

```ts
const ANCHOR_PREFIX_RE = /^\{\"anchor\":/;
export function parseAnchorMeta(title?: string | null): {
    meta?: AnchorMeta;
    userTitle: string;
} {
    if (!title) return { userTitle: '' };
    if (!ANCHOR_PREFIX_RE.test(title)) return { userTitle: title };
    const pipe = title.indexOf('|');
    if (pipe === -1) return { userTitle: title };
    try {
        const meta = JSON.parse(title.slice(0, pipe));
        if (meta && meta.anchor && meta.mode) {
            return {
                meta: {
                    anchorMessageId: meta.anchor,
                    mode: meta.mode,
                    parentThreadId: meta.parent,
                },
                userTitle: title.slice(pipe + 1),
            };
        }
    } catch {}
    return { userTitle: title };
}
```

Caching layer:

```ts
const anchorCache = new Map<string, AnchorMeta>();
export function getAnchorMetaFast(thread: Thread): AnchorMeta | undefined {
    const cached = anchorCache.get(thread.id);
    if (cached) return cached;
    const { meta } = parseAnchorMeta(thread.title);
    if (meta) anchorCache.set(thread.id, meta);
    return meta;
}
```

# Fork Creation Algorithm

```ts
interface ForkOptions {
    anchorMessageId: string; // required
    mode: 'full' | 'light';
    titleOverride?: string;
    copyStrategy?: 'upto-anchor' | 'none'; // derived from mode; allowing future variations
}

async function createBranch(
    sourceThreadId: string,
    opts: ForkOptions
): Promise<Thread> {
    return db.transaction('rw', db.threads, db.messages, async () => {
        const src = await db.threads.get(sourceThreadId);
        if (!src) throw new Error('source thread missing');
        const anchor = await db.messages.get(opts.anchorMessageId);
        if (!anchor || anchor.thread_id !== sourceThreadId)
            throw new Error('anchor invalid');

        const now = nowSec();
        const forkId = newId();
        const baseTitle =
            opts.titleOverride ||
            src.title ||
            (anchor.data as any)?.content?.slice(0, 32) ||
            'Branch';

        const threadTitle =
            opts.mode === 'light'
                ? JSON.stringify({
                      anchor: anchor.id,
                      mode: 'light',
                      parent: src.id,
                  }) +
                  '|' +
                  baseTitle
                : baseTitle + ' • alt';

        const fork: Thread = {
            ...src,
            id: forkId,
            title: threadTitle,
            parent_thread_id: src.id,
            forked: true,
            created_at: now,
            updated_at: now,
            last_message_at: null,
        };
        await db.threads.put(fork);

        if (opts.mode === 'full') {
            const ancestors = await db.messages
                .where('thread_id')
                .equals(src.id)
                .filter((m) => m.index <= anchor.index)
                .sortBy('index');
            for (const m of ancestors) {
                await db.messages.put({ ...m, id: newId(), thread_id: forkId });
            }
            if (ancestors.length) {
                await db.threads.put({
                    ...fork,
                    last_message_at: now,
                    updated_at: now,
                });
            }
        }
        return fork;
    });
}
```

# Context Assembly

Add a hook inside `useChat.sendMessage` before streaming:

```ts
const contextualMessages = await hooks.applyFilters(
    'ai.context.branch:filter:messages',
    effectiveMessages,
    threadIdRef.value
);
```

Implementation of filter:

1. Determine if current thread is light fork (getAnchorMetaFast(thread)).
2. If not light, return messages unchanged.
3. If light: fetch ancestor messages up to anchor (ordered), merge with branch's own local messages (exclude duplicates by original id stored maybe in data.\_src_id for copies).
4. Token budget: estimate via simple heuristic (chars/4) vs `MAX_TOKENS_CONTEXT` constant (e.g., 8k). Drop earliest ancestor messages first until under budget.

# Branch Explorer Algorithm

1. Load root threads: `where('parent_thread_id').equals(null)` (need a null sentinel; ensure existing creation sets null).
2. For node expansion load children: `where('parent_thread_id').equals(thread.id).toArray()`.
3. Cache children arrays in reactive store to avoid duplicate queries.
4. Provide computed flattened view for virtualization if needed.

# UI Interactions

-   Message contextual menu gets new choices: Branch from here, Retry as Branch.
-   Branch creation modal: radio full vs light, title input, create button.
-   Branch indicator chip beside thread title if `forked` true.
-   Ancestor divider for light forks uses `getAnchorMetaFast` to decide.

# Error Handling

-   All branch operations run in Dexie transaction; if any put fails, rollback automatic.
-   Validation errors (missing anchor) throw and are caught to display toast.
-   Performance marks: `performance.mark('branch:start')`, `performance.mark('branch:end')`, measure via `performance.measure`.

# Hooks

-   `ui.thread.branch:action:before` (payload { sourceThreadId, anchorMessageId, mode })
-   `ui.thread.branch:action:after` (payload { forkThreadId })
-   `ai.context.branch:filter:messages` (see above)
-   `db.threads.fork:filter:options` (allows altering copy strategy)

# Testing Strategy

-   Script: create thread with 5 messages, branch full & verify copies count == anchor index subset.
-   Light fork: no copied messages, anchor meta parsing returns expected anchor.
-   Retry-as-branch: branch created and new assistant message appears only in fork.
-   Duplicate prevention: create same branch twice => second returns existing thread id.
-   Performance: measure time copying 200 synthetic messages; assert < 50ms.

# Performance Considerations

-   Avoid full project thread scan for Branch Explorer: only load children per node.
-   Cache anchor meta parse results.
-   Use sparse indexes already in place for message insertions after branching.
-   Virtualize long message lists (>300) combining ancestor + local.

# Security / Integrity

-   Never mutate original message objects; always shallow clone with new ids.
-   Light fork context assembly read-only; no writes to ancestor threads.

# Future Extensions

-   Dedicated `thread_meta` table to store anchor & mode instead of encoding into title.
-   Merge tool: consolidate branches.
-   Graph visualization (force directed or timeline view).
-   Remote sync conflict resolution using clock vector.

# Assumptions

-   Null stored as `parent_thread_id: null` for root threads (current code sets null).
-   Branch frequency moderate (< 500 branches per project); depth rarely > 10.
-   Token estimation heuristic sufficient (no exact tokenizer needed initially).
