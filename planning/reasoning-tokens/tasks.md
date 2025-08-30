# tasks.md

artifact_id: 5f9a4278-1c4b-4f4f-8d2a-9ac5b602e2cb

## Task List (3 Main Tasks)

### 1. Capture & Persist Reasoning (Req: R1, R3)

-   [ ] Add `extractReasoning` helper (or inline) in completion handling module (`utils/models-service.ts` or wherever responses mapped) to return `{ reasoning_content, reasoning_details }`.
-   [ ] Integrate during assistant message creation: merge into `data` if any field present (ensure `data` object exists).
-   [ ] Ensure reload path (messages fetch) does not strip `data` fields (verify only).
-   [ ] Unit tests for extraction edge cases.

### 2. UI Accordion in `ChatMessage.vue` (Req: R2, R3, NFR2, NFR4)

-   [ ] Compute `reasoningContent` from `props.message.data`.
-   [ ] Add toggle state + button with aria attributes.
-   [ ] Render reasoning block (collapsed by default) above existing message content for assistant only.
-   [ ] Add minimal retro CSS styles (reuse fonts, colors) + max-height 300px scroll.
-   [ ] Component test: shows/hides reasoning; absent when no content.

### 3. Polish & Verification (All NFRs)

-   [ ] Manual test with reasoning-capable model (simulate JSON if needed) ensuring persistence after refresh.
-   [ ] Lint/typecheck build passes.
-   [ ] Document usage briefly in `docs/` (optional short note) or skip to stay minimal.
-   [ ] Confirm no bundle bloat / no new deps.

## Completion Criteria

All acceptance criteria in requirements satisfied; reasoning displays and persists; tests pass.
