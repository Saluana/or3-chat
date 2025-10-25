# design-simplified.md

## Overview

Minimal mentions plugin (~250 lines total) that reuses existing infrastructure:

-   Shared `app/core/search/orama.ts` helpers for indexing (no new abstractions)
-   Direct DB API calls (no wrapper layer)
-   Inline suggestion renderer (no separate component file)
-   Single-file implementation in `app/plugins/mentions.client.ts`

## Architecture (Simplified)

### Single Plugin File: `app/plugins/mentions.client.ts` (~250 lines)

**Sections:**

1. **Config** (~10 lines)

```ts
const DEBOUNCE_MS = 275;
const MAX_PER_GROUP = 5;
const MAX_CONTEXT_BYTES = 50_000;
```

2. **Orama Index Setup** (~40 lines)

-   Reuse `createDb()`, `buildIndex()`, `searchWithIndex()` from `app/core/search/orama.ts`
-   Single unified schema: `{ id: 'string', title: 'string', source: 'string', snippet: 'string' }`
-   No separate docs/chats DBs—just tag with `source: 'document' | 'chat'`
-   On init: bulk load all docs + threads from Dexie
-   DB hooks for incremental updates (insert/update/remove in index)

3. **Suggestion Renderer** (~60 lines, inline)

-   Create/destroy floating panel on start/exit
-   Position via `clientRect()`
-   Render grouped list with Nuxt UI classes (no Vue component needed)
-   Keyboard nav handled by Suggestion API props

4. **Mention Extension Config** (~30 lines)

```ts
Mention.configure({
    suggestion: {
        char: '@',
        items: async ({ query }) => {
            const results = await searchWithIndex(db, query, 10);
            return results.hits.map((hit) => ({
                id: hit.document.id,
                source: hit.document.source,
                label: hit.document.title,
                subtitle: hit.document.snippet,
            }));
        },
        render: () => ({
            /* inline renderer */
        }),
    },
    renderText: ({ node }) => `@${node.attrs.label}`,
    HTMLAttributes: { class: 'mention' },
});
```

5. **Context Resolver Hook** (~80 lines)

-   Hook: `ai.chat.messages:filter:input`
-   Walk TipTap JSON to collect mentions (simple recursive descent, ~20 lines)
-   Dedupe by id (Set)
-   Resolve each:
    -   Document: `db.documents.get(id)` → `editor.getText()` or simple content traversal
    -   Thread: `db.messages.byThread(id)` → format transcript
-   Truncate to MAX_CONTEXT_BYTES (UTF-8 bytes, ~15 lines)
-   Prepend system messages with headers
-   Non-fatal error handling (skip missing refs, log warning)

6. **DB Hook Wiring** (~30 lines)

-   `db.documents.create|upsert:action:after` → upsert to index
-   `db.documents.delete:action:soft:after` → remove from index
-   `db.threads.create|upsert:action:after` → upsert to index (with snippet = first user message text or title)
-   `db.threads.delete:action:soft:after` → remove from index

7. **HMR Cleanup** (~10 lines)

```ts
if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        // unregister hooks, destroy index
    });
}
```

## Data Model (Unified)

Single Orama schema for both documents and threads:

```ts
{
    id: string; // doc id or thread id
    title: string; // doc title or thread title
    source: string; // 'document' | 'chat'
    snippet: string; // empty for docs, first user msg for chats
}
```

## Mention Node Attrs

```ts
{
    id: string;
    source: 'document' | 'chat';
    label: string;
}
```

## Context Injection Pattern

```ts
// In ai.chat.messages:filter:input hook
const mentions = collectMentions(editorJSON);
const unique = [...new Set(mentions.map((m) => `${m.source}:${m.id}`))];
const blocks = await Promise.all(
    unique.map(async (key) => {
        const [source, id] = key.split(':');
        try {
            if (source === 'document') {
                const doc = await db.documents.get(id);
                return {
                    label: doc.title,
                    text: extractText(doc.content),
                    truncated: false,
                };
            } else {
                const msgs = await db.messages.byThread(id);
                return {
                    label: msgs[0]?.title || 'Chat',
                    text: formatTranscript(msgs),
                    truncated: false,
                };
            }
        } catch {
            return null; // skip
        }
    })
);

const contextMsgs = blocks.filter(Boolean).map((b) => ({
    role: 'system',
    content: `(Referenced ${b.source === 'document' ? 'Document' : 'Chat'}: ${
        b.label
    })\n${truncate(b.text, MAX_CONTEXT_BYTES)}`,
}));

return [...contextMsgs, ...originalMessages];
```

## Testing Strategy (Minimal)

-   Unit test: `collectMentions()` with nested/duplicate nodes
-   Unit test: truncate by UTF-8 bytes
-   Integration: send with mentions, verify injected system messages
-   Manual E2E: type `@`, search, select, send

## Why This is Better

1. **Reuses existing Orama helpers** → no new abstractions, ~40 lines saved
2. **Single unified index** → simpler than two separate DBs, ~50 lines saved
3. **Inline renderer** → no Vue component file, ~80 lines saved
4. **No wrapper layer** → direct DB calls, ~100 lines saved
5. **Single file** → easier to understand, maintain, and test

**Total: ~250 lines vs. original ~600+ lines across 5 files**

## File Layout (Final)

```
app/plugins/mentions.client.ts  (~250 lines, complete implementation)
```

Optional:

```
app/assets/css/mentions.css  (~20 lines, .mention token styles)
```
