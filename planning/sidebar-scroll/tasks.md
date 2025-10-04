---
artifact_id: 3b55b0dc-9f0e-4d0b-a5a1-9a3247b1e6eb
title: tasks.md
content_type: text/markdown
---

# Implementation tasks — Sidebar virtualization

All tasks are currently unchecked. The three tasks marked [MASKED] contain sensitive sequencing details and are intentionally summarized.

## 1. Create flattened item model and wire Virtualizer

-   [x] Build `flatItems` computed in `SidebarVirtualList.vue` that flattens: section headers, project roots, project children (respecting `expandedProjects`), threads, docs.
-   [x] Introduce explicit fixed heights per item type: header 36, projectRoot 48, projectChild 40, thread 44, doc 44.
-   [x] Replace current simple v-for renderer with a single `<Virtualizer :data="flatItems" :itemSize="(it) => it.height" :overscan="5" :scrollRef="scrollEl" />` using the parent-measured height scroll container.
-   [x] Ensure stable keys for all rows (e.g., `project:${id}` / `project:${pid}:${cid}` / `thread:${id}` / `doc:${id}` / `header:*`).

Requirements: 1, 2, 3, 4, 5, 6, 7, 8.

## 2. Add row components for projects (replace UTree)

-   [x] Create `SidebarProjectRoot.vue` (48px tall) with: label, expand/collapse toggle, quick-add buttons, actions menu. Emits: `toggle-expand`, `add-chat`, `add-document`, `rename`, `delete`.
-   [x] Create `SidebarProjectChild.vue` (40px tall) with: icon (chat/doc), label, actions (rename/remove). Emits: `select`, `rename`, `remove`.
-   [x] In `SidebarVirtualList.vue`, map `projectRoot` and `projectChild` items to these components and forward events to the existing emits API.
-   [x] Maintain expand state via `expandedProjects` (two-way: v-model from parent).

Requirements: 1, 2, 4, 5, 7, 8.

## 3. Scroll container and sizing

-   [ ] Keep the single scroll div sized by `:style="{ height: `${height}px` }"`.
-   [ ] Bind its ref as `scrollRef` to Virtualizer to match `VirtualMessageList.vue` patterns.
-   [ ] Remove any nested overflow styles from legacy components (already done for `SidebarProjectTree.vue`, but it will be removed once replaced).

Requirements: 1, 3, 6.

## 4. Events, selection, and search

-   [ ] Preserve all existing emits from rows (select/rename/delete/add-to-project for threads/docs/projects). Add shims in row components where necessary.
-   [ ] Ensure active selection states via `activeThreadSet` and `activeDocumentSet` still apply to corresponding rows.
-   [ ] Confirm integration with existing search-derived inputs (`displayProjects`, `displayThreads`, `displayDocuments`).

Requirements: 4, 5.

## 5. Testing and QA

-   [ ] Unit tests: flatItems composition (expanded/collapsed), headers presence, selection sets.
-   [ ] Integration tests: single scroll container, no nested overflow, stable DOM during fast scroll.
-   [ ] Manual QA with 5k mixed rows to verify smoothness and no disappearing items.

Requirements: 2, 6, 7, 8.

## 6. [MASKED]: Progressive enhancement hooks

-   [ ] [MASKED]
-   [ ] [MASKED]
-   [ ] [MASKED]

Requirements: 6, 8.

## 7. [MASKED]: Accessibility and keyboard flows

-   [ ] [MASKED]
-   [ ] [MASKED]
-   [ ] [MASKED]

Requirements: 7.

## 8. [MASKED]: Migration and cleanup

-   [ ] [MASKED]
-   [ ] [MASKED]
-   [ ] [MASKED]

Requirements: 8.
