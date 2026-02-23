# Component Review - Low

## 1) Attachment name truncation logic is duplicated
- File: `app/components/chat/ChatMessage.vue:716`
- Problem: Two separate truncation paths implement nearly the same string shortening rules.
- Recommendation: Extract one shared filename truncation helper.
- Status: ✅ Resolved
- Implementation: `app/utils/chat/truncateAttachmentName.ts`, `app/composables/chat/useMessageThumbnails.ts`

## 2) Unused retry state in lazy search panel
- File: `app/components/documents/LazySearchPanel.vue:45`
- Problem: `retryKey` is mutated but not used in rendering/flow, adding misleading state.
- Recommendation: Remove it or wire it to a real keyed remount target.
- Status: ✅ Resolved
- Implementation: `app/components/documents/LazySearchPanel.vue`

## 3) Documentation route wrappers duplicate page shell/meta shape
- Files: `app/pages/documentation/index.vue:1`, `app/pages/documentation/[...slug].vue:1`
- Problem: Mostly duplicated wrapper/meta structure across routes.
- Recommendation: Share page meta/template wrapper through one helper/component.
- Status: ✅ Resolved
- Implementation: `app/pages/documentation/meta.ts`, `app/pages/documentation/index.vue`, `app/pages/documentation/[...slug].vue`

## 4) Sidebar project action theme override wiring is repeated
- Files: `app/components/sidebar/SidebarProjectTree.vue:220`, `app/components/sidebar/SidebarProjectRoot.vue:121`, `app/components/sidebar/SidebarProjectChild.vue:100`
- Problem: Similar `useThemeOverrides` merge logic for action buttons is repeated in three files.
- Recommendation: Extract shared sidebar project action button override helper.
- Status: ✅ Resolved
- Implementation: `app/composables/sidebar/useSidebarProjectActionButtonProps.ts`, `app/components/sidebar/SidebarProjectTree.vue`, `app/components/sidebar/SidebarProjectRoot.vue`, `app/components/sidebar/SidebarProjectChild.vue`

## 5) Page shell has duplicate record-validation loops
- File: `app/components/PageShell.vue:684`
- Problem: `validateThread` and `validateDocument` repeat near-identical retry and readiness logic.
- Recommendation: Consolidate into one generic record validation helper.
- Status: ✅ Resolved
- Implementation: `app/composables/core/recordValidation.ts`, `app/components/PageShell.vue`

## 6) Theme override merge pattern repeated across prompts/model/docs components
- Files: `app/components/prompts/PromptEditor.vue:200`, `app/components/modal/ModelCatalog.vue:245`, `app/components/DocumentationShell.vue:576`
- Problem: Input prop override merge pattern is duplicated and can drift.
- Recommendation: Create one shared override-merging utility and consume it across components.
- Status: ✅ Resolved
- Implementation: `app/composables/ui/themeOverrideProps.ts`, `app/components/prompts/PromptEditor.vue`, `app/components/modal/ModelCatalog.vue`, `app/components/DocumentationShell.vue`, `app/pages/images/ImageViewer.vue`
