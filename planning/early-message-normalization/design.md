# design.md

artifact_id: 0f8e1ade-1c2a-4b8d-9e16-4e995bc7f0f2

## Overview

Introduce a canonical UI-facing message representation (`UiChatMessage`) to eliminate dual shapes (string vs array parts). Normalization occurs once at message creation (user send, assistant placeholder, retry). Raw legacy structures remain available through a non-reactive side channel for hooks until deprecated.

This updated design prioritizes unifying file hash & image normalization utilities BEFORE message shape normalization so that `UiChatMessage.file_hashes` is populated from already-standardized arrays, preventing rework and eliminating scattered tolerant JSON parsing.

## Architecture & Flow

```mermaid
flowchart TD
    A[User Input] --> B[sendMessage()]
    subgraph PreNormalization
        H1[parseHashes / mergeAssistantFileHashes]
        H2[normalizeImagesParam]
    end
    B --> H1
    B --> H2
    H1 --> C[ensureUiMessage]
    H2 --> C
    C --> D[(messages[] UiChatMessage)]
    B --> E[(rawMessages store - non reactive)]
    Streaming -->|token append| D
    Retry --> B
    Hooks --> E
    UI --> D --> Render
```

## Data Shapes

```ts
export interface UiChatMessage {
    id: string;
    role: 'user' | 'assistant' | 'system';
    text: string; // always a flat string for UI rendering
    file_hashes?: string[]; // normalized array (empty array omitted)
    reasoning_text?: string; // optional separate reasoning channel (unchanged for now)
}

// Legacy inbound variants (examples):
// { id, role, content: 'plain string' }
// { id, role, content: [ 'part1', { type: 'text', text: 'part2' } ] }
// { id, role, content: [ { type: 'image', ... }, { type: 'text', text: 'desc' } ] }
```

## Helper Utilities

### File Hash & Image Utilities (New Priority Stage)

```ts
export interface NormalizedAttachment {
    kind: 'image';
    src: string; // data URL or remote URL
    hash?: string; // optional precomputed hash if available
    mime?: string; // e.g. image/png
}

export function parseHashes(raw: unknown): string[] {
    if (Array.isArray(raw)) return raw.filter((x) => typeof x === 'string');
    if (typeof raw === 'string') {
        // Try JSON first
        const trimmed = raw.trim();
        if (!trimmed) return [];
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed))
                return parsed.filter((x) => typeof x === 'string');
        } catch {}
        // Fallback: comma separated list
        if (trimmed.includes(','))
            return trimmed
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
        return [trimmed];
    }
    return [];
}

export function mergeAssistantFileHashes(
    prev: string[] | null | undefined,
    current: string[] | null | undefined
): string[] {
    const a = Array.isArray(prev) ? prev : [];
    const b = Array.isArray(current) ? current : [];
    if (b.length === 0) return a.slice();
    const set = new Set<string>();
    const out: string[] = [];
    for (const h of a) {
        if (typeof h === 'string' && !set.has(h)) {
            set.add(h);
            out.push(h);
        }
    }
    for (const h of b) {
        if (typeof h === 'string' && !set.has(h)) {
            set.add(h);
            out.push(h);
        }
    }
    return out;
}

export function normalizeImagesParam(images: any): NormalizedAttachment[] {
    if (!images) return [];
    const input = Array.isArray(images) ? images : [images];
    const out: NormalizedAttachment[] = [];
    for (const item of input) {
        if (!item) continue;
        if (typeof item === 'string') {
            out.push({ kind: 'image', src: item });
            continue;
        }
        if (typeof item === 'object') {
            const src =
                typeof item.url === 'string'
                    ? item.url
                    : typeof item.data === 'string'
                    ? item.data
                    : undefined;
            if (!src) continue;
            const mime = typeof item.mime === 'string' ? item.mime : undefined;
            const hash = typeof item.hash === 'string' ? item.hash : undefined;
            out.push({ kind: 'image', src, mime, hash });
        }
    }
    return out;
}
```

These utilities are pure, side-effect free, and reused by `ensureUiMessage` (for `file_hashes` extraction) and any send/assistant merge logic.

### Message Content Utilities

