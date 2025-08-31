# Unified Sidebar Virtualization (Projects + Threads + Docs)

## 1. Objective

Implement a single virtualized scroll list for sidebar content (Projects, Project Entries, Threads, Documents) using `virtua/vue` to ensure constant DOM size and smooth performance at scale (thousands of rows) while preserving **all existing UI and behaviors** (modals, actions, styling, search filtering, expansion state).

## 2. Scope

In-scope:

-   Introduce a unified virtualized list for projects / threads / documents.
-   Preserve the existing list components (`SidebarProjectTree`, `SidebarThreadsList`, `SidebarDocumentsList`) as thin wrappers or façade components for backward compatibility with any extension patterns relying on their presence.
-   Maintain current visual layout, spacing, classes, interaction semantics, and plugin action extension points (thread history actions, document history actions, project entry actions).
-   Support existing features: search filtering, expansion/collapse, add/remove, rename, delete, selection, add-to-project, modal triggers.
-   Reuse existing reactive state: `displayProjects`, `displayThreads`, `displayDocuments`, `expandedProjects`, `activeSections`.

Out of scope (explicitly excluded):

-   UI redesign or restyling.
-   New caching layers beyond what already exists.
-   Dynamic variable row height tuning beyond a simple strategy.
-   Removing legacy list components in the same PR (they will be marked deprecated first; physical deletion becomes a follow-up once confirmed no plugins directly import their internals beyond what is preserved).

## 3. Design

### 3.1 Data Flattening Model

A **single computed** array `flatItems` drives the Virtualizer.

Row item discriminated union:

```
interface SectionHeaderItem { type: 'sectionHeader'; key: string; label: string }
interface ProjectItem       { type: 'project'; key: string; project: Project }
interface ProjectEntryItem  { type: 'projectEntry'; key: string; projectId: string; entry: { id: string; name: string; kind: 'chat' | 'doc' } }
interface ThreadItem        { type: 'thread'; key: string; thread: Thread }
interface DocItem           { type: 'doc'; key: string; doc: Post }

type SidebarRowItem = SectionHeaderItem | ProjectItem | ProjectEntryItem | ThreadItem | DocItem;
```

Key rules:

-   Stable `key` string per row (`type`-prefixed) to prevent reuse collisions.
-   Recommended key formats (explicit to avoid accidental collisions):
    -   Section header: `sec:${key}`
    -   Project: `proj:${project.id}`
    -   Project entry: `projEntry:${projectId}:${entry.id}`
    -   Thread: `thread:${thread.id}`
    -   Doc: `doc:${doc.id}`
-   Only include section headers when that section is enabled (`activeSections`) **and** it will contain at least one child row (avoid empty headers).
-   For projects: include entries only when project id appears in `expandedProjects`.
-   For docs: if `displayDocuments` (search results) is defined use that array; otherwise (no active search) fall back to the base docs list (lightweight mapped, see 3.1.1) when `activeSections.docs` is true.

#### 3.1.1 Lightweight Docs Mapping & Fallback

The live documents subscription (`docs`) returns full post objects which may contain large `content` blobs. To preserve memory characteristics from the pre-virtualization implementation we create a lightweight computed `lightweightDocs = docs.map(d => ({ id, title, updated_at, created_at, postType }))` that omits `content` (and any other heavy fields). Hover prefetch + action handlers already know how to lazily load full content elsewhere (unchanged). `flatItems` uses:

```
const effectiveDocs = displayDocuments ?? lightweightDocs;
```

This preserves existing behavior where docs list appears even when not searching, while search results override with filtered docs when a query is present.

#### 3.1.2 Project Entry Action Payload Shape

Project entry context menu actions must emit the payload expected by existing handlers: `{ projectId, entryId, kind }`. Ensure the virtualized row passes _both_ identifiers so `openRename` / `handleRemoveFromProject` continue functioning without refactors.

### 3.2 Reactivity

`flatItems` recomputes on changes to:

-   `displayProjects`, `displayThreads`, `displayDocuments` (these already reflect search query filtering).
-   `expandedProjects` (expansion state).
-   `activeSections` toggles.

