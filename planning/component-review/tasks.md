# Component Review - Task List (Ordered)

Order is optimized for risk reduction first, then dependency-aware deduping, then low-risk cleanup.

## Phase 1: High-risk structural refactors

- [ ] 1. Split `ChatMessage` into focused units (`useMessageThumbnails`, hydration logic, markdown/render helpers)
  - Files: `app/components/chat/ChatMessage.vue`
  - Why first: highest chat complexity hotspot and a blocker for safer chat follow-up refactors.

- [ ] 2. Decompose admin system page into panel components + composables
  - Files: `app/pages/admin/system.vue`
  - Why now: high-maintenance admin bottleneck; isolated from chat work so can run in parallel.

- [ ] 3. Extract sync harness runner/tests out of page component
  - Files: `app/pages/tests/sync-harness.vue`
  - Why now: large test-page complexity; improves maintainability and test confidence for other changes.

## Phase 2: Large medium-severity decompositions

- [ ] 4. Break down `ChatInputDropper` into composables/modules
  - Files: `app/components/chat/ChatInputDropper.vue`
  - Depends on: Task 1 (chat boundaries clearer after `ChatMessage` split).

- [ ] 5. Split `SideBar` into modal subcomponents + sidebar data composables
  - Files: `app/components/sidebar/SideBar.vue`
  - Why here: major UI monolith; high change surface, should be handled before low-level sidebar dedupe.

- [ ] 6. Decompose `DocumentationShell` into navigation/content/TOC composables
  - Files: `app/components/DocumentationShell.vue`
  - Why here: broad shared docs surface; unlocks docs-related duplicate cleanup.

- [ ] 7. Decompose `WorkspaceManager` lifecycle/import/cache/session flows
  - Files: `app/plugins/workspaces/WorkspaceManager.vue`
  - Why here: plugin complexity with auth/session coupling; safer before shared helper extraction.

- [ ] 8. Split `DocumentEditorRoot` toolbar/lifecycle/commands
  - Files: `app/components/documents/DocumentEditorRoot.vue`
  - Why here: documents domain becomes easier to test and change before cleanup tasks.

## Phase 3: Shared abstraction and dedupe pass

- [ ] 9. Centralize pending-attachment send guard used by chat container/dropper
  - Files: `app/components/chat/ChatContainer.vue`, `app/components/chat/ChatInputDropper.vue`
  - Depends on: Task 4.

- [ ] 10. Create shared theme-override prop builder utility
  - Files: `app/pages/images/ImageViewer.vue`, `app/components/prompts/PromptEditor.vue`, `app/components/modal/ModelCatalog.vue`, `app/components/DocumentationShell.vue`
  - Depends on: Task 6.

- [ ] 11. Refactor dashboard background layer editor to config-driven `v-for` model
  - Files: `app/components/dashboard/theme/BackgroundLayersSection.vue`
  - Why here: dedupe and simplify event wiring.

- [ ] 12. Refactor color palette local map/watch logic to metadata-driven generation
  - Files: `app/components/dashboard/theme/ColorPaletteSection.vue`
  - Why here: pairs naturally with Task 11 in same domain.

- [ ] 13. Merge duplicate image delete flows into one parametrized routine
  - Files: `app/pages/images/index.vue`
  - Why here: medium-risk local dedupe after shared utility patterns are established.

- [ ] 14. Introduce reusable admin workspace-shell gating abstraction
  - Files: `app/pages/admin/plugins.vue`, `app/pages/admin/themes.vue`
  - Depends on: Task 2.

- [ ] 15. Extract shared admin user lookup/list component or composable
  - Files: `app/pages/admin/admin-users.vue`, `app/pages/admin/workspaces/create.vue`
  - Depends on: Task 2.

## Phase 4: Low-severity cleanup and finishing pass

- [ ] 16. Consolidate chat attachment filename truncation helper
  - Files: `app/components/chat/ChatMessage.vue`
  - Depends on: Task 1.

- [ ] 17. Remove or wire `retryKey` in lazy search panel
  - Files: `app/components/documents/LazySearchPanel.vue`

- [ ] 18. Share documentation route wrapper/meta helper
  - Files: `app/pages/documentation/index.vue`, `app/pages/documentation/[...slug].vue`
  - Depends on: Task 6.

- [ ] 19. Extract shared sidebar project action override helper
  - Files: `app/components/sidebar/SidebarProjectTree.vue`, `app/components/sidebar/SidebarProjectRoot.vue`, `app/components/sidebar/SidebarProjectChild.vue`
  - Depends on: Task 5.

- [ ] 20. Consolidate generic record validation helper in page shell
  - Files: `app/components/PageShell.vue`

## Phase 5: Validation

- [ ] 21. Run verification pass after each domain batch
  - Commands: `bun run type-check`, `bun run lint`, targeted tests for chat/admin/sidebar/docs paths

- [ ] 22. Update component-review severity docs with resolved status and links to PRs/commits
  - Files: `planning/component-review/low.md`, `planning/component-review/medium.md`, `planning/component-review/high.md`, `planning/component-review/critical.md`
