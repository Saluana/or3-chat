artifact_id: 2d9e2b1a-9e55-4bdf-9a62-02e5bde4a225
content_type: text/markdown

# design.md

> **⚠️ SUPERSEDED:** This design has been simplified. See `design-simplified.md` and `SUMMARY.md` for the streamlined single-file approach (~250 lines vs. original ~600+ lines).

## Overview (Original - Not Implemented)

Mentions in ChatInputDropper is a client-only Nuxt plugin that adds @-mentions for documents and chat threads inside the chat editor. It integrates a TipTap mention extension for autocomplete, a local Orama index for low-latency search, and a send-time context resolver wired into the chat pipeline via hooks.

Integration points:

-   Editor: TipTap v2 extension to detect `@`, present a grouped dropdown, and insert non-editable mention nodes.
-   Search: Orama index holding document and chat metadata, updated from local DB hooks.
-   Send flow: Hook `ai.chat.messages:filter:input` to resolve mention nodes to full text and inject context.

This is built as an optional plugin: a root registration file in `app/plugins/mentions.client.ts` loads logic from `app/plugins/Mentions/*`.

## Architecture

### High-level flow

```mermaid
flowchart TD
    A[User types @ in TipTap] --> B[MentionExtension triggers search]
    B --> C{Orama index ready?}
    C -- yes --> D[Query docs & chats (fuzzy)]
    C -- no --> E[Empty results]
    D --> F[Grouped autocomplete dropdown]
    F --> G[User selects result]
    G --> H[Insert mention node {id, source, label}]
    H --> I[User clicks Send]
    I --> J[Hook: ai.chat.messages:filter:input]
    J --> K[Traverse TipTap JSON -> collect mentions]
    K --> L{Resolve per mention}
    L -- document --> M[db.documents.get(id) -> text]
    L -- chat --> N[db.messages.byThread(id) -> transcript]
    M --> O[Apply truncation/summarize]
    N --> O[Apply truncation/summarize]
    O --> P[Inject context messages with headers]
    P --> Q[Continue normal send]
```

### Components

1. Nuxt Plugin Entrypoint (`mentions.client.ts`)

-   Registers the TipTap extension factory and the send-time resolver hook.
-   Boots Orama index and wires DB hooks for index maintenance.
-   Handles HMR dispose to unregister.

2. OramaIndex (`app/plugins/Mentions/OramaIndex.ts`)

-   Creates Orama databases for documents and chats.
-   API:
    -   `init(): Promise<void>`
    -   `search(query: string): Promise<{ docs: OramaResult[]; chats: OramaResult[] }>`
    -   `upsertDocument({ id, title, tags? })`
    -   `removeDocument(id)`
    -   `upsertThread({ id, title, snippet? })`
    -   `removeThread(id)`
-   Implementation detail: lightweight fuzzy via Orama’s tolerance; result cap per group.

3. TipTap Mention Extension (off‑the‑shelf) (`app/plugins/Mentions/TipTapMentionExtension.ts`)

-   Use the official `@tiptap/extension-mention` with `@tiptap/suggestion` for the dropdown UI hooks (no custom ProseMirror plugin).
-   Configure `Mention.configure({ suggestion: { char: '@', items: async ({ query }) => { /* Orama search */ }, render, allowSpaces: false } })`.
-   Insert non-editable inline nodes with `attrs: { id, source: 'document'|'chat', label }` and style via `.mention` class and icon.
-   Implement grouped results (Documents/Chats) inside the `render` function using either a Nuxt UI floating panel (preferred) or a simple absolutely positioned panel;

4. Context Resolver (`app/plugins/Mentions/resolveMentions.ts`)

-   Traverses TipTap JSON to collect mention nodes.
-   Resolves each to text via DB APIs.
-   Builds context blocks with headers and truncation when needed.
-   Integrates with `ai.chat.messages:filter:input` to append messages.

5. Registration helpers (`app/plugins/Mentions/index.ts`)

-   `registerMentionAutocomplete(nuxtApp, { index })`
-   `registerMentionContextResolver(nuxtApp, { index, limits })`
-   `createOramaMentionIndex()`

### Dependencies

-   `@tiptap/extension-mention`
-   `@tiptap/suggestion`
-   `@orama/orama`

## Key Interfaces (TypeScript)

```ts
// Mention node attrs embedded in TipTap JSON
export type MentionSource = 'document' | 'chat';
export interface MentionNodeAttrs {
    id: string;
    source: MentionSource;
    label: string;
}

export interface OramaDocRecord {
    id: string;
    title: string;
    tags?: string[];
}
export interface OramaChatRecord {
    id: string;
    title: string;
    snippet?: string;
}

export interface OramaResult {
    id: string;
    title: string;
    score: number;
    subtitle?: string;
}

export interface MentionIndexApi {
    init(): Promise<void>;
    search(q: string): Promise<{ docs: OramaResult[]; chats: OramaResult[] }>;
    upsertDocument(doc: OramaDocRecord): Promise<void>;
    removeDocument(id: string): Promise<void>;
    upsertThread(thr: OramaChatRecord): Promise<void>;
    removeThread(id: string): Promise<void>;
}

export interface MentionResolverLimits {
    maxBytes: number; // default 50_000
    maxItemsPerGroup: number; // default 5
}

export interface ResolvedContextBlock {
    kind: 'document' | 'chat';
    id: string;
    label: string;
    truncated: boolean;
    text: string; // plain text payload
}

export interface ContextResolverApi {
    collectMentionsFromTipTapJSON(doc: any): MentionNodeAttrs[];
    resolveBlocks(
        mentions: MentionNodeAttrs[],
        limits: MentionResolverLimits
    ): Promise<ResolvedContextBlock[]>;
    injectIntoMessages(existing: any[], blocks: ResolvedContextBlock[]): any[];
}
```