No additional watchers; rely on computed dependencies. The lightweight docs computed (3.1.1) participates automatically.

### 3.3 Virtualizer Configuration

Using `<Virtualizer />` from `virtua/vue`:

-   `:data="flatItems"`
-   `:itemSize="rowSize"` (constant estimated height, 36px) — adequate for uniform single-line rows and small project header variance.
-   `:overscan="6"` for smooth wheel scroll.
-   `class="flex-1 overflow-y-auto"` integrated into existing scroll container area.
-   Provide external `ref` to measure / maintain existing bottom padding logic (`bottomPad`).

### 3.4 Row Renderers

Inline template `v-if` chain inside the Virtualizer slot for minimal overhead (no heavy component fragmentation):

-   sectionHeader → existing header style: small uppercase label.
-   project row → replicate current clickable area & expand toggle **including** the two hover-only quick add buttons (add chat, add doc) present in the existing `SidebarProjectTree` (`group/addchat` utility classes) plus the actions popover.
-   projectEntry row → mimic project tree entry style (chat/doc icon + context actions menu). Ensure context menu buttons emit `{ projectId, entryId, kind }`.
-   thread row → same markup as old threads list row plus mapped plugin actions from `useThreadHistoryActions()` (see 3.14).
-   doc row → same markup as old documents list row plus mapped plugin actions from `useDocumentHistoryActions()` (see 3.14). Still uses trimmed doc objects; content is loaded on demand elsewhere by existing prefetch logic (retained in `SideNavContent` or moved into a shared composable if needed).

### 3.5 Event Handling

Each row binds directly to existing handler functions passed as props from `SideNavContent`:

-   Select: `@click="selectThread(id)"` / `selectDocument(id)` / for projectEntry choose by `entry.kind`.
-   Expand/collapse: button toggles membership in `expandedProjects` (mutating the array).
-   Actions (rename/delete/add-to-project/remove-from-project) call the same functions (`openRename`, `openRenameProject`, `confirmDeleteProject`, `confirmDelete`, `confirmDeleteDocument`, `openAddToProject`, `openAddDocumentToProject`, `handleRemoveFromProject`). Project entry actions emit `{ projectId, entryId, kind }`.

### 3.6 Styling Preservation

-   Copy class names from existing list item wrappers to maintain identical visuals.
-   Preserve conditional active state styling for current thread/document selection.
-   Maintain spacing by inserting same margin utilities where they appeared between sections (if any). If previous layout inserted gaps with separate components, replicate with a constant spacer row or margin on headers.
-   Preserve the `group/addchat` hover group classes for project rows so quick add buttons retain existing fade-in behavior.

### 3.7 Accessibility / Semantics

-   Keep `button` roles for interactive icons (expand/collapse) with `aria-expanded` attribute.
-   No regression: ensure row click vs. action button click separation via `@click.stop` in action icon containers.

### 3.8 Performance Notes

-   Constant `itemSize` avoids measurement overhead.
-   Headers height mismatch (a few px difference) is acceptable; virtua adjusts scroll anchoring without noticeable UX issues for small variance.
-   Overscan of 6 ensures keyboard/page scroll smoothness while limiting offscreen DOM nodes.
-   If visible vertical jitter appears (due to true average row height > estimation), test raising `rowSize` modestly (e.g. 38) before considering dynamic measurement.

### 3.9 Error Handling

-   None required beyond existing logic; Virtualizer is pure view.
-   If any referenced handler is undefined (should not happen), fail fast in dev with console error — optional console guard is **not** added (keep minimal code).

### 3.10 Migration Steps

1. Create `SidebarVirtualList.vue` implementing above spec.
2. Import it into `SideNavContent.vue`.
3. Remove (or comment) `SidebarProjectTree`, `LazySidebarThreadsList`, `LazySidebarDocumentsList` usage; keep their imports only if other parts rely (else delete imports).
4. Pass required reactive props + handlers to new component.
5. Confirm bottom padding logic still applied (apply `:style="{ paddingBottom: bottomPad + 'px' }"` on outer scroll wrapper containing Virtualizer).
6. Test all interactions; adjust row classes to pixel-match.
7. Delete unused components if fully superseded (optional follow-up PR if used nowhere else).

