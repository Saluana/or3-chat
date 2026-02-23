---
artifact_id: 1ead55e5-9247-4270-92c5-643b98b49a71
title: requirements.md
status: draft
owner: or3-chat
date: 2026-02-19
---

# requirements.md

## Introduction
Build a first-class Task/Todo pane app for OR3 that is local-first, AI-assisted, and tool-callable from chat.  
The feature must integrate with existing pane/sidebar registries, use the existing Dexie-backed post model, and preserve static-build and SSR boundaries.

Scope requested by product:
- Simple, fast task list view in the app.
- One-tap "Break this down" that turns a high-level task into small steps.
- Drag to reorder and reschedule.
- Auto-label tasks (`work`, `home`, `health`) based on task text.
- AI prompt control through registered tools:
  - Reorganize task list
  - Add new items
  - Remove items
  - Update items
  - Create subtasks
  - Remove subtasks
- Sort by hardest first / easiest first using AI analysis output.

## Requirements

### 1. Pane App and Sidebar Entry
**User Story 1.1**  
As a user, I want to open a dedicated Tasks pane from the OR3 sidebar, so I can manage todos without leaving the multi-pane workspace.

**Acceptance Criteria**
- WHEN the app boots on client THEN the system SHALL register a pane app for tasks through `usePaneApps`.
- WHEN the app boots on client THEN the system SHALL register a sidebar page for tasks through `registerSidebarPage`.
- WHEN no list record exists THEN the pane SHALL create a default list record via the pane post API.

### 2. Local-First Data Persistence
**User Story 2.1**  
As a user, I want task data saved locally-first, so my list works immediately and survives reloads.

**Acceptance Criteria**
- WHEN tasks are created/updated/reordered/deleted THEN the system SHALL persist state in Dexie-backed posts data.
- WHEN the task list is loaded THEN the system SHALL read from local posts first without requiring network.
- IF metadata serialization fails THEN the system SHALL fail safely and not corrupt existing list data.

### 3. Core Task CRUD
**User Story 3.1**  
As a user, I want to add, edit, complete, and remove tasks, so I can manage a real todo workflow.

**Acceptance Criteria**
- WHEN the user adds a task THEN the system SHALL append it with stable id/order/timestamps.
- WHEN the user updates text/status/date THEN the system SHALL persist updates atomically.
- WHEN the user removes a task THEN the system SHALL remove it and preserve valid ordering for remaining tasks.

### 4. Subtask CRUD
**User Story 4.1**  
As a user, I want to add and remove subtasks under a task, so I can break work into smaller steps.

**Acceptance Criteria**
- WHEN the user creates a subtask THEN the system SHALL append it under the target task with stable id/order.
- WHEN the user removes a subtask THEN the system SHALL remove only that subtask.
- WHEN a parent task is deleted THEN the system SHALL remove its subtasks with it.

### 5. Drag Reorder and Reschedule
**User Story 5.1**  
As a user, I want to drag tasks to reorder or reschedule, so planning is fast and visual.

**Acceptance Criteria**
- WHEN a drag reorder completes THEN the system SHALL persist new order values in one write operation.
- WHEN a drag reschedule action completes THEN the system SHALL persist updated due/schedule metadata.
- WHEN drag fails or is cancelled THEN the system SHALL keep prior ordering/schedule unchanged.

### 6. One-Tap AI Breakdown
**User Story 6.1**  
As a user, I want one-click expansion of a large task into five tiny steps, so I can start quickly.

**Acceptance Criteria**
- WHEN the user clicks "Break this down" on a task THEN the system SHALL request an AI breakdown and generate subtasks.
- THEN the system SHALL create exactly 5 subtasks by default unless user config chooses another count.
- IF AI response is invalid/unavailable THEN the system SHALL show an actionable error and SHALL NOT delete existing subtasks.

### 7. Auto Labels (`work`, `home`, `health`)
**User Story 7.1**  
As a user, I want tasks auto-labeled based on wording, so lists are easier to scan and filter.

**Acceptance Criteria**
- WHEN a task is created or its title changes THEN the system SHALL classify it into `work`, `home`, `health`, or `uncategorized`.
- WHEN a user manually changes a label THEN the system SHALL preserve the manual label until explicitly re-auto-labeled.
- WHEN label inference is uncertain THEN the system SHALL default to `uncategorized`.

### 8. AI Difficulty Analysis and Sorting
**User Story 8.1**  
As a user, I want one-click sort by hardest or easiest using AI analysis, so I can prioritize execution.

**Acceptance Criteria**
- WHEN the user chooses hardest/easiest sort THEN the system SHALL request or use AI-derived difficulty scores for all visible tasks.
- THEN the system SHALL apply stable sorting by difficulty with deterministic tie-breakers.
- IF AI scoring fails THEN the system SHALL apply a deterministic local fallback scoring strategy and disclose fallback mode.

### 9. Prompt-Controllable Tool Registry Integration
**User Story 9.1**  
As a user chatting with AI, I want prompt-triggered tools to modify my task list, so I can manage tasks conversationally.

**Acceptance Criteria**
- WHEN the plugin initializes THEN it SHALL register task tools in the client tool registry.
- The tool set SHALL include:
  - reorganize task list
  - add item
  - remove item
  - update item
  - create subtask
  - remove subtask
  - sort by hardest/easiest
- WHEN tools execute THEN each tool SHALL validate required args and return structured success/error output.

### 10. Visual Quality, Accessibility, and Responsiveness
**User Story 10.1**  
As a user, I want the task pane to look polished and feel intentional, so it is enjoyable to use.

**Acceptance Criteria**
- WHEN rendered on desktop/mobile THEN the pane SHALL remain usable and readable without layout breakage.
- THEN UI controls SHALL use existing Nuxt UI + retro theme patterns (tokens/variants/classes) rather than ad-hoc styling systems.
- THEN drag handles, sort toggles, and action buttons SHALL be keyboard accessible and have clear labels.

### 11. Boundary and Build Safety
**User Story 11.1**  
As a maintainer, I want the feature to keep static builds and SSR-safe boundaries intact, so deployment modes do not regress.

**Acceptance Criteria**
- WHEN building static mode THEN the feature SHALL not require server-only imports on the client path.
- WHEN running client plugin code THEN it SHALL be guarded by `process.client` where required.
- The implementation SHALL not introduce new server dependencies for local task CRUD/tool behavior.

### 12. Testing Coverage
**User Story 12.1**  
As a maintainer, I want regression tests across task logic and tool calls, so refactors do not break behavior.

**Acceptance Criteria**
- Unit tests SHALL cover task CRUD, subtask CRUD, reorder/reschedule, label classification, and difficulty sort tie-break rules.
- Integration tests SHALL cover pane + sidebar + persistence + tool-call round-trips.
- Tests SHALL validate AI-response parsing hardening (invalid JSON, empty steps, duplicate IDs).