## Orama schemas

```ts
// Pseudo-schema; actual @orama/orama calls to define DBs
const documentsSchema = { id: 'string', title: 'string', tags: 'string[]' };
const chatsSchema = { id: 'string', title: 'string', snippet: 'string' };
```

Index maintenance hooks (client):

-   `db.documents.create|upsert|delete:*` → upsert/remove document.
-   `db.threads.create|upsert|delete:*` → upsert/remove thread, and update `snippet` (first non-empty user message, if available).

## Message Injection Strategy

-   Hook: `ai.chat.messages:filter:input` receives an array of messages bound for the LLM.
-   Build additional messages prepended to the array for clarity, for example:

```ts
const header = (label: string, kind: 'doc' | 'chat') =>
    `(${kind === 'doc' ? 'Referenced Document' : 'Referenced Chat'}: ${label})`;

const injected = blocks.map((b) => ({
    id: `mention_${b.kind}_${b.id}`,
    role: 'system',
    data: {
        content: `${header(b.label, b.kind === 'document' ? 'doc' : 'chat')}
${b.text}`,
    },
}));

return [...injected, ...originalMessages];
```

Notes:

-   Using `role: 'system'` emphasizes context precedence while avoiding user content conflation.
-   If your app standardizes on a specific message shape, adapt to existing `{ role, content }` fields.

Implementation detail for items() with Orama:

```ts
Mention.configure({
    suggestion: {
        char: '@',
        items: async ({ query }) => {
            const { docs, chats } = await index.search(query);
            const map = (r: OramaResult, source: 'document' | 'chat') => ({
                id: r.id,
                source,
                label: r.title,
                subtitle: r.subtitle,
            });
            return [
                ...docs
                    .slice(0, limits.maxItemsPerGroup)
                    .map((r) => map(r, 'document')),
                ...chats
                    .slice(0, limits.maxItemsPerGroup)
                    .map((r) => map(r, 'chat')),
            ];
        },
        render: suggestionRendererGrouped, // uses clientRect() + floating panel with Nuxt UI styles
    },
    renderText({ options, node }) {
        return `${options.suggestion.char}${node.attrs.label ?? node.attrs.id}`;
    },
});
```

## Document and Chat Resolution

Document resolution:

-   `db.documents.get(id)` returns a rich document object; convert TipTap JSON to plain text if needed or store a derived plain-text cache on save.

Chat resolution:

-   Use `db.messages.byThread(id)` (or equivalent in `app/db/messages.ts`) to fetch ordered messages and reduce to a text transcript with roles and timestamps if desired.

Truncation:

-   Limit to `limits.maxBytes` by UTF-8 byte length. Add suffix `\n...[truncated]` and set `truncated=true`.

## Error Handling

Pattern: non-fatal, best-effort.

-   Resolution failures: skip offending block, optionally append a short warning system message: `(Warning: failed to resolve mention <label>)`.
-   Index failures: log in dev; show empty results. Never block typing.
-   Hook errors: wrap in try/catch; continue original messages unchanged on failure.

Service-style helper result (optional):

```ts
type ServiceResult<T> = { ok: true; value: T } | { ok: false; error: Error };
```

## Testing Strategy

-   Unit tests

    -   Mention JSON traversal: multiple mentions, duplicates, ordering, nested nodes.
    -   Truncation by bytes; Unicode edge cases.
    -   Orama index: insert, update, delete, and fuzzy search ranking.

-   Integration tests

    -   Hook `ai.chat.messages:filter:input`: given TipTap JSON with mentions, verify injected system messages and dedupe.
    -   DB hook-driven index updates: simulate create/update/delete events and assert index contents.

-   E2E

    -   Type `@`, search, select, send, ensure assistant sees injected context.

-   Performance
    -   Benchmark search latency with 5k items; ensure p95 < 50ms on a local machine.

## Security, Privacy, and Performance Notes

-   Local-only: no network calls for search or resolution.
-   Memory footprint kept modest via minimal fields and result caps.
-   Client-only plugin avoids SSR complexities with TipTap.

## File Layout

-   `app/plugins/mentions.client.ts` — Root Nuxt plugin registration.
-   `app/plugins/Mentions/index.ts` — Registration helpers.
-   `app/plugins/Mentions/TipTapMentionExtension.ts` — Editor extension.
-   `app/plugins/Mentions/OramaIndex.ts` — Local search index.
-   `app/plugins/Mentions/resolveMentions.ts` — Mention traversal, resolution, injection.
