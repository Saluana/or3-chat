# Requirements

## Introduction

Open a project and continue with its important knowledge, decisions, and permitted tools. Deliver useful Projects first, continuity second, and collaboration later.

## Context

Researched October 5, 2026 against freshly fetched `origin/or3-cloud` at `988310e2` in a clean worktree; the dirty checkout was preserved. Reuse Nuxt/Vue, Bun, Dexie, provider sync/storage, Files, document history, scoped search/reads, tool registries, source receipts, context admission, and chat compaction. [Design](design.md) links the implementations.

## Assumptions

- `threads.project_id` owns a chat; files/documents may serve several projects.
- Support DOCX and OR3 documents; defer OCR and legacy Office conversion.
- Preserve existing cloud sync/backups in Phase 1; collaboration comes later.

## Out of Scope

Nested projects, graph databases, autonomous memory agents, new vector infrastructure, and automatic ingestion of every conversation or attachment.

## Requirements

### R1: A place to work — Phase 1

**User Story:** I want to reopen a project and find my work.

**Acceptance Criteria:**

- R1.AC1: WHEN opening Projects THEN it SHALL offer search, pinned/recent projects, creation, and navigation to Home.
- R1.AC2: WHEN Home opens THEN it SHALL provide Overview, Chats, Knowledge, Memory, and Settings: brief, resume, recent/pinned work, instructions, model defaults, and tools, accessible on keyboard/mobile.

### R2: Trustworthy knowledge — Phase 1

**User Story:** I want reusable sources without accidental future context.

**Acceptance Criteria:**

- R2.AC1: WHEN adding files/images/documents/notes/saved responses THEN Knowledge SHALL reuse Files and expose Processing, Ready, Partially readable, or Failed, with extraction preview/retry.
- R2.AC2: WHEN choosing “Use when relevant,” “Always include,” or “Do not use” THEN context SHALL honor that project-specific mode; images SHALL retain vision inputs.
- R2.AC3: WHEN replacing sources THEN history SHALL remain accessible; WHEN attaching THEN “This chat” SHALL default, with explicit promotion to project knowledge.

### R3: Explicit memory — Phase 1

**User Story:** I want control over what the project remembers.

**Acceptance Criteria:**

- R3.AC1: WHEN editing the brief or choosing “Remember for this project” THEN memories SHALL expose text/provenance and edit/delete actions; unaccepted ideas SHALL NOT become decisions.

### R4: Consistent and inspectable context — Phase 1

**User Story:** I want every turn to use the right project.

**Acceptance Criteria:**

- R4.AC1: WHEN project-bound sends/retries/regenerations/continuations/workflows/plugins run THEN one builder SHALL capture workspace/thread/project/revisions; pane changes SHALL NOT retarget execution.
- R4.AC2: WHEN inspecting responses THEN available/retrieved/submitted instructions, sources, memories, images, and historical passages SHALL be distinguishable; oversized required context SHALL refuse visibly without silent truncation.

### R5: Enforced restrictions — Phase 1

**User Story:** I want project tools to stay within my permissions.

**Acceptance Criteria:**

- R5.AC1: WHEN executing tools THEN runtime checks SHALL enforce project/resource restrictions, existing permissions, and approvals; other projects SHALL be inaccessible by default, including through legacy tools.

### R6: Continuity — Phase 2

**User Story:** I want to resume without rereading everything.

**Acceptance Criteria:**

- R6.AC1: WHEN requested THEN OR3 SHALL propose brief/memory updates with evidence and retrieve relevant project chats/summaries; contradictions SHALL require review and excluded chats SHALL be omitted.
- R6.AC2: WHEN choosing “Continue in new chat” THEN existing compaction SHALL create a same-project handoff with source links, without the full transcript.

### R7: Durable growth — Both phases and later

**User Story:** I want my project to survive reloads and remain portable.

**Acceptance Criteria:**

- R7.AC1: WHEN reloading/syncing/restoring backups THEN project state/references SHALL survive; deleting projects SHALL preserve underlying work.
- R7.AC2: IF adding sharing, connected sources, scalable retrieval, or project import/export THEN Phase 3 SHALL first define permission-aware collaboration and preservation contracts.
