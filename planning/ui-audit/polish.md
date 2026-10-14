# UI audit: Polish

This is the Polish portion of PR #245, based on or3-cloud at 59af403f. The companion Additions PR depends on it and contains new navigation actions, draft numbering, workspace-app launching, expandable identifiers and the review gallery/browser harness.

The composer keeps the existing attachment, settings and send controls, without project labels or prompt badges. Original mobile painted button sizes are retained. No merge, release or deployment is included.

| Area | Change |
| --- | --- |
| Composer clutter | Removed the selected-prompt badge and the new project/workspace labels. Deleted the lookup watchers used only by those badges. The existing ambiguous-project recovery chooser remains conditional on a real ownership conflict. |
| Model controls | Removed the added compact model button. On phones, model selection is in Settings. The original desktop favorites selector remains in themes that show it, and is hidden when there are no favorites. |
| Model selection feedback | Removed the model-selection success toast. Selecting a model still saves the selection and closes the catalog. |
| Loading feedback | Removed the separate spinner over the editor. Before streaming, the send icon becomes a spinner with aria-busy; while streaming, the existing Stop control remains. |
| Attachment drop hint | Changed “Drop images here to upload” to “Drop files to attach”, reflecting PDF support too. Existing previews, removal controls, upload failures, draft-save failures and send-block recovery remain. |
| Mobile sizing — reverted | Restored composer buttons to 32×32px; mobile tab picker to 36px high; new-tab button to 32×32px; message-action height to 32px. Removed the added 44px header floor. Blank editor/pill sizing and padding return to their original values. |
| Sidebar sizing — reverted | Restored project rows from 44px to 40px, the expand control from 24px to 18px, and removed the new 44px minimum on sidebar item primary buttons. |
| Invisible hit areas | Restored the original invisible hit-area approach, correcting Blank pseudo-element width/height/transform conflicts that made adjacent buttons intercept clicks. Painted controls stay compact. |
| Chat settings | Use readable catalog model names instead of raw IDs where available, including favorite dropdown rows. Removed the generic chat-settings subtitle. Tool-category guidance remains only in the tools view. |
| Model catalog accessibility/layout | Named search and sort controls; hide the duplicate capability-chip row on desktop; mark repeated provider logos decorative. Added an accessible name to the desktop model selector. |
| System prompt library/editor | Hide the duplicate header creation action in an empty library and during editing. Added accessible names to the prompt title and instructions editor. Existing save behavior is unchanged. |
| Restored app tabs | Preserve the app ID and record while registration is delayed, react to app registration in the shell, and show “App unavailable” with guidance instead of chat content; expandable app identifiers are in Additions. |
| Dashboard navigation | Use the current page title in the dialog. Back returns to the immediate parent. Breadcrumbs contain actionable parents only, without repeating the current page title; omit them when there is no intermediate parent. |
| AI settings | Removed duplicate introduction heading/eyebrow/footer. Shortened introductory and master-prompt help. Kept automatic-save guidance next to model defaults and explicit Save controls. Named the master-prompt field. |
| Theme settings | Removed the duplicate “Theme studio” heading and “Appearance” eyebrow; retained the short automatic-save notice. Existing themes and customization controls remain. |
| Document inspector | Removed repeated Outline and Info introductions. Show section count only when headings exist. Shortened reading-time help. Raised functional inspector/history text to at least 14px; this typography change remains. |
| Document history | Renamed revision/checkpoint UI to “Saved versions”, “Save version”, and manual/automatic saved labels. Removed repeated subtitle/eyebrow; clarified the 30-second autosave empty state and preview wording. Storage and restore logic are unchanged. |
| Project Knowledge | Long titles wrap in their own column with constrained heading styles; Preview moves below the title. Source behavior is unchanged. |
| Sidebar wording/actions | Rename title search to “Filter by title”; call the recent-project group “Recent projects”; remove repeated category descriptions. Use “New workspace chat” for the global create tooltip/accessibility name and “New chat in [project]” for project creation, with a project-specific document accessible name. |
| Sidebar keyboard semantics | Replace nested clickable rows with separate native primary and secondary buttons. Make secondary actions visible on keyboard focus; name per-item/project actions and expose expansion state. Original row/button sizes are retained after the reversion. |
| Plugin Configure | Use the registered app label, distinguish configuration from execution readiness, prevent repeated launch while busy, and clarify selection-based actions; direct workspace-app launch is in Additions. |
| Marketplace installation UI | Remove repeated installed status badge/text and simplify guidance for managing access; the new Manage in Installed action is in Additions. |
| Marketplace library | Rename the dashboard destination, remove the repeated inner title, shorten linking guidance and use theme-aware text; the new administrator setup link is in Additions. |
| Webhooks | Use one page title/explanation and one Create webhook action; hide Disable All when there are no webhooks. Associate URL/label/error text; name custom hooks and workspace scope controls. |
| Activity | Readable status labels: Queued, Running, Needs approval, Completed, Failed, Cancelled. Remove repeated heading/source-kind metadata from the list, use Failed-specific empty guidance, and shorten the main empty-state description. Background generation is called “Chat response”. |
| Tool-call display | Prefer registered human-readable labels, otherwise humanize underscores/hyphens; keep the raw tool identifier in expanded details. |
| Image library | Removed the generic Workspace eyebrow and the preview-loading implementation note. Existing image actions and storage behavior remain. |
| Hidden upload fields | Remove hidden native upload inputs from keyboard/screen-reader navigation in Files, document editor, document AI, project Knowledge, theme backgrounds and image library; retain visible triggers. |
| Admin accessibility | Name each plugin configuration JSON field. |
| Backup defaults | Default import mode changes from Replace to Append & merge, with conflict overwrite still off. Replacement remains explicitly available. |

