# UI audit: Additions

This PR targets the Polish branch (PR #245) and should merge after Polish. Its diff contains only the additions below; the combined application source matches the reviewed pre-split implementation at edfc7c66.

- Added visible Trash and Back to files controls, with creation and upload controls confined to the active Files view.
- Added Manage in Installed to Marketplace plugin details.
- Added an administrator setup link for unavailable Marketplace library connections.
- Added numbering to distinguish multiple unsent chat tabs consistently across desktop and phone controls.
- Added expandable app and activity details for technical identifiers.
- Added direct launching of ready registered trusted workspace apps from Configure while preserving portable selection handling.
- Added the focused browser regression command, 20-image gallery and combined change inventory.

The gallery shows the combined Polish and Additions state; protected plugin/Marketplace, library, webhook/admin, backup, unavailable-app and tool-status states still lack fresh screenshot proof.

## Changed files

- [app/components/PaneUnknown.vue](../../app/components/PaneUnknown.vue)
- [app/components/activity/ActivityDetailPane.vue](../../app/components/activity/ActivityDetailPane.vue)
- [app/components/files/WorkspaceFilesPane.vue](../../app/components/files/WorkspaceFilesPane.vue)
- [app/components/library/LibraryHome.vue](../../app/components/library/LibraryHome.vue)
- [app/components/marketplace/MarketplaceDiscover.vue](../../app/components/marketplace/MarketplaceDiscover.vue)
- [app/components/plugins/PluginSetupPage.vue](../../app/components/plugins/PluginSetupPage.vue)
- [app/components/plugins/PluginSetupPanel.vue](../../app/components/plugins/PluginSetupPanel.vue)
- [app/components/plugins/__tests__/PluginSetupPanel.test.ts](../../app/components/plugins/__tests__/PluginSetupPanel.test.ts)
- [app/components/workspace-tabs/WorkspaceChrome.vue](../../app/components/workspace-tabs/WorkspaceChrome.vue)
- [app/components/workspace-tabs/WorkspaceTabBar.vue](../../app/components/workspace-tabs/WorkspaceTabBar.vue)
- [app/components/workspace-tabs/WorkspaceTabSwitcher.vue](../../app/components/workspace-tabs/WorkspaceTabSwitcher.vue)
- [app/core/workspace-tabs/__tests__/display.test.ts](../../app/core/workspace-tabs/__tests__/display.test.ts)
- [app/core/workspace-tabs/display.ts](../../app/core/workspace-tabs/display.ts)
- [package.json](../../package.json)
- [planning/ui-audit/changes.md](../../planning/ui-audit/changes.md)
- [planning/ui-audit/evidence/activity-failed.jpg](../../planning/ui-audit/evidence/activity-failed.jpg)
- [planning/ui-audit/evidence/ai-settings.jpg](../../planning/ui-audit/evidence/ai-settings.jpg)
- [planning/ui-audit/evidence/dashboard-settings.jpg](../../planning/ui-audit/evidence/dashboard-settings.jpg)
- [planning/ui-audit/evidence/desktop-chat-sidebar.jpg](../../planning/ui-audit/evidence/desktop-chat-sidebar.jpg)
- [planning/ui-audit/evidence/document-history.jpg](../../planning/ui-audit/evidence/document-history.jpg)
- [planning/ui-audit/evidence/document-info.jpg](../../planning/ui-audit/evidence/document-info.jpg)
- [planning/ui-audit/evidence/document-outline.jpg](../../planning/ui-audit/evidence/document-outline.jpg)
- [planning/ui-audit/evidence/draft-tabs.png](../../planning/ui-audit/evidence/draft-tabs.png)
- [planning/ui-audit/evidence/files.jpg](../../planning/ui-audit/evidence/files.jpg)
- [planning/ui-audit/evidence/images.jpg](../../planning/ui-audit/evidence/images.jpg)
- [planning/ui-audit/evidence/index.html](../../planning/ui-audit/evidence/index.html)
- [planning/ui-audit/evidence/phone-catalog.png](../../planning/ui-audit/evidence/phone-catalog.png)
- [planning/ui-audit/evidence/phone-document-history.jpg](../../planning/ui-audit/evidence/phone-document-history.jpg)
- [planning/ui-audit/evidence/phone-model.png](../../planning/ui-audit/evidence/phone-model.png)
- [planning/ui-audit/evidence/phone-settings.jpg](../../planning/ui-audit/evidence/phone-settings.jpg)
- [planning/ui-audit/evidence/project-chat.jpg](../../planning/ui-audit/evidence/project-chat.jpg)
- [planning/ui-audit/evidence/project-knowledge.jpg](../../planning/ui-audit/evidence/project-knowledge.jpg)
- [planning/ui-audit/evidence/prompt-editor.png](../../planning/ui-audit/evidence/prompt-editor.png)
- [planning/ui-audit/evidence/system-prompts.jpg](../../planning/ui-audit/evidence/system-prompts.jpg)
- [planning/ui-audit/evidence/theme-settings.jpg](../../planning/ui-audit/evidence/theme-settings.jpg)
- [planning/ui-audit/evidence/trash.jpg](../../planning/ui-audit/evidence/trash.jpg)
- [public/_documentation/docmap.json](../../public/_documentation/docmap.json)
- [public/_documentation/plugins/install-and-manage.md](../../public/_documentation/plugins/install-and-manage.md)
- [public/_documentation/start/development-setup.md](../../public/_documentation/start/development-setup.md)
- [public/_documentation/start/overview.md](../../public/_documentation/start/overview.md)
- [tests/e2e/theme-token-migrations.spec.ts](../../tests/e2e/theme-token-migrations.spec.ts)

## Verification

Additions validation: 59 tests passed across 7 connected files; all 14 isolated Chromium journeys passed (models, draft restoration, prompt persistence, compact native controls and responsive layouts); application typecheck, public documentation checks, configured changed-file ESLint and whitespace checks passed. ESLint excludes Vue and test files. No new application behavior was introduced during the split.

[Combined inventory](changes.md) · [Screenshot gallery](evidence/index.html) · [Polish PR #245](https://github.com/Saluana/or3-chat/pull/245)