### 3.11 Testing Matrix

| Scenario                                       | Expectation                                                            |
| ---------------------------------------------- | ---------------------------------------------------------------------- |
| Large number (1k) threads/docs (seed manually) | Smooth scroll, DOM node count limited (inspect Elements)               |
| Expand/collapse project                        | Only its entries appear/disappear; scroll height adjusts without lag   |
| Search filter active                           | Flat list recomputes; only matching rows visible                       |
| Rename (project/thread/doc)                    | Title updates in place without scroll reset                            |
| Delete project/thread/doc                      | Row removed; list reconciles; no blank gaps                            |
| Add to project / new thread/doc inside project | New entry row appears; auto-expands project if logic currently does so |
| Document content hover prefetch                | Unaffected                                                             |
| Modals (rename, delete)                        | Still open and work                                                    |

### 3.12 Rollout

Single atomic change; no feature flag. Immediate replacement is safe due to preserved semantics.

### 3.13 Files Affected

Create:

-   `app/components/sidebar/SidebarVirtualList.vue` – new unified virtualized list component.

Edit:

-   `app/components/sidebar/SideNavContent.vue` – replace old list usage with virtual list; pass props & handlers.
-   `package.json` – ensure `virtua` dependency present.

Deprecate (but keep initially):

-   `app/components/sidebar/SidebarProjectTree.vue` – retained; may internally delegate to virtualization later or remain for plugin backward compatibility.
-   `app/components/sidebar/SidebarThreadsList.vue` / `LazySidebarThreadsList` – retained wrappers.
-   `app/components/sidebar/SidebarDocumentsList.vue` / `LazySidebarDocumentsList` – retained wrappers.

Follow-up (optional) removal only after confirming no external code depends on their concrete implementations beyond the exported props/events. A deprecation notice comment will be added in each file pointing to `SidebarVirtualList.vue`.

No other files should be modified.

### 3.14 Extensibility Preservation

Goal: Ensure virtualization does **not** break UI extension points described in `/docs/UI/*`.

Extension points involved:

1. Thread history actions (`useThreadHistoryActions`) – previously consumed inside `SidebarThreadsList.vue`.
2. Document history actions (`useDocumentHistoryActions`) – previously consumed inside `SidebarDocumentsList.vue`.
3. Project entry actions (rename / remove) – emitted via specific payload shape consumed by existing handlers.

Strategy:

-   The virtual row renderer for `thread` will call `const extraThreadActions = useThreadHistoryActions()` and render its buttons exactly like original list (ordering preserved).
-   The virtual row renderer for `doc` will call `const extraDocActions = useDocumentHistoryActions()`.
-   Core actions (rename / add-to-project / delete) remain first; plugin actions appended sorted by their `order` (existing composables already sort; no extra sort required unless we need explicit precedence override).
-   Keep legacy components in place; mark them with a header comment: "Deprecated: superseded by SidebarVirtualList row virtualization. Safe to remove after plugin ecosystem validation." This allows any plugin still importing them (if any) to continue functioning.
-   Optional: Provide a compatibility wrapper (future) that simply renders `<SidebarVirtualList>` when all three sections enabled; only needed if external code directly mounts the three legacy components in a custom layout.

Testing Checklist for Extensibility:

-   Register a sample thread history action (existing example plugin) – verify it appears in virtualized thread rows.
-   Register a sample document history action – verify appearance in doc rows.
-   Confirm action handlers still receive expected context objects (`{ thread }` / `{ document }`).
-   Confirm no increase in re-renders (inspect Vue devtools) when scrolling (actions array stable except on registry change).

Risk Mitigation:

-   If unforeseen coupling arises, fallback: wrap existing list components inside the virtual list by rendering individual component instances per row type (higher overhead), but we anticipate direct composable usage is sufficient.

