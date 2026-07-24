# Document AI Agent

The Document AI agent turns a prompt into a bounded, reviewable TipTap edit proposal. Its composer supports saved and plugin-contributed `/` prompt commands, file attachments, and `@` references to another document or chat.

## Composer commands

- Type `/` at the start of an empty prompt to search saved and plugin Document AI actions.
- Selecting an action inserts its prompt without sending it. Edit context is resolved automatically rather than stored with the action.
- Type `@` to search workspace documents and chats. The current document is excluded.
- Selected references render as inline mention nodes and removable context chips. Removing a chip removes the corresponding inline mention nodes.

Mention search respects the existing mentions feature flags and uses the shared Orama index. A workspace-scoped Dexie title search is used if the index cannot return results.

## Submission contract

The composer submits a `DocumentAiSubmission` object:

```ts
interface DocumentAiSubmission {
    prompt: string;
    // Kept in the transport contract for compatibility. Runtime resolution
    // uses selection when present and document otherwise.
    scope: 'selection' | 'section' | 'document';
    attachments: DocumentAiAttachment[];
    references: Array<{
        id: string;
        source: 'document' | 'chat';
        label: string;
    }>;
}
```

References are deduplicated by `source:id`, resolved from the active workspace database, and refreshed immediately before sending. Missing or deleted references stop submission with an actionable error.

## Model context and safety

The model request separates three inputs and automatically records the live
editor anchor:

1. The user request.
2. Frozen current-document context, including the cursor block and any selected
   text.
3. XML-escaped, read-only reference context.

When text is selected, that selection is the only writable target and the agent
must use a single `replace_selection` operation. The rest of the document stays
readable through outline, chunk, read, and search tools so the edit is informed
by surrounding context.

Without a selection, the document is writable and the cursor block is the
default target unless the request clearly asks for a broader change. Small
documents are included once in the initial seed. Large documents include a
bounded cursor-local window plus a compact outline/chunk map; the agent reads
other chunks only when needed. This keeps prompt size bounded without losing
document awareness.

Reference content contributes to token estimation and model context-limit validation. It never contributes editable block references. Returned operations continue to be validated against the frozen current-document snapshot before a proposal is shown.

## Hooks

`ai.document.edit:filter:request` and `ai.document.edit:action:before` receive `DocumentAiEditRequestPayload`. In addition to the existing prompt, scope, and editable `context`, the payload includes:

```ts
references: Array<{ id: string; source: 'document' | 'chat'; label: string }>;
referenceContext: string;
```

`referenceContext` is the resolved, XML-escaped read-only context supplied to the model. Filters must preserve the distinction between `context` (editable current-document blocks) and `referenceContext` (evidence only).

## Failure behavior

- A reference to the current document is rejected.
- Missing or deleted context must be removed or selected again.
- If the prompt, editable content, references, and response allowance exceed the selected model context window, the request is rejected before streaming.
- Disabled mention sources do not appear in search results.