```ts
function partsToText(parts: any): string {
    if (typeof parts === 'string') return parts;
    if (!Array.isArray(parts)) return '';
    let out = '';
    for (const p of parts) {
        if (!p) continue;
        if (typeof p === 'string') {
            out += p;
            continue;
        }
        if (typeof p === 'object') {
            if (typeof p.text === 'string') out += p.text;
            else if (p.type === 'text' && typeof p.value === 'string')
                out += p.value; // tolerant
        }
    }
    return out;
}

function ensureUiMessage(raw: any): UiChatMessage {
    if (raw && (raw as UiChatMessage).text && !Array.isArray((raw as any).text))
        return raw as UiChatMessage;
    const id = raw.id ?? crypto.randomUUID();
    const role = raw.role ?? 'user';
    const file_hashes: string[] | undefined = Array.isArray(raw.file_hashes)
        ? raw.file_hashes.slice()
        : undefined;
    const reasoning_text: string | undefined =
        typeof raw.reasoning_text === 'string' ? raw.reasoning_text : undefined;
    const text =
        typeof raw.content === 'string'
            ? raw.content
            : partsToText(raw.content);
    return { id, role, text, file_hashes, reasoning_text };
}
```

All edge cases are tolerant: invalid shapes produce empty `text` but never throw.

## Storage Strategy

-   `messages` (reactive) : `UiChatMessage[]` – consumed by UI
-   `rawMessages` (non-reactive, e.g., `const rawMessages: any[] = []`) – appended in parallel for hooks
-   Accessor: `getRawMessages(): readonly any[]` returns a frozen shallow copy to discourage mutation.

## Integration Points

File Hash / Image Stage:

-   `useAi.ts`: Replace all ad-hoc JSON parse & merge logic with `parseHashes` + `mergeAssistantFileHashes`.
-   Assistant placeholder creation: pre-merge any carried forward `file_hashes` via helper before constructing the `UiChatMessage`.
-   Image parameter normalization: call `normalizeImagesParam` before payload build so downstream model selection / modality hints can rely on consistent attachment objects.

Message Shape Stage (after above complete):

-   `useAi.ts`: wrap user message creation, assistant placeholder, retry path with `ensureUiMessage`.
-   Streaming: when a token arrives, mutate `currentAssistant.text += delta`.
-   `ChatContainer.vue`: remove mapping; directly iterate `messages`.
-   `ChatMessage.vue`: delete array defensive code; assume `.text`.

## Backward Compatibility

-   Hooks referencing `content` arrays must switch later; until then they access `getRawMessages()`.
-   Provide deprecation console warning (dev only) when a hook reads a legacy `content` array message; optional feature flag to silence.

## Error Handling

-   Helpers never throw; they return minimal fallback.
-   If normalization yields empty text for a user send, log dev warning.

## Testing Strategy

Unit Tests (New for Hash/Image):

-   parseHashes: array pass-through, JSON string array, malformed JSON fallback, comma list, single hash, empty string, numeric noise ignored.
-   mergeAssistantFileHashes: no prev, no current, duplicates, order preservation, large set performance (e.g., 200 hashes) under threshold.
-   normalizeImagesParam: string URL, array mix, object url, object data, missing src skipped, hash+mime preserved.

Unit Tests:

-   partsToText: string input, array of strings, mixed objects, null entries, empty array, malformed objects.
-   ensureUiMessage: legacy variants, missing id/role, existing UiChatMessage passthrough.
    Integration Tests:
-   sendMessage flow populates `messages` with canonical shapes & raw store retains original structure.
-   streaming tokens append only to `.text`.
    Regression Test:
-   Retry path reuses canonical shape without additional mapping in UI components.

## Performance Considerations

Hash/Image utilities avoid repeated parsing per render by executing once at message preparation. `parseHashes` attempts JSON parsing only if input resembles JSON (`[` or `{` or contains commas) keeping cost low.

-   Single pass concatenation in `partsToText` (O(n)).
-   Normalization done once per message (send + assistant placeholder), eliminating repeated render-time joins.

## Migration Notes

Phase 0 (added): Introduce hash/image utilities; refactor all existing call sites to consume them (no UI changes yet).
Phase 1: Introduce canonical message shape + compatibility layer using already normalized `file_hashes`.
Phase 2: Remove legacy raw arrays + update plugins.

## Open Questions (Deferred)

-   Whether to lazily generate `reasoning_text` channel separately (handled in another refactor).

## Acceptance

Success metrics: Removal of mapping / defensive code lines (target 120–160 LOC), zero functional regressions in existing tests, added helper coverage 100%.
