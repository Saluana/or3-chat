artifact_id: 0a9a3c8b-fc3e-4a69-8e18-40d6a0ee35b3
content_type: text/markdown

# tasks.md

## 0. Preconditions

-   Scope: Optional client-only plugin; no core code changes required.
-   Target hooks: `ai.chat.messages:filter:input`, DB hooks for `documents` and `threads`.
-   Dependencies: `@orama/orama`, TipTap v2, `@tiptap/extension-mention`, `@tiptap/suggestion`, `tippy.js`.

-   [ ] 0.1 Add dependencies to the project and lockfile.
    -   `bun add @tiptap/extension-mention @tiptap/suggestion tippy.js @orama/orama`
    -   Requirements: 1.1, 3.1

## 1. Create plugin scaffolding

-   [ ] 1.1 Create root plugin `app/plugins/mentions.client.ts` that:

    -   Initializes Orama index on `app.init:action:after`.
    -   Registers TipTap extension and resolver hook.
    -   Handles HMR dispose to unregister.
    -   Requirements: 5.1, 5.2, 5.3

-   [ ] 1.2 Add module files under `app/plugins/Mentions/`:
    -   `index.ts` with registration helpers.
    -   `OramaIndex.ts` for search index.
    -   `TipTapMentionExtension.ts` for editor behavior.
    -   `resolveMentions.ts` for send-time injection.
    -   Requirements: 5.1, 3.1

## 2. Implement Orama index

-   [ ] 2.1 Implement `createOramaMentionIndex()` with schemas for docs and chats.

    -   Requirements: 3.1, 3.2

-   [ ] 2.2 Implement search API with fuzzy matching and result caps (per group 5; configurable).

    -   Requirements: 1.2, 6.3, 8.1

-   [ ] 2.3 Wire DB hooks to keep the index fresh:
    -   Subscribe to `db.documents.create|upsert|delete:*` to upsert/remove.
    -   Subscribe to `db.threads.create|upsert|delete:*` to upsert/remove threads and maintain a `snippet` (first user message or title fallback).
    -   Requirements: 3.3, 3.4

## 3. TipTap mention extension (official)

-   [ ] 3.1 Configure `@tiptap/extension-mention` with `@tiptap/suggestion` and `tippy.js` to detect `@` and show a grouped dropdown.

    -   Requirements: 1.1, 1.3, 6.2, 6.3

-   [ ] 3.2 Ensure inserted nodes have attrs `{ id, source, label }`; ensure proper spacing and deletion semantics; enable `deleteTriggerWithBackspace` as needed.

    -   Requirements: 1.4, 1.5, 2.1, 2.2

-   [ ] 3.3 Plaintext/Markdown export renders label form (e.g., `@ProjectPlan.docx`).
    -   Requirements: 2.3

## 4. Context resolver and injection

-   [ ] 4.1 Implement `collectMentionsFromTipTapJSON(doc)` to find mention nodes in-order with dedupe.

    -   Requirements: 4.1, 4.6

-   [ ] 4.2 Implement document resolution: `db.documents.get(id)` and TipTap JSON to plaintext conversion or cached plaintext field.

    -   Requirements: 4.2

-   [ ] 4.3 Implement chat resolution: `db.messages.byThread(id)` to transcript string (role:message lines).

    -   Requirements: 4.3

-   [ ] 4.4 Truncation by bytes (UTF-8) with suffix and header note; limits configurable.

    -   Requirements: 4.5, 8.1

-   [ ] 4.5 Hook into `ai.chat.messages:filter:input` to prepend context messages with headers and return transformed array.

    -   Requirements: 4.4, 5.3

-   [ ] 4.6 Handle resolution failures with warnings in injected context; never block send.
    -   Requirements: 4.7, 7.4

## 5. Styling and UX polish

-   [ ] 5.1 `.mention` styles with subtle background, icon, and hover delete button; ARIA labels for tokens and listbox.

    -   Requirements: 6.1, 6.2

-   [ ] 5.2 Keyboard nav: ESC to close, Enter to commit; ensure focus management and backspace behavior.
    -   Requirements: 1.5, 6.2

## 6. Config and feature flag

-   [ ] 6.1 Provide minimal config (debounce, max results per group, truncation size) with sensible defaults.

    -   Requirements: 8.1

-   [ ] 6.2 Global enable/disable flag; if disabled, skip registering extension and hooks.
    -   Requirements: 8.2

## 7. Tests

-   [ ] 7.1 Unit tests: mention traversal, dedupe, ordering; truncation; Orama search ranking.

    -   Requirements: 2.x, 3.x, 4.6, 4.5

-   [ ] 7.2 Integration tests: hook transforms `ai.chat.messages:filter:input` given a sample TipTap JSON with mentions.

    -   Requirements: 4.4, 5.3, 7.4

-   [ ] 7.3 Performance checks: search latency p95 < 50ms on 5k items; resolution overhead p95 < 120ms for small contexts.
    -   Requirements: 7.1, 7.3

## 8. Documentation and examples

-   [ ] 8.1 Add a short README in `app/plugins/Mentions/` describing setup and configuration.
-   [ ] 8.2 Add a minimal example under `app/plugins/examples/` to showcase the mention token and dropdown (optional).

## 9. Registration and cleanup

-   [ ] 9.1 Ensure root file `app/plugins/mentions.client.ts` exists and exports a default Nuxt plugin that registers/unregisters all parts.
-   [ ] 9.2 Verify HMR cleanup via `import.meta.hot.dispose`.

## 10. Acceptance validation

-   [ ] 10.1 Manual E2E: type `@`, select a doc/chat, send, verify injected system messages.
-   [ ] 10.2 Error paths: resolve missing IDs, large content truncation, Orama not ready behavior.
-   [ ] 10.3 Accessibility pass on dropdown and token.

---

Implementation notes:

-   Map to hooks in `docs/core-hook-map.md`; avoid core mutations.
-   Keep all logic in `app/plugins/Mentions/*` with a small root registrar file to satisfy Nuxt plugin discovery.
-   Prefer simplicity: truncate large content instead of summarizing for v1.
