---
artifact_id: 8077e5ce-9e84-4c15-8124-a6fca42efe9b
title: tasks.md
status: draft
owner: or3-chat
date: 2026-02-19
---

# tasks.md

## 1. Scaffold plugin and feature modules
- [x] Create `app/plugins/tasks-pane.client.ts` and guard registration with `process.client`. (Requirements: 1.1, 11.1)
- [x] Add tasks module folders (`components`, `composables`, `tooling`, `utils`, `__tests__`). (Requirements: 1.1, 12.1)
- [x] Define and export shared task types (`TaskItem`, `TaskSubtask`, `TaskListMetaV1`, enums). (Requirements: 2.1, 3.1, 4.1)

## 2. Implement local-first task list persistence service
- [x] Implement `useTaskListService` with list load/create helpers around posts API. (Requirements: 2.1, 1.1)
- [x] Implement task CRUD (`addTask`, `updateTask`, `removeTask`) with timestamp/order maintenance. (Requirements: 3.1)
- [x] Implement subtask CRUD (`addSubtask`, `removeSubtask`). (Requirements: 4.1)
- [x] Implement atomic list meta write path and error-safe rollback behavior. (Requirements: 2.1, 5.1)

## 3. Implement reorder and reschedule domain logic
- [x] Add `reorderTasks(listId, orderedTaskIds)` with strict id validation and stable order normalization. (Requirements: 5.1)
- [x] Add `rescheduleTask(listId, taskId, dueAt)` and date normalization helpers. (Requirements: 5.1)
- [x] Add deterministic tie-break comparator utility for sort operations. (Requirements: 8.1)

## 4. Implement AI action layer
- [x] Create `useTaskAiActions` for breakdown, auto-label, and difficulty analysis. (Requirements: 6.1, 7.1, 8.1)
- [x] Add safe JSON extraction + zod validation helper for model responses. (Requirements: 6.1, 8.1, 12.1)
- [x] Implement one-click breakdown action that creates 5 subtasks by default. (Requirements: 6.1, 4.1)
- [x] Implement auto-label action with manual override guard. (Requirements: 7.1)
- [x] Implement difficulty analysis + local fallback scorer. (Requirements: 8.1)

## 5. Build Task pane UI
- [x] Create `TaskPane.vue` with header controls, quick add form, list rendering, and sort controls. (Requirements: 10.1, 3.1, 8.1)
- [x] Create task row/card component with checkbox, label chip, due date, and subtask foldout. (Requirements: 10.1, 4.1)
- [x] Add one-click "Break this down" action per task row with loading/error states. (Requirements: 6.1, 10.1)
- [x] Implement drag interactions for reorder and reschedule with keyboard-accessible alternatives. (Requirements: 5.1, 10.1)

## 6. Build sidebar page integration
- [x] Create `TaskSidebarPage.vue` that lists task lists and opens selected list in pane mode. (Requirements: 1.1)
- [x] Add new-list creation action from sidebar page. (Requirements: 1.1, 2.1)
- [x] Wire page registration (`registerSidebarPage`) and pane registration (`registerPaneApp`). (Requirements: 1.1)

## 7. Register tool-callable task operations
- [x] Add tool definitions for required actions in `taskToolDefs.ts`. (Requirements: 9.1)
- [x] Register handlers in `registerTaskTools.ts` using `useToolRegistry`. (Requirements: 9.1)
- [x] Implement handlers for:
  - [x] `or3_tasks_add_item` (Requirements: 9.1, 3.1)
  - [x] `or3_tasks_remove_item` (Requirements: 9.1, 3.1)
  - [x] `or3_tasks_update_item` (Requirements: 9.1, 3.1)
  - [x] `or3_tasks_reorganize` (Requirements: 9.1, 5.1)
  - [x] `or3_tasks_create_subtask` (Requirements: 9.1, 4.1)
  - [x] `or3_tasks_remove_subtask` (Requirements: 9.1, 4.1)
  - [x] `or3_tasks_sort_by_difficulty` (Requirements: 9.1, 8.1)
- [x] Return structured JSON strings from all handlers and include consistent error payload shape. (Requirements: 9.1)

## 8. Wire sorting modes and user controls
- [x] Add `manual|hardest|easiest` mode state to list meta and UI toggle. (Requirements: 8.1)
- [x] Implement "Sort hardest first" and "Sort easiest first" actions invoking AI analysis flow. (Requirements: 8.1)
- [x] Preserve stable order tie-break semantics and expose fallback notice in UI when AI is unavailable. (Requirements: 8.1, 10.1)

## 9. Accessibility and visual polish pass
- [x] Apply Nuxt UI + retro token classes for all new controls/components. (Requirements: 10.1)
- [x] Ensure icon-only buttons remain square/centered and have accessible labels. (Requirements: 10.1)
- [x] Validate mobile and desktop layouts for pane + sidebar surfaces. (Requirements: 10.1)

## 10. Testing

### Unit tests
- [x] Add service tests for task/subtask CRUD invariants. (Requirements: 12.1, 3.1, 4.1)
- [x] Add reorder/reschedule comparator tests. (Requirements: 12.1, 5.1, 8.1)
- [x] Add AI parser and fallback scoring tests. (Requirements: 12.1, 6.1, 8.1)
- [x] Add label inference + manual override tests. (Requirements: 12.1, 7.1)

### Integration/component tests
- [x] Add pane/sidebar integration tests for default list creation and open/switch behavior. (Requirements: 12.1, 1.1)
- [x] Add tool invocation tests to verify each registered tool mutates list data correctly. (Requirements: 12.1, 9.1)
- [x] Add UI tests for one-click breakdown and sort mode toggles. (Requirements: 12.1, 6.1, 8.1)

## 11. Verification and docs sync
- [x] Run `bun run test` for affected suites. (Requirements: 12.1)
- [x] Run `bun run type-check` and fix introduced typing issues. (Requirements: 11.1, 12.1)
- [x] Update relevant docs pages:
  - [x] `public/_documentation/start/mini-app-tutorial.md` (task pane reference link)
  - [x] `public/_documentation/utils/tool-registry.md` (task tools example snippet)
  - [x] `public/_documentation/docmap.json` (new docs entries if added)
