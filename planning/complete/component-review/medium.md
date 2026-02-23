# Component Review - Medium

## 1) Chat input dropper is overgrown and hard to reason about
- File: `app/components/chat/ChatInputDropper.vue:183`
- Problem: Drag/drop, attachment persistence, large-text paste flow, model/settings orchestration, and pane bridge APIs are packed into one component.
- Recommendation: Extract focused composables (`useAttachmentQueue`, `useLargeTextCapture`, settings/prompt orchestration) and reduce root component scope.
- Status: ✅ Resolved
- Implementation: `app/components/chat/chat-input/useChatInputAttachments.ts`, `app/components/chat/chat-input/types.ts`, `app/components/chat/ChatInputDropper.vue`

## 2) Pending-attachment send guard is duplicated
- Files: `app/components/chat/ChatContainer.vue:613`, `app/components/chat/ChatInputDropper.vue:1073`
- Problem: Same readiness check and toast gating behavior exists in multiple places and can drift.
- Recommendation: Centralize into one shared helper/composable used by both components.
- Status: ✅ Resolved
- Implementation: `app/composables/chat/pendingAttachmentGuard.ts`, `app/components/chat/ChatContainer.vue`, `app/components/chat/ChatInputDropper.vue`

## 3) Document editor root combines toolbar, lifecycle, and hook wiring
- File: `app/components/documents/DocumentEditorRoot.vue:64`
- Problem: Toolbar config, editor lifecycle, status transitions, and command dispatch live together in a long component.
- Recommendation: Split toolbar/command logic and editor lifecycle into separate composables.
- Status: ✅ Resolved
- Implementation: `app/composables/documents/useDocumentEditorToolbar.ts`, `app/components/documents/DocumentEditorRoot.vue`

## 4) Admin workspace gating logic is copy-pasted
- Files: `app/pages/admin/plugins.vue:1`, `app/pages/admin/themes.vue:1`
- Problem: `WorkspaceSelector` modal/gating/watch behavior is duplicated between pages.
- Recommendation: Build a shared admin workspace shell/composable and consume it across extension pages.
- Status: ✅ Resolved
- Implementation: `app/composables/admin/useAdminWorkspaceGate.ts`, `app/pages/admin/plugins.vue`, `app/pages/admin/themes.vue`

## 5) Admin user lookup/list UI logic is duplicated
- Files: `app/pages/admin/admin-users.vue:18`, `app/pages/admin/workspaces/create.vue:36`
- Problem: Similar search/list fetch + mapping + card rendering duplicated across workflows.
- Recommendation: Extract reusable user lookup component/composable and emit selection to page-specific handlers.
- Status: ✅ Resolved
- Implementation: `app/composables/admin/useAdminUserLookup.ts`, `app/pages/admin/admin-users.vue`, `app/pages/admin/workspaces/create.vue`

## 6) Dashboard background layer editor blocks are duplicated
- File: `app/components/dashboard/theme/BackgroundLayersSection.vue:3`
- Problem: Repeated editor blocks and handlers per layer inflate file size and risk behavior drift.
- Recommendation: Drive layers with a config array and render/edit via one `v-for` + shared handlers.
- Status: ✅ Resolved
- Implementation: `app/components/dashboard/theme/BackgroundLayersSection.vue`

## 7) Color palette section has manual boilerplate map management
- File: `app/components/dashboard/theme/ColorPaletteSection.vue:170`
- Problem: Large hardcoded `localHex` map and repeated key handling create dual-maintenance hotspots.
- Recommendation: Derive keys from color group metadata and build reactive maps/watchers programmatically.
- Status: ✅ Resolved
- Implementation: `app/components/dashboard/theme/ColorPaletteSection.vue`

## 8) Images page has duplicate delete flows
- File: `app/pages/images/index.vue:250`
- Problem: `executeDelete` and `executeHardDelete` duplicate confirmation, error, state cleanup, and toast scaffolding.
- Recommendation: Consolidate into one parametrized delete routine.
- Status: ✅ Resolved
- Implementation: `app/pages/images/index.vue`

## 9) Image viewer duplicates theme-override prop builder pattern
- File: `app/pages/images/ImageViewer.vue:85`
- Problem: Many near-identical computed override-merging blocks increase surface area and maintenance cost.
- Recommendation: Introduce a shared `createOverrideProps(...)` helper for repeated merge logic.
- Status: ✅ Resolved
- Implementation: `app/composables/ui/themeOverrideProps.ts`, `app/pages/images/ImageViewer.vue`, `app/components/prompts/PromptEditor.vue`, `app/components/modal/ModelCatalog.vue`, `app/components/DocumentationShell.vue`

## 10) Sidebar root component is monolithic
- File: `app/components/sidebar/SideBar.vue:1`
- Problem: Modal state machines, project/thread subscriptions, pagination, and rendering are all coupled in one oversized file.
- Recommendation: Move project/thread data flows into composables and split modal sections into child components.
- Status: ✅ Resolved
- Implementation: `app/components/sidebar/SidebarEntityModals.vue`, `app/composables/sidebar/useSidebarProjectDisplay.ts`, `app/components/sidebar/SideBar.vue`

## 11) Workspace manager mixes multiple domains in one component
- File: `app/plugins/workspaces/WorkspaceManager.vue:198`
- Problem: Workspace CRUD, legacy import, transactional persistence, session refresh retry loops, and UI updates are all co-located.
- Recommendation: Extract lifecycle/import/cache/session logic into dedicated composables/services.
- Status: ✅ Resolved
- Implementation: `app/composables/workspace/useWorkspaceManagerSession.ts`, `app/composables/workspace/useWorkspaceManagerCache.ts`, `app/composables/workspace/useWorkspaceLegacyImport.ts`, `app/plugins/workspaces/WorkspaceManager.vue`

## 12) Documentation shell is a large mixed-responsibility component
- File: `app/components/DocumentationShell.vue:1`
- Problem: Navigation, async doc loading, TOC mutation observer, search, focus management, and rendering are tightly packed.
- Recommendation: Split into feature-specific components/composables (`useDocContent`, `useTocBuilder`, navigation/sidebar modules).
- Status: ✅ Resolved
- Implementation: `app/composables/documents/useDocumentationNavigation.ts`, `app/composables/documents/useDocumentationContent.ts`, `app/composables/documents/useDocumentationToc.ts`, `app/components/DocumentationShell.vue`