### 3.15 Item Componentization (Refinement)

To further reduce risk of breaking extension logic while simplifying the virtualizer template, we will extract each row type into its own focused component that encapsulates its action menus and plugin extension hooks. This replaces the need to preserve large legacy _list_ components while still preserving their per-item semantics.

New components (thin – each < ~120 LOC):

1. `SidebarProjectItem.vue`
    - Renders a single project row (formerly part of `SidebarProjectTree`).
    - Props: `project`, `expanded: boolean`, `isFirstSection: boolean` (optional for spacing), `activeSections`, `expandedProjects` (or a simpler callback), `quickAddEnabled`.
    - Emits: `toggle`, `add-chat`, `add-doc`, `rename-project`, `delete-project`.
    - Provides hover quick-add buttons + actions popover.
2. `SidebarProjectEntryItem.vue`
    - Renders a single project entry (chat/doc) with rename & remove actions.
    - Props: `entry`, `projectId`, `active`.
    - Emits: `select`, `rename-entry`, `remove-entry`.
3. `SidebarThreadItem.vue`
    - Encapsulates a thread row with plugin thread actions.
    - Props: `thread`, `active`.
    - Emits: `select`, `rename-thread`, `delete-thread`, `add-to-project`.
    - Internally uses `useThreadHistoryActions()` to render extra plugin actions.
4. `SidebarDocumentItem.vue`
    - Encapsulates a document row with plugin document actions and hover prefetch.
    - Props: `doc`, `active`.
    - Emits: `select`, `rename-document`, `delete-document`, `add-to-project`, plus any future doc-specific events.
    - Internally uses `useDocumentHistoryActions()` and performs content hover prefetch (logic migrated from old list + SideNavContent prefetch util or localized here).
5. (Optional) `SidebarSectionHeader.vue`
    - Very small; maintains consistent header styling.

Benefits:

-   Keeps virtualization layer declarative: `v-if` → `<SidebarThreadItem :thread="row.thread" @select="..." />` etc.
-   Each item component independently imports its extension composable, preserving plugin registration logic without centralizing in the virtual list.
-   Easier future per-row enhancements (e.g., tooltips, drag & drop) without bloating one large file.
-   Improves testability (unit test each item in isolation).

Performance Consideration:

Vue component boundary overhead is minimal relative to the number of _visible_ virtualized rows (dozens). Virtualizer only mounts a limited window, so this remains performant. We keep props shallow to avoid unnecessary reactive diffusion.

Migration Steps Addendum:

1. Extract item components before (or during) integrating Virtualizer.
2. Move per-item action logic (thread/doc extra actions, hover prefetch, project entry emits) into those components.
3. Replace inline branches inside `SidebarVirtualList.vue` with the new components.
4. Add deprecation comments to legacy list components directing developers to new per-item components for extension reference.

Extension Hooks Handling:

-   Thread/document extra actions remain auto-resolved by composables **inside** item components, so plugin authors do not change anything.
-   Project entry rename/remove payload shape unchanged: emitted `{ projectId, entryId, kind }`.

Testing Additions:

-   Snapshot test (optional future) for each item component verifying presence of built-in action buttons and ordered plugin actions.

Fallback:

-   If any regression discovered, we can temporarily point the virtual rows to wrappers that internally render legacy list components filtered to a single item (higher cost but safe) while patching.

## 4. File Layout

-   `app/components/sidebar/SidebarVirtualList.vue` (new)
-   `app/components/sidebar/SideNavContent.vue` (edited integration)

## 5. Security / Privacy

No changes to data access patterns; only presentation layer refactor.

## 6. Risks & Mitigations

| Risk                                             | Mitigation                                                   |
| ------------------------------------------------ | ------------------------------------------------------------ |
| Minor height mismatch shifts scroll anchor       | Keep conservative uniform `itemSize`; accept minor deviation |
| Missed handler wiring causing broken action      | Manual QA using existing sidebar actions checklist           |
| Performance regression due to incorrect overscan | Tune `overscan` (reduce to 4 if needed)                      |