Files retain their existing Trash dropdown in this PR; their hidden upload input and trash-specific search/list names are polished here. Additions exposes Trash and Back to files and hides creation/upload controls while viewing Trash.

## Changed files

- [app/components/PageShell.vue](../../app/components/PageShell.vue)
- [app/components/PaneUnknown.vue](../../app/components/PaneUnknown.vue)
- [app/components/activity/ActivityDashboardPage.vue](../../app/components/activity/ActivityDashboardPage.vue)
- [app/components/activity/ActivityDetailPane.vue](../../app/components/activity/ActivityDetailPane.vue)
- [app/components/activity/ActivityRunList.vue](../../app/components/activity/ActivityRunList.vue)
- [app/components/activity/__tests__/ActivityCenter.test.ts](../../app/components/activity/__tests__/ActivityCenter.test.ts)
- [app/components/chat/ChatInputDropper.css](../../app/components/chat/ChatInputDropper.css)
- [app/components/chat/ChatInputDropper.vue](../../app/components/chat/ChatInputDropper.vue)
- [app/components/chat/ChatSettingsPopover.vue](../../app/components/chat/ChatSettingsPopover.vue)
- [app/components/chat/ModelSelect.vue](../../app/components/chat/ModelSelect.vue)
- [app/components/chat/SystemPromptsModal.vue](../../app/components/chat/SystemPromptsModal.vue)
- [app/components/chat/ToolCallIndicator.vue](../../app/components/chat/ToolCallIndicator.vue)
- [app/components/chat/__tests__/ToolCallIndicator.test.ts](../../app/components/chat/__tests__/ToolCallIndicator.test.ts)
- [app/components/dashboard/AiPage.vue](../../app/components/dashboard/AiPage.vue)
- [app/components/dashboard/BackgroundLayerEditor.vue](../../app/components/dashboard/BackgroundLayerEditor.vue)
- [app/components/dashboard/Dashboard.vue](../../app/components/dashboard/Dashboard.vue)
- [app/components/dashboard/ThemePage.vue](../../app/components/dashboard/ThemePage.vue)
- [app/components/dashboard/webhooks/WebhookForm.vue](../../app/components/dashboard/webhooks/WebhookForm.vue)
- [app/components/dashboard/webhooks/WebhooksList.vue](../../app/components/dashboard/webhooks/WebhooksList.vue)
- [app/components/dashboard/webhooks/WebhooksPage.vue](../../app/components/dashboard/webhooks/WebhooksPage.vue)
- [app/components/documents/DocumentAiPanel.vue](../../app/components/documents/DocumentAiPanel.vue)
- [app/components/documents/DocumentEditorRoot.vue](../../app/components/documents/DocumentEditorRoot.vue)
- [app/components/documents/DocumentHistoryPanel.vue](../../app/components/documents/DocumentHistoryPanel.vue)
- [app/components/documents/DocumentInspector.vue](../../app/components/documents/DocumentInspector.vue)
- [app/components/files/WorkspaceFilesPane.vue](../../app/components/files/WorkspaceFilesPane.vue)
- [app/components/library/LibraryHome.vue](../../app/components/library/LibraryHome.vue)
- [app/components/marketplace/MarketplaceDiscover.vue](../../app/components/marketplace/MarketplaceDiscover.vue)
- [app/components/modal/ModelCatalog.vue](../../app/components/modal/ModelCatalog.vue)
- [app/components/modal/model-catalog/ModelCatalogProviderLogo.vue](../../app/components/modal/model-catalog/ModelCatalogProviderLogo.vue)
- [app/components/plugins/PluginSetupPage.vue](../../app/components/plugins/PluginSetupPage.vue)
- [app/components/plugins/PluginSetupPanel.vue](../../app/components/plugins/PluginSetupPanel.vue)
- [app/components/prompts/PromptEditor.vue](../../app/components/prompts/PromptEditor.vue)
- [app/components/sidebar/SideNavContentCollapsed.vue](../../app/components/sidebar/SideNavContentCollapsed.vue)
- [app/components/sidebar/SideNavHeader.vue](../../app/components/sidebar/SideNavHeader.vue)
- [app/components/sidebar/SidebarHomePage.vue](../../app/components/sidebar/SidebarHomePage.vue)
- [app/components/sidebar/SidebarProjectRoot.vue](../../app/components/sidebar/SidebarProjectRoot.vue)
- [app/components/sidebar/SidebarProjectsPage.vue](../../app/components/sidebar/SidebarProjectsPage.vue)
- [app/components/sidebar/SidebarProjectsSection.vue](../../app/components/sidebar/SidebarProjectsSection.vue)
- [app/components/sidebar/SidebarUnifiedItem.vue](../../app/components/sidebar/SidebarUnifiedItem.vue)
- [app/components/sidebar/__tests__/SideNavContentCollapsed.test.ts](../../app/components/sidebar/__tests__/SideNavContentCollapsed.test.ts)
- [app/composables/__tests__/useWorkspaceBackup.stream.test.ts](../../app/composables/__tests__/useWorkspaceBackup.stream.test.ts)
- [app/composables/core/__tests__/useMultiPane.test.ts](../../app/composables/core/__tests__/useMultiPane.test.ts)
- [app/composables/core/useMultiPane.ts](../../app/composables/core/useMultiPane.ts)
- [app/composables/core/useWorkspaceBackup.ts](../../app/composables/core/useWorkspaceBackup.ts)
- [app/core/activity/adapters/background-chat.ts](../../app/core/activity/adapters/background-chat.ts)
- [app/core/activity/display.ts](../../app/core/activity/display.ts)
- [app/pages/admin/plugins.vue](../../app/pages/admin/plugins.vue)
- [app/pages/images/index.vue](../../app/pages/images/index.vue)
- [app/plugins/library.client.ts](../../app/plugins/library.client.ts)
- [app/plugins/webhooks-dashboard.client.ts](../../app/plugins/webhooks-dashboard.client.ts)
- [app/theme/blank/components/ChatInput.vue](../../app/theme/blank/components/ChatInput.vue)
- [public/_documentation/docmap.json](../../public/_documentation/docmap.json)
- [public/_documentation/plugins/install-and-manage.md](../../public/_documentation/plugins/install-and-manage.md)
- [public/_documentation/plugins/library.md](../../public/_documentation/plugins/library.md)
- [public/_documentation/start/first-chat.md](../../public/_documentation/start/first-chat.md)
- [public/_documentation/start/overview.md](../../public/_documentation/start/overview.md)
- [public/_documentation/start/projects.md](../../public/_documentation/start/projects.md)
- [tests/e2e/theme-token-migrations.spec.ts](../../tests/e2e/theme-token-migrations.spec.ts)

## Verification

The split retains the previously reviewed implementation. Standalone Polish validation: 185 tests passed across 16 connected files; documentation checks passed (112 files, 100 mapped routes, 20 typechecked examples); configured changed-file ESLint and diff whitespace checks passed. The ESLint configuration excludes Vue and test files. The initial full typecheck found an unchanged invite-token test fixture missing workspaceId; no authentication code is changed. Protected plugin/Marketplace, backup, library, webhook/admin, unavailable-app and tool-status screens lack fresh screenshot proof.
