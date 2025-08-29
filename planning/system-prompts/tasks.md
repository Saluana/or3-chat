# tasks.md

artifact_id: 5a5db3ca-1d17-4b2d-9a7f-1c84f6c0e4e2

## 1. Prompt Persistence

-   [x] 1.1 Add `db/prompts.ts` implementing CRUD (createPrompt, getPrompt, listPrompts, updatePrompt, softDeletePrompt) mirroring `documents.ts` with `postType='prompt'` (Req: 2.1-2.5, 2.8)
-   [x] 1.2 Add hooks invocations with `db.prompts.*` namespaces (Req: 2.8)
-   [x] 1.3 Implement `promptJsonToString` util (Req: 2.3)
-   [x] ~~1.4 Basic unit tests for CRUD + util (Req: 2.8, 2.9)~~ (deleted per request)

## 2. Active Prompt State & Chat Integration

-   [x] 2.1 Create composable `useActivePrompt.ts` storing activePromptId/content (Req: 2.3, 2.6, 2.7)
-   [x] 2.2 Fire hook `chat.systemPrompt.select:action:after` inside `setActivePrompt` (Req: 2.8)
-   [x] 2.3 Integrate into `useChatSend` (prepend system message) using util conversion (Req: 2.3, 2.6)
-   [x] 2.4 Add clear function & call path (Req: 2.6)

## 3. UI Components

-   [x] 3.1 Create `SystemPromptsModal.vue` (list + actions + empty state) (Req: 2.1, 2.2, 2.5, 2.7)
    -   [x] 3.1.1 List view showing title, updated time, Select/Edit/Rename/Delete buttons (Req: 2.1, 2.3, 2.4, 2.5)
    -   [x] 3.1.2 Inline rename (input swap) (Req: 2.4)
    -   [x] 3.1.3 Create button triggers new prompt & enters edit mode (Req: 2.2)
    -   [x] 3.1.4 Delete confirmation (Req: 2.5)
    -   [x] 3.1.5 Active badge highlight (Req: 2.7)
    -   [x] 3.1.6 Clear Active Prompt button (Req: 2.6)
    -   [x] 3.1.7 Keyboard focus order validated (Req: 2.10)
-   [x] 3.2 Embed `DocumentEditor.vue` for editing selected prompt (swap list) (Req: 2.4)
-   [x] 3.3 Wire modal into `ChatInputDropper.vue` replacing placeholder UModal content (Req: 2.1)
-   [x] 3.4 Smoke test manual: create/edit/select/delete/clear (Req: All core)

## Mapping Summary

-   Requirements 2.1-2.5,2.6,2.7,2.8,2.9,2.10 covered by tasks above.

## Notes

Keep code small; avoid broad refactors. Copy patterns from documents implementation instead of abstracting shared code now.
