artifact_id: 0a9a3c8b-fc3e-4a69-8e18-40d6a0ee35b3
content_type: text/markdown

# tasks.md

## 0. Preconditions

-   Scope: Optional client-only plugin; no core code changes required.
-   Target hooks: `ai.chat.messages:filter:input`, DB hooks for `documents` and `threads`.
-   Dependencies: `@orama/orama`, TipTap v2, `@tiptap/extension-mention`, `@tiptap/suggestion`.

-   [x] 0.1 Add dependencies to the project and lockfile.
    -   `bun add @tiptap/extension-mention @tiptap/suggestion @orama/orama`
    -   Requirements: 1.1, 3.1

## 1. Implement single-file plugin

-   [x] 1.1 Create `app/plugins/mentions.client.ts` with all functionality inline (~250 lines total):

    -   Config constants (debounce, limits)
    -   Orama index setup using `app/core/search/orama.ts` helpers
    -   Inline suggestion renderer (floating panel + grouped list)
    -   Mention extension config with `@tiptap/extension-mention`
    -   Context resolver: collect mentions, resolve via DB, inject via `ai.chat.messages:filter:input`
    -   DB hooks for incremental index updates
    -   HMR cleanup
    -   Requirements: 1.x, 2.x, 3.x, 4.x, 5.x

-   [x] 1.2 Add minimal CSS for `.mention` token styles (~20 lines)
    -   Added `app/assets/css/mentions.css` and imported in main.css
    -   Requirements: 6.1

## 2. Index setup (inline in main file)

-   [ ] 2.1 Use `createDb()` from `app/core/search/orama.ts` with unified schema: `{ id, title, source, snippet }`.

    -   Requirements: 3.1, 3.2

-   [ ] 2.2 On init, bulk load all documents and threads; map to unified records and `buildIndex()`.

    -   Requirements: 3.1, 3.2

-   [ ] 2.3 Wire DB hooks for incremental updates: upsert on create/update, remove on delete.
    -   Requirements: 3.3

## 3. Mention extension and renderer (inline)

-   [ ] 3.1 Configure `Mention.configure()` with `items` callback using `searchWithIndex()` and inline `render` function.

    -   Requirements: 1.1, 1.2, 1.3, 1.6

-   [ ] 3.2 Inline renderer: floating panel positioned via `clientRect()`, grouped list with Nuxt UI classes, keyboard nav.

    -   Requirements: 1.3, 6.2, 6.3

-   [ ] 3.3 Set `renderText` to output `@${label}` for plain text export.

    -   Requirements: 2.3

-   [ ] 3.4 Ensure mention node attrs `{ id, source, label }` and `deleteTriggerWithBackspace`.
    -   Requirements: 1.4, 1.5, 2.1, 2.2

## 4. Context resolver and injection (inline)

-   [ ] 4.1 Implement `collectMentions()`: recursive walk of TipTap JSON to find mention nodes, dedupe by `${source}:${id}`.

    -   Requirements: 4.1, 4.6

-   [ ] 4.2 Implement document resolution: `db.documents.get(id)` → extract plain text from TipTap JSON content.

    -   Requirements: 4.2

-   [ ] 4.3 Implement thread resolution: `db.messages.byThread(id)` → format as transcript.

    -   Requirements: 4.3

-   [ ] 4.4 Implement `truncate()`: UTF-8 byte truncation with suffix and header note.

    -   Requirements: 4.5, 8.1

-   [ ] 4.5 Hook `ai.chat.messages:filter:input`: collect, resolve, truncate, prepend system messages.

    -   Requirements: 4.4, 5.3

-   [ ] 4.6 Handle resolution failures: skip missing refs, log warning (non-blocking).
    -   Requirements: 4.7, 7.4

## 5. Styling and config

-   [ ] 5.1 Add `.mention` CSS with subtle background, icon, hover state; ARIA labels.

    -   Requirements: 6.1

-   [ ] 5.2 Verify keyboard nav and focus management (handled by Suggestion API).

    -   Requirements: 1.5, 6.2

-   [ ] 5.3 Expose config constants at top of file (debounce, max per group, truncation size).
    -   Requirements: 8.1

## 6. Tests (minimal)

-   [ ] 6.1 Unit test: `collectMentions()` with nested/duplicate nodes.

    -   Requirements: 2.x, 4.1, 4.6

-   [ ] 6.2 Unit test: `truncate()` by UTF-8 bytes with Unicode edge cases.

    -   Requirements: 4.5

-   [ ] 6.3 Integration test: hook transform `ai.chat.messages:filter:input` with sample TipTap JSON.

    -   Requirements: 4.4, 5.3, 7.4

-   [ ] 6.4 Manual E2E: type `@`, search, select, send, verify injected context.
    -   Requirements: all acceptance criteria

## 7. Documentation (optional)

-   [ ] 7.1 Add inline comments in `app/plugins/mentions.client.ts` describing each section.
-   [ ] 7.2 Optional: brief README in `planning/mentions/` if needed for future maintainers.

## 8. HMR and cleanup

-   [ ] 8.1 Implement `import.meta.hot.dispose()` to unregister hooks and destroy index.
    -   Requirements: 5.2

## 9. Acceptance validation

-   [ ] 9.1 Manual E2E: type `@`, select doc/chat, send, verify injected system messages in LLM request.
-   [ ] 9.2 Error paths: missing IDs, large content truncation, Orama not ready.
-   [ ] 9.3 Accessibility: screen reader labels, keyboard nav.

---

Implementation notes:

-   Single file keeps everything simple and auditable.
-   Reuse `app/core/search/orama.ts` → no new abstractions.
-   Unified index schema → simpler than separate docs/chats DBs.
-   Inline renderer → no separate Vue component file.
-   Target: ~250 lines total (vs. original ~600+ across multiple files).

---

TODO: Create a proper registry for the chatInput similar to how we do for the editor so that devs can develope plugins for the chatINPUT easily and have them lazy loaded and auto rendered.