## 7. Deliverables

-   New virtual list component with < 200 LOC.
-   Updated sidebar using it.
-   All prior modals & actions functioning identically.

## Task List

(All tasks must be completed in order; use the checkboxes.)

### Task 1: Build Virtual List Component

-   [ ] Ensure `virtua` dependency exists in `package.json` (add if missing).
-   [ ] Create `SidebarVirtualList.vue` (script setup) accepting props: `projects`, `threads`, `documents`, `expandedProjects`, `activeSections` plus all action handler functions.
-   [ ] Implement computed `flatItems` (single array of sectionHeader, project, projectEntry, thread, doc rows) with stable `key` values (`sec:`, `proj:`, `projEntry:`, `thread:`, `doc:` prefixes).
-   [ ] Add constant `rowSize` (36) and `<Virtualizer :data="flatItems" :itemSize="rowSize" :overscan="6" />` template.
-   [ ] Implement inline row render branches preserving existing classes/markup for each row type (include project quick add buttons + hover classes `group/addchat`).
-   [ ] Wire expand/collapse toggle to mutate `expandedProjects` in place.
-   [ ] Wire all action buttons (select, rename, delete, add-to-project, remove, add chat/doc) to existing passed handlers (project entry actions emit `{ projectId, entryId, kind }`).
-   [ ] Add lightweight `lightweightDocs` computed (strip `content`) and fallback logic: use `displayDocuments ?? lightweightDocs`.

### Task 2: Integrate & Replace Existing Lists (Non-destructive)

-   [ ] Import `SidebarVirtualList` in `SideNavContent.vue`.
-   [ ] Gate usage behind an internal boolean (e.g. `useUnifiedVirtualSidebar = true`) so we can quick-toggle for debugging; legacy components remain mounted only when toggle off.
-   [ ] Replace the three list component usages with the virtual list **while keeping their imports** (temporary) and adding deprecation comments in their source files.
-   [ ] Apply existing bottom padding style (`:style="{ paddingBottom: bottomPad + 'px' }"`).
-   [ ] Pass through reactive props (`displayProjects`, `displayThreads`, `displayDocuments`, `expandedProjects`, `activeSections`, plus active ids).
-   [ ] Integrate plugin action composables in virtual rows (`useThreadHistoryActions`, `useDocumentHistoryActions`).
-   [ ] Verify all extension actions render and function.
-   [ ] Run app and verify visual parity (spacing, active states, icons).
-   [ ] Stress test with synthetic data (>1000 rows) verifying DOM node cap & action button presence.
-   [ ] Leave legacy components in place with deprecation warnings.
-   [ ] Extract per-item components (`SidebarThreadItem`, `SidebarDocumentItem`, `SidebarProjectItem`, `SidebarProjectEntryItem`) and swap inline virtualizer branches to use them.

### Task 3: QA & Cleanup / Deprecation

-   [ ] Functional verification: project expand/collapse, project entry select, thread select, document select, search filtering, rename (all types), delete (all types), add chat/doc to project, remove from project, add-to-project modal, hover content prefetch unaffected, modals open/close.
-   [ ] Confirm scroll anchoring (expanding/collapsing does not jump unexpectedly) and bottom nav padding maintained.
-   [ ] Adjust `rowSize` only if noticeable layout jitter (otherwise keep 36).
-   [ ] Commit changes (`feat(sidebar): unify projects/threads/docs into virtualized list`).
-   [ ] Add deprecation header comments to legacy components referencing virtualization plan section 3.14.
-   [ ] (Optional later) Remove legacy sidebar list component files if confirmed unused after a stabilization period.
-   [ ] (Optional) Add comments in new item components referencing extension docs (`/docs/UI/*`) for discoverability.
-   [ ] Update internal docs / changelog entry noting virtualization integration.

---

## Completion Criteria

-   Single Virtualizer handles all sidebar rows.
-   Memory & DOM node count remain low regardless of data volume.
-   No regressions in user operations verified by testing matrix.
-   Code size increase limited to one new component; old list components removable.

End of document.
