# design.md

artifact_id: 0f8e1ade-1c2a-4b8d-9e16-4e995bc7f0f2

## Overview

Introduce a canonical UI-facing message representation (`UiChatMessage`) to eliminate dual shapes (string vs array parts). Normalization occurs once at message creation (user send, assistant placeholder, retry). Raw legacy structures remain available through a non-reactive side channel for hooks until deprecated.

## Architecture & Flow

```mermaid
go flowchart TD
A[User Input] --> B[sendMessage()]
B --> C[normalize: ensureUiMessage]
C --> D[(reactive messages[]: UiChatMessage)]
B --> E[(rawMessages store)]
Streaming -->|token append| D
Retry --> B
Hooks --> E
UI Components --> D --> Render
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

Unit Tests:

-   partsToText: string input, array of strings, mixed objects, null entries, empty array, malformed objects.
-   ensureUiMessage: legacy variants, missing id/role, existing UiChatMessage passthrough.
    Integration Tests:
-   sendMessage flow populates `messages` with canonical shapes & raw store retains original structure.
-   streaming tokens append only to `.text`.
    Regression Test:
-   Retry path reuses canonical shape without additional mapping in UI components.

## Performance Considerations

-   Single pass concatenation in `partsToText` (O(n)).
-   Normalization done once per message (send + assistant placeholder), eliminating repeated render-time joins.

## Migration Notes

Phase 1 (current): Introduce canonical shape + compatibility layer.
Phase 2 (future): Remove legacy raw arrays + update plugins.

## Open Questions (Deferred)

-   Whether to lazily generate `reasoning_text` channel separately (handled in another refactor).

## Acceptance

Success metrics: Removal of mapping / defensive code lines (target 120–160 LOC), zero functional regressions in existing tests, added helper coverage 100%.
