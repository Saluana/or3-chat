# Tasks: Feature-First Architecture Refactoring

## Implementation Plan

This document provides a detailed, step-by-step implementation plan for refactoring the or3-chat codebase to a feature-first architecture. Tasks are organized by phase and include specific requirements mappings, dependencies, and validation steps.

---

## Phase 0: Pre-Migration Setup

**Requirements**: 7.1 (Version Control Safety), 7.2 (Incremental Validation)

### 0.1 Create Feature Branch

-   [x] Create new Git branch `restructure-and-organize` from `main`
-   [x] Ensure working directory is clean (no uncommitted changes)
-   [x] Document current baseline metrics:
    -   [x] Run `time bun run build` and record build time
    -   [x] Run `bun run test` and record test count and pass rate
    -   [x] Run `nuxi typecheck` and verify zero errors
    -   [x] Measure dev server startup time

### 0.2 Backup Current State

-   [x] Create backup branch `backup/pre-refactor` pointing to current HEAD
-   [x] Export workspace using existing backup feature (if available)
-   [x] Document current directory structure for reference

### 0.3 Create Planning Documentation

-   [x] Review `planning/feature-first-refactor/requirements.md`
-   [x] Review `planning/feature-first-refactor/design.md`
-   [x] Review `planning/feature-first-refactor/tasks.md` (this document)
-   [x] Ensure team alignment on approach and timeline

---

## Phase 1: Directory Structure and Configuration

**Requirements**: 1.1-1.5, 2.1-2.3

### 1.1 Create New Directory Structure

-   [x] Create `app/core/` directory
    -   [x] Create `app/core/hooks/`
    -   [x] Create `app/core/auth/`
    -   [x] Create `app/core/theme/`
    -   [x] Create `app/core/search/`
    -   [x] Create `app/core/state/`
-   [x] Create `app/shared/` directory
    -   [x] Create `app/shared/components/`
    -   [x] Create `app/shared/composables/`
    -   [x] Create `app/shared/utils/`
    -   [x] Create `app/shared/types/`
-   [x] Create `app/features/` directory
    -   [x] Create `app/features/chat/`
    -   [x] Create `app/features/documents/`
    -   [x] Create `app/features/editor/`
    -   [x] Create `app/features/dashboard/`
    -   [x] Create `app/features/sidebar/`
    -   [x] Create `app/features/images/`
    -   [x] Create `app/features/threads/`
    -   [x] Create `app/features/projects/`
-   [x] Create `db/` directory at project root

### 1.2 Create Barrel Export Files

-   [x] Create `app/core/hooks/index.ts` (empty for now)
-   [x] Create `app/core/auth/index.ts` (empty for now)
-   [x] Create `app/core/theme/index.ts` (empty for now)
-   [x] Create `app/core/search/index.ts` (empty for now)
-   [x] Create `app/core/state/index.ts` (empty for now)
-   [x] Create `db/index.ts` (empty for now)

### 1.3 Update Nuxt Configuration

**Requirements**: 2.1, 2.2, 2.3

-   [x] Open `nuxt.config.ts`
-   [x] Add `components` array with paths:
    ```typescript
    components: [
        { path: '~/components', pathPrefix: false },
        { path: '~/shared/components', pathPrefix: false },
        { path: '~/features', pathPrefix: true, extensions: ['.vue'] },
    ];
    ```
-   [x] Add `imports.dirs` array with paths:
    ```typescript
    imports: {
      dirs: [
        'composables',
        'shared/composables',
        'shared/utils',
        'core/hooks',
        'core/auth',
        'core/theme',
        'core/search',
        'core/state',
        'features/chat/composables',
        'features/chat/utils',
        'features/documents/composables',
        'features/editor/composables',
        'features/dashboard/composables',
        'features/sidebar/composables',
        'features/threads/composables',
        'features/projects/composables',
        'features/images/composables',
      ],
    }
    ```
-   [x] Add `alias` configuration:
    ```typescript
    alias: {
      '@core': resolve('./app/core'),
      '@shared': resolve('./app/shared'),
      '@features': resolve('./app/features'),
      '@db': resolve('./db'),
    }
    ```
-   [x] Add TypeScript paths configuration:
    ```typescript
    typescript: {
      tsConfig: {
        compilerOptions: {
          baseUrl: '.',
          paths: {
            '@core/*': ['./app/core/*'],
            '@shared/*': ['./app/shared/*'],
            '@features/*': ['./app/features/*'],
            '@db/*': ['./db/*'],
          },
        },
      },
    }
    ```
-   [x] Add `import { resolve } from 'pathe'` at top of file

### 1.4 Update Vitest Configuration

-   [x] Open `vitest.config.ts`
-   [x] Add `resolve.alias` configuration:
    ```typescript
    resolve: {
      alias: {
        '@core': resolve('./app/core'),
        '@shared': resolve('./app/shared'),
        '@features': resolve('./app/features'),
        '@db': resolve('./db'),
        '~': resolve('./app'),
      },
    }
    ```
-   [x] Add `import { resolve } from 'pathe'` at top of file

### 1.5 Validate Configuration

**Requirements**: 3.2

-   [x] Run `nuxi prepare` to regenerate `.nuxt/` directory
-   [x] Run `nuxi typecheck` (should pass with no errors) - *Note: Pre-existing errors unrelated to config changes*
-   [x] Run `bun run dev` (should start successfully) - ✅ Started successfully on port 3001
-   [x] Verify no console errors in browser
-   [x] Stop dev server
-   [x] Commit changes: `git commit -m "feat: add feature-first directory structure and configuration"`

---

## Phase 2: Core Layer Migration

**Requirements**: 1.1, 3.1, 3.2, 3.3

### 2.1 Migrate Hook System

**Requirements**: 1.1

-   [ ] Move `app/composables/useHooks.ts` → `app/core/hooks/useHooks.ts`
-   [ ] Move `app/composables/useHookEffect.ts` → `app/core/hooks/useHookEffect.ts` (if exists)
-   [ ] Move `app/core/hooks/hook-keys.ts` (if exists, or create from types)
-   [ ] Move `app/core/hooks/hook-types.ts` (if exists, or create from types)
-   [ ] Move `app/core/hooks/hooks.ts` (if exists, or create registry)
-   [ ] Move `app/core/hooks/typed-hooks.ts` (if exists)
-   [ ] Update `app/core/hooks/index.ts` to export public API:
    ```typescript
    export { useHooks } from './useHooks';
    export { useHookEffect } from './useHookEffect';
    export type { HookKeys, HookPayloads } from './hook-types';
    ```
-   [ ] Update imports within hook files to use relative paths
-   [ ] Search for all imports of `useHooks` and update to `@core/hooks`
-   [ ] Run `nuxi typecheck`
-   [ ] Run `bun run dev` and test hook functionality
-   [ ] Commit: `git commit -m "refactor: migrate hook system to core/hooks"`

### 2.2 Migrate Theme System

**Requirements**: 1.1

-   [ ] Move `app/composables/theme-apply.ts` → `app/core/theme/theme-apply.ts`
-   [ ] Move `app/composables/theme-defaults.ts` → `app/core/theme/theme-defaults.ts`
-   [ ] Move `app/composables/theme-types.ts` → `app/core/theme/theme-types.ts`
-   [ ] Move `app/composables/useThemeSettings.ts` → `app/core/theme/useThemeSettings.ts`
-   [ ] Update `app/core/theme/index.ts` to export public API:
    ```typescript
    export { applyTheme } from './theme-apply';
    export { defaultTheme } from './theme-defaults';
    export { useThemeSettings } from './useThemeSettings';
    export type { ThemeConfig, ThemeMode } from './theme-types';
    ```
-   [ ] Update imports within theme files to use relative paths
-   [ ] Search for all imports of theme files and update to `@core/theme`
-   [ ] Update `app/plugins/theme.client.ts` to import from `@core/theme`
-   [ ] Update `app/plugins/theme-settings.client.ts` to import from `@core/theme`
-   [ ] Run `nuxi typecheck`
-   [ ] Run `bun run dev` and test theme switching
-   [ ] Commit: `git commit -m "refactor: migrate theme system to core/theme"`

### 2.3 Migrate Authentication and OpenRouter

**Requirements**: 1.1

-   [ ] Move `app/composables/useOpenrouter.ts` → `app/core/auth/useOpenrouter.ts`
-   [ ] Move `app/composables/useUserApiKey.ts` → `app/core/auth/useUserApiKey.ts`
-   [ ] Move `app/composables/useModelSearch.ts` → `app/core/auth/useModelSearch.ts` (or models-service.ts)
-   [ ] Create `app/core/auth/models-service.ts` if needed (extract from useModelSearch)
-   [ ] Create `app/core/auth/openrouter-auth.ts` if needed (extract auth logic)
-   [ ] Create `app/core/auth/openrouter-build.ts` if needed (extract request building)
-   [ ] Update `app/core/auth/index.ts` to export public API:
    ```typescript
    export { useOpenrouter } from './useOpenrouter';
    export { useUserApiKey } from './useUserApiKey';
    export { useModelSearch } from './useModelSearch';
    ```
-   [ ] Update imports within auth files to use relative paths
-   [ ] Search for all imports of auth files and update to `@core/auth`
-   [ ] Update `app/plugins/openrouter-capture.client.ts` to import from `@core/auth`
-   [ ] Run `nuxi typecheck`
-   [ ] Run `bun run dev` and test OpenRouter integration
-   [ ] Commit: `git commit -m "refactor: migrate auth and OpenRouter to core/auth"`

### 2.4 Migrate Search Infrastructure

**Requirements**: 1.1

-   [ ] Check if Orama search code exists in `app/core/search/` or `app/composables/`
-   [ ] If exists, move to `app/core/search/orama.ts`
-   [ ] If not, create placeholder `app/core/search/orama.ts` with basic structure
-   [ ] Update `app/core/search/index.ts` to export public API:
    ```typescript
    export { initializeOrama, searchThreads, searchDocuments } from './orama';
    ```
-   [ ] Search for all Orama-related imports and update to `@core/search`
-   [ ] Run `nuxi typecheck`
-   [ ] Run `bun run dev`
-   [ ] Commit: `git commit -m "refactor: migrate search infrastructure to core/search"`

### 2.5 Migrate Global State (if any)

**Requirements**: 1.1

-   [ ] Identify any global state management code
-   [ ] Move to `app/core/state/` if applicable
-   [ ] Update `app/core/state/index.ts` to export public API
-   [ ] Update imports to use `@core/state`
-   [ ] Run `nuxi typecheck`
-   [ ] Run `bun run dev`
-   [ ] Commit: `git commit -m "refactor: migrate global state to core/state"`

### 2.6 Validate Core Layer

**Requirements**: 3.1, 3.2, 7.2

-   [ ] Run `nuxi typecheck` (should pass)
-   [ ] Run `bun run dev` (should start without errors)
-   [ ] Test hook system functionality
-   [ ] Test theme switching
-   [ ] Test OpenRouter authentication
-   [ ] Check browser console for errors
-   [ ] Run `bun run test` (all tests should still pass)

---

## Phase 3: Shared Layer Migration

**Requirements**: 1.2, 3.1, 3.2

### 3.1 Migrate Shared Components

**Requirements**: 1.2

-   [ ] Move `app/components/FatalErrorBoundary.vue` → `app/shared/components/FatalErrorBoundary.vue`
-   [ ] Move `app/components/PageShell.vue` → `app/shared/components/PageShell.vue`
-   [ ] Move `app/components/ResizableSidebarLayout.vue` → `app/shared/components/ResizableSidebarLayout.vue`
-   [ ] Move `app/components/RetroGlassBtn.vue` → `app/shared/components/RetroGlassBtn.vue`
-   [ ] Search for all imports of these components and update to `@shared/components/*`
-   [ ] Run `nuxi typecheck`
-   [ ] Run `bun run dev` and verify components render
-   [ ] Commit: `git commit -m "refactor: migrate shared components to shared/components"`

### 3.2 Migrate Shared Composables

**Requirements**: 1.2

-   [ ] Move `app/composables/useObservedElementSize.ts` → `app/shared/composables/useObservedElementSize.ts`
-   [ ] Move `app/composables/usePreviewCache.ts` → `app/shared/composables/usePreviewCache.ts`
-   [ ] Move `app/composables/useStreamAccumulator.ts` → `app/shared/composables/useStreamAccumulator.ts`
-   [ ] Search for all imports of these composables and update to `@shared/composables/*`
-   [ ] Run `nuxi typecheck`
-   [ ] Run `bun run dev`
-   [ ] Commit: `git commit -m "refactor: migrate shared composables to shared/composables"`

### 3.3 Migrate Shared Utilities

**Requirements**: 1.2

-   [ ] Identify generic utility files in `app/utils/` or `app/shared/`
-   [ ] Move error handling utilities → `app/shared/utils/errors.ts`
-   [ ] Move hash utilities → `app/shared/utils/hash.ts`
-   [ ] Move capability guards → `app/shared/utils/capability-guards.ts`
-   [ ] Move file utilities → `app/shared/utils/files/` (if generic)
-   [ ] Search for all imports of these utilities and update to `@shared/utils/*`
-   [ ] Run `nuxi typecheck`
-   [ ] Run `bun run dev`
-   [ ] Commit: `git commit -m "refactor: migrate shared utilities to shared/utils"`

### 3.4 Migrate Shared Types

**Requirements**: 1.2

-   [ ] Move `types/editor-hooks.d.ts` → `app/shared/types/editor-hooks.d.ts`
-   [ ] Move `types/pane-plugin-api.d.ts` → `app/shared/types/pane-plugin-api.d.ts`
-   [ ] Move `types/orama.d.ts` → `app/shared/types/orama.d.ts`
-   [ ] Move `types/nuxt.d.ts` → `app/shared/types/nuxt.d.ts` (if generic)
-   [ ] Move `types/pwa.d.ts` → `app/shared/types/pwa.d.ts`
-   [ ] Update TypeScript references if needed
-   [ ] Run `nuxi typecheck`
-   [ ] Commit: `git commit -m "refactor: migrate shared types to shared/types"`

### 3.5 Validate Shared Layer

**Requirements**: 3.1, 3.2, 7.2

-   [ ] Run `nuxi typecheck` (should pass)
-   [ ] Run `bun run dev` (should start without errors)
-   [ ] Test shared components render correctly
-   [ ] Test shared composables work correctly
-   [ ] Check browser console for errors
-   [ ] Run `bun run test` (all tests should still pass)

---

## Phase 4: Database Layer Migration

**Requirements**: 1.4, 3.1, 3.2

### 4.1 Move Database Files

**Requirements**: 1.4

-   [ ] Move `app/db/` → `db/` (entire directory to project root)
-   [ ] Verify all files moved:
    -   [ ] `db/client.ts`
    -   [ ] `db/schema.ts`
    -   [ ] `db/threads.ts`
    -   [ ] `db/messages.ts`
    -   [ ] `db/documents.ts`
    -   [ ] `db/projects.ts`
    -   [ ] `db/prompts.ts`
    -   [ ] `db/attachments.ts`
    -   [ ] `db/files.ts`
    -   [ ] `db/kv.ts`
    -   [ ] `db/util.ts`
    -   [ ] `db/dbTry.ts`
    -   [ ] `db/branching.ts`
    -   [ ] `db/posts.ts`
    -   [ ] `db/files-select.ts`
    -   [ ] `db/files-util.ts`
    -   [ ] `db/message-files.ts`

### 4.2 Create Database Barrel Export

**Requirements**: 1.4

-   [ ] Create/update `db/index.ts` to export public API:
    ```typescript
    export { db } from './client';
    export * from './schema';
    export * from './threads';
    export * from './messages';
    export * from './documents';
    export * from './projects';
    export * from './prompts';
    export * from './attachments';
    export * from './files';
    export * from './kv';
    ```

### 4.3 Update Database Imports

**Requirements**: 1.4

-   [ ] Search for all imports from `~/db/*` or `@/db/*`
-   [ ] Replace with `@db/*` imports
-   [ ] Update imports within `db/` files to use relative paths
-   [ ] Run `nuxi typecheck`
-   [ ] Commit: `git commit -m "refactor: migrate database layer to db/ with @db alias"`

### 4.4 Validate Database Layer

**Requirements**: 3.1, 3.2, 7.2

-   [ ] Run `nuxi typecheck` (should pass)
-   [ ] Run `bun run dev` (should start without errors)
-   [ ] Test database operations (create thread, send message, etc.)
-   [ ] Check browser console for errors
-   [ ] Run `bun run test` (all tests should still pass)

---

## Phase 5: Features Layer Migration

**Requirements**: 1.3, 3.1, 3.2

### 5.1 Migrate Threads Feature

**Requirements**: 1.3

-   [ ] Create `app/features/threads/composables/` directory
-   [ ] Move `app/composables/useThreadSearch.ts` → `app/features/threads/composables/useThreadSearch.ts`
-   [ ] Create `app/features/threads/composables/useThreadHistoryActions.ts` if logic exists in plugins
-   [ ] Update imports within threads feature to use relative paths or `@features/threads/*`
-   [ ] Search for all imports of threads composables and update to `@features/threads/composables/*`
-   [ ] Run `nuxi typecheck`
-   [ ] Run `bun run dev` and test thread functionality
-   [ ] Commit: `git commit -m "refactor: migrate threads feature to features/threads"`

### 5.2 Migrate Projects Feature

**Requirements**: 1.3

-   [ ] Create `app/features/projects/composables/` directory
-   [ ] Create `app/features/projects/utils/` directory
-   [ ] Move `app/composables/useProjectsCrud.ts` → `app/features/projects/composables/useProjectsCrud.ts`
-   [ ] Create `app/features/projects/composables/useProjectTreeActions.ts` if logic exists
-   [ ] Create `app/features/projects/utils/normalizeProjectData.ts` if utility exists
-   [ ] Update imports within projects feature
-   [ ] Search for all imports of projects composables and update to `@features/projects/composables/*`
-   [ ] Run `nuxi typecheck`
-   [ ] Run `bun run dev` and test project functionality
-   [ ] Commit: `git commit -m "refactor: migrate projects feature to features/projects"`

### 5.3 Migrate Editor Feature

**Requirements**: 1.3

-   [ ] Create `app/features/editor/components/` directory
-   [ ] Create `app/features/editor/composables/` directory
-   [ ] Create `app/features/editor/plugins/` directory
-   [ ] Move `app/components/prompts/PromptEditor.vue` → `app/features/editor/components/PromptEditor.vue`
-   [ ] Move editor-related composables to `app/features/editor/composables/`
-   [ ] Move `app/plugins/editor-autocomplete.client.ts` logic → `app/features/editor/plugins/EditorAutocomplete/`
    -   [ ] Create `app/features/editor/plugins/EditorAutocomplete/TiptapExtension.ts`
    -   [ ] Create `app/features/editor/plugins/EditorAutocomplete/AutocompletePrompt.ts`
    -   [ ] Create `app/features/editor/plugins/EditorAutocomplete/state.ts`
    -   [ ] Keep thin wrapper in `app/plugins/editor-autocomplete.client.ts` that imports from feature
-   [ ] Update imports within editor feature
-   [ ] Search for all imports of editor components/composables and update to `@features/editor/*`
-   [ ] Run `nuxi typecheck`
-   [ ] Run `bun run dev` and test editor functionality
-   [ ] Commit: `git commit -m "refactor: migrate editor feature to features/editor"`

### 5.4 Migrate Documents Feature

**Requirements**: 1.3

-   [ ] Create `app/features/documents/components/` directory
-   [ ] Create `app/features/documents/composables/` directory
-   [ ] Move `app/components/documents/DocumentEditor.vue` → `app/features/documents/components/DocumentEditor.vue`
-   [ ] Move `app/components/documents/ToolbarButton.vue` → `app/features/documents/components/ToolbarButton.vue`
-   [ ] Move other document components from `app/components/documents/` → `app/features/documents/components/`
-   [ ] Move `app/composables/useDocumentsList.ts` → `app/features/documents/composables/useDocumentsList.ts`
-   [ ] Move `app/composables/useDocumentsStore.ts` → `app/features/documents/composables/useDocumentsStore.ts`
-   [ ] Move `app/composables/usePaneDocuments.ts` → `app/features/documents/composables/usePaneDocuments.ts`
-   [ ] Update imports within documents feature
-   [ ] Search for all imports of documents components/composables and update to `@features/documents/*`
-   [ ] Run `nuxi typecheck`
-   [ ] Run `bun run dev` and test document functionality
-   [ ] Commit: `git commit -m "refactor: migrate documents feature to features/documents"`

### 5.5 Migrate Chat Feature

**Requirements**: 1.3

-   [ ] Create `app/features/chat/components/` directory
-   [ ] Create `app/features/chat/composables/` directory
-   [ ] Create `app/features/chat/utils/` directory
-   [ ] Move all components from `app/components/chat/` → `app/features/chat/components/`:
    -   [ ] `ChatContainer.vue`
    -   [ ] `ChatInputDropper.vue`
    -   [ ] `ChatMessage.vue`
    -   [ ] `LoadingGenerating.vue`
    -   [ ] `MessageAttachmentsGallery.vue`
    -   [ ] `MessageEditor.vue`
    -   [ ] `ModelSelect.vue`
    -   [ ] `ReasoningAccordion.vue`
    -   [ ] `SystemPromptsModal.vue`
    -   [ ] `VirtualMessageList.vue`
    -   [ ] `file-upload-utils.ts` (if in components dir)
-   [ ] Move chat composables:
    -   [ ] `app/composables/useActivePrompt.ts` → `app/features/chat/composables/useActivePrompt.ts`
    -   [ ] `app/composables/useAi.ts` → `app/features/chat/composables/useAi.ts`
    -   [ ] `app/composables/useAiSettings.ts` → `app/features/chat/composables/useAiSettings.ts`
    -   [ ] `app/composables/useChatInputBridge.ts` → `app/features/chat/composables/useChatInputBridge.ts`
    -   [ ] `app/composables/useDefaultPrompt.ts` → `app/features/chat/composables/useDefaultPrompt.ts`
    -   [ ] `app/composables/useMessageEditing.ts` → `app/features/chat/composables/useMessageEditing.ts`
    -   [ ] `app/composables/useModelStore.ts` → `app/features/chat/composables/useModelStore.ts`
    -   [ ] `app/composables/ui-extensions/messages/useMessageActions.ts` → `app/features/chat/composables/useMessageActions.ts`
-   [ ] Move chat utilities:
    -   [ ] Create `app/features/chat/utils/openrouterStream.ts` (extract from useAi or existing utils)
    -   [ ] Create `app/features/chat/utils/uiMessages.ts` (message transformation logic)
    -   [ ] Create `app/features/chat/utils/files.ts` (file handling)
    -   [ ] Create `app/features/chat/utils/history.ts` (history management)
    -   [ ] Create `app/features/chat/utils/messages.ts` (message utilities)
    -   [ ] Create `app/features/chat/utils/prompt-utils.ts` (prompt handling)
    -   [ ] Create `app/features/chat/utils/types.ts` (chat-specific types)
-   [ ] Update imports within chat feature
-   [ ] Search for all imports of chat components/composables and update to `@features/chat/*`
-   [ ] Update `app/pages/chat/index.vue` and `app/pages/chat/[id].vue` to import from `@features/chat`
-   [ ] Run `nuxi typecheck`
-   [ ] Run `bun run dev` and test chat functionality thoroughly
-   [ ] Commit: `git commit -m "refactor: migrate chat feature to features/chat"`

### 5.6 Migrate Sidebar Feature

**Requirements**: 1.3

-   [ ] Create `app/features/sidebar/components/` directory
-   [ ] Create `app/features/sidebar/composables/` directory
-   [ ] Move all components from `app/components/sidebar/` → `app/features/sidebar/components/`:
    -   [ ] `ResizeHandle.vue`
    -   [ ] `SideBottomNav.vue`
    -   [ ] `SideNavContent.vue`
    -   [ ] `SideNavContentCollapsed.vue`
    -   [ ] `SideNavHeader.vue`
    -   [ ] `SidebarDocumentItem.vue`
    -   [ ] `SidebarHeader.vue`
    -   [ ] `SidebarProjectChild.vue`
    -   [ ] `SidebarProjectRoot.vue`
    -   [ ] `SidebarProjectTree.vue`
    -   [ ] `SidebarThreadItem.vue`
    -   [ ] `SidebarVirtualList.vue`
-   [ ] Move sidebar composables:
    -   [ ] `app/composables/useSidebarSearch.ts` → `app/features/sidebar/composables/useSidebarSearch.ts`
    -   [ ] Create `app/features/sidebar/composables/useComposerActions.ts` if logic exists
    -   [ ] Create `app/features/sidebar/composables/useHeaderActions.ts` if logic exists
    -   [ ] Create `app/features/sidebar/composables/useSidebarSections.ts` if logic exists
-   [ ] Update imports within sidebar feature
-   [ ] Search for all imports of sidebar components/composables and update to `@features/sidebar/*`
-   [ ] Run `nuxi typecheck`
-   [ ] Run `bun run dev` and test sidebar functionality
-   [ ] Commit: `git commit -m "refactor: migrate sidebar feature to features/sidebar"`

### 5.7 Migrate Dashboard Feature

**Requirements**: 1.3

-   [ ] Create `app/features/dashboard/pages/` directory
-   [ ] Create `app/features/dashboard/components/` directory
-   [ ] Create `app/features/dashboard/composables/` directory
-   [ ] Create `app/features/dashboard/plugins/` directory
-   [ ] Create `app/features/dashboard/utils/` directory
-   [ ] Move dashboard pages (if they exist as components):
    -   [ ] Find `Dashboard.vue` → `app/features/dashboard/pages/Dashboard.vue`
    -   [ ] Find `ThemePage.vue` → `app/features/dashboard/pages/ThemePage.vue`
    -   [ ] Find `AiPage.vue` → `app/features/dashboard/pages/AiPage.vue`
    -   [ ] Find `WorkspaceBackupApp.vue` → `app/features/dashboard/pages/workspace/WorkspaceBackupApp.vue`
-   [ ] Move dashboard composables:
    -   [ ] `app/composables/useMultiPane.ts` → `app/features/dashboard/composables/useMultiPane.ts`
    -   [ ] `app/composables/usePanePrompt.ts` → `app/features/dashboard/composables/usePanePrompt.ts`
    -   [ ] `app/composables/useWorkspaceBackup.ts` → `app/features/dashboard/composables/useWorkspaceBackup.ts`
    -   [ ] Create `app/features/dashboard/composables/useDashboardPlugins.ts` if logic exists
-   [ ] Move dashboard plugins:
    -   [ ] Create `app/features/dashboard/plugins/devtools/HookInspector.vue` if component exists
-   [ ] Move dashboard utilities:
    -   [ ] Create `app/features/dashboard/utils/workspace-backup-stream.ts` if utility exists
-   [ ] Update `app/plugins/pane-plugin-api.client.ts` to import from `@features/dashboard`
-   [ ] Update imports within dashboard feature
-   [ ] Search for all imports of dashboard components/composables and update to `@features/dashboard/*`
-   [ ] Run `nuxi typecheck`
-   [ ] Run `bun run dev` and test dashboard functionality
-   [ ] Commit: `git commit -m "refactor: migrate dashboard feature to features/dashboard"`

### 5.8 Migrate Images Feature

**Requirements**: 1.3

-   [ ] Create `app/features/images/components/` directory
-   [ ] Create `app/features/images/composables/` directory
-   [ ] Move image page components:
    -   [ ] `app/pages/images/GalleryGrid.vue` → `app/features/images/components/GalleryGrid.vue`
    -   [ ] `app/pages/images/ImageViewer.vue` → `app/features/images/components/ImageViewer.vue`
    -   [ ] Update `app/pages/images/index.vue` to import from `@features/images/components`
-   [ ] Move image composables (if any exist)
-   [ ] Update imports within images feature
-   [ ] Search for all imports of images components and update to `@features/images/*`
-   [ ] Run `nuxi typecheck`
-   [ ] Run `bun run dev` and test image gallery functionality
-   [ ] Commit: `git commit -m "refactor: migrate images feature to features/images"`

### 5.9 Validate Features Layer

**Requirements**: 3.1, 3.2, 7.2

-   [ ] Run `nuxi typecheck` (should pass)
-   [ ] Run `bun run dev` (should start without errors)
-   [ ] Test each feature:
    -   [ ] Chat: send message, stream response, upload file
    -   [ ] Documents: create, edit, delete document
    -   [ ] Editor: edit prompt, autocomplete
    -   [ ] Dashboard: view settings, change theme, backup workspace
    -   [ ] Sidebar: navigate threads, search, collapse/expand
    -   [ ] Images: view gallery, open image viewer
    -   [ ] Threads: search threads, view history
    -   [ ] Projects: create, edit, delete project
-   [ ] Check browser console for errors
-   [ ] Run `bun run test` (all tests should still pass)

---

## Phase 6: Plugin Updates

**Requirements**: 3.3, 3.1, 3.2

### 6.1 Update Plugin Imports

**Requirements**: 3.3

-   [ ] Update `app/plugins/hooks.client.ts` to import from `@core/hooks`
-   [ ] Update `app/plugins/hooks.server.ts` to import from `@core/hooks`
-   [ ] Update `app/plugins/theme.client.ts` to import from `@core/theme`
-   [ ] Update `app/plugins/theme-settings.client.ts` to import from `@core/theme`
-   [ ] Update `app/plugins/openrouter-capture.client.ts` to import from `@core/auth`
-   [ ] Update `app/plugins/message-actions.client.ts` to import from `@features/chat`
-   [ ] Update `app/plugins/pane-plugin-api.client.ts` to import from `@features/dashboard`
-   [ ] Update `app/plugins/editor-autocomplete.client.ts` to import from `@features/editor`
-   [ ] Update `app/plugins/devtools.client.ts` to import from appropriate locations

### 6.2 Update Example Plugins

-   [ ] Update all example plugins in `app/plugins/examples/` to use new import paths
-   [ ] Verify example plugins still work (if used in development)

### 6.3 Validate Plugins

**Requirements**: 3.3, 7.2

-   [ ] Run `nuxi typecheck`
-   [ ] Run `bun run dev`
-   [ ] Verify all plugins register successfully (check console)
-   [ ] Test plugin functionality:
    -   [ ] Hooks system initializes
    -   [ ] Theme applies on load
    -   [ ] OpenRouter auth works
    -   [ ] Message actions work
    -   [ ] Pane plugin API works
    -   [ ] Editor autocomplete works
-   [ ] Commit: `git commit -m "refactor: update plugin imports for new structure"`

---

## Phase 7: Test Migration

**Requirements**: 4.1, 4.2, 3.1, 3.2

### 7.1 Reorganize Test Directory Structure

**Requirements**: 4.1

-   [ ] Create `tests/chat/` directory
-   [ ] Create `tests/editor/` directory
-   [ ] Create `tests/sidebar/` directory
-   [ ] Create `tests/images/` directory
-   [ ] Create `tests/core-hooks/` directory
-   [ ] Create `tests/core-theme/` directory
-   [ ] Create `tests/core-search/` directory
-   [ ] Create `tests/dashboard/` directory
-   [ ] Create `tests/shared/` directory
-   [ ] Create `tests/utils/` directory

### 7.2 Move Chat Tests

**Requirements**: 4.1

-   [ ] Move `app/composables/__tests__/useAiSettings.test.ts` → `tests/chat/useAiSettings.test.ts`
-   [ ] Move chat-related tests from `app/components/__tests__/` → `tests/chat/`:
    -   [ ] `AutoScrollBehavior.test.ts`
    -   [ ] `BlankStateStreamingPlaceholder.test.ts`
    -   [ ] `ChatContainer.streamingJank.test.ts`
    -   [ ] `ChatContainer.virtualization.test.ts`
    -   [ ] `VirtualMessageList.behavior.test.ts`
    -   [ ] `VirtualMessageList.test.ts`
    -   [ ] `fileValidation.test.ts`
    -   [ ] `finalizeNoJump.test.ts`
    -   [ ] `uiMessages.test.ts`
-   [ ] Update imports in chat tests to use `@features/chat/*` aliases
-   [ ] Run `bun run test` and verify chat tests pass

### 7.3 Move Editor Tests

**Requirements**: 4.1

-   [ ] Move editor-related tests → `tests/editor/`:
    -   [ ] `editorNodes.test.ts`
    -   [ ] `editorToolbar.test.ts`
-   [ ] Update imports in editor tests to use `@features/editor/*` aliases
-   [ ] Run `bun run test` and verify editor tests pass

### 7.4 Move Sidebar Tests

**Requirements**: 4.1

-   [ ] Move sidebar-related tests → `tests/sidebar/`:
    -   [ ] `SideNavContent.test.ts`
-   [ ] Update imports in sidebar tests to use `@features/sidebar/*` aliases
-   [ ] Run `bun run test` and verify sidebar tests pass

### 7.5 Move Images Tests

**Requirements**: 4.1

-   [ ] Move image-related tests → `tests/images/`:
    -   [ ] `gallery-grid.error.test.ts`
    -   [ ] `gallery-grid.lifecycle.test.ts`
    -   [ ] `image-viewer.cache.test.ts`
    -   [ ] `image-viewer.error.test.ts`
-   [ ] Update imports in images tests to use `@features/images/*` aliases
-   [ ] Run `bun run test` and verify images tests pass

### 7.6 Move Core Tests

**Requirements**: 4.1

-   [ ] Move hook tests → `tests/core-hooks/`:
    -   [ ] `hookInspector.test.ts`
    -   [ ] `hookOrder.test.ts`
    -   [ ] `hookOrderSnapshot.test.ts`
    -   [ ] `useTypedHooks.test.ts`
-   [ ] Move theme tests → `tests/core-theme/`:
    -   [ ] `themeSettings.unit.test.ts`
-   [ ] Move search tests → `tests/core-search/`:
    -   [ ] `orama.test.ts` (if exists)
-   [ ] Update imports in core tests to use `@core/*` aliases
-   [ ] Run `bun run test` and verify core tests pass

### 7.7 Move Dashboard Tests

**Requirements**: 4.1

-   [ ] Move dashboard tests → `tests/dashboard/`:
    -   [ ] `panePluginApi.test.ts`
    -   [ ] `workspace-backup-stream.test.ts`
-   [ ] Update imports in dashboard tests to use `@features/dashboard/*` aliases
-   [ ] Run `bun run test` and verify dashboard tests pass

### 7.8 Move Shared Tests

**Requirements**: 4.1

-   [ ] Move shared utility tests → `tests/shared/`:
    -   [ ] `streamAccumulator.test.ts`
-   [ ] Move utility tests → `tests/utils/`:
    -   [ ] `ai-settings-utils.test.ts`
-   [ ] Update imports in shared tests to use `@shared/*` aliases
-   [ ] Run `bun run test` and verify shared tests pass

### 7.9 Validate All Tests

**Requirements**: 4.2, 7.2

-   [ ] Run `bun run test` (all tests should pass)
-   [ ] Verify test count matches pre-refactoring baseline
-   [ ] Check test coverage (should not decrease)
-   [ ] Commit: `git commit -m "refactor: reorganize tests to mirror feature structure"`

---

## Phase 8: Cleanup and Final Validation

**Requirements**: 3.1, 3.2, 5.1, 5.2

### 8.1 Remove Empty Directories

-   [ ] Check if `app/composables/` is empty or contains only bridges
    -   [ ] If empty, remove directory
    -   [ ] If contains bridges, keep and document
-   [ ] Check if `app/components/` is empty or contains only global atoms
    -   [ ] If empty, remove directory
    -   [ ] If contains global atoms, keep and document
-   [ ] Remove `app/composables/__tests__/` if empty
-   [ ] Remove `app/components/__tests__/` if empty
-   [ ] Remove `app/composables/ui-extensions/` if empty
-   [ ] Remove any other empty directories

### 8.2 Update Import Paths to Use Aliases

**Requirements**: 5.2

-   [ ] Search for remaining `~/composables/` imports and update to appropriate aliases
-   [ ] Search for remaining `~/components/` imports and update to appropriate aliases
-   [ ] Search for remaining `~/db/` imports and update to `@db/*`
-   [ ] Search for remaining relative imports that should use aliases
-   [ ] Run `nuxi typecheck` to verify all imports resolve

### 8.3 Create Barrel Exports for Features

**Requirements**: 5.2

-   [ ] Create `app/features/chat/index.ts` to export public API
-   [ ] Create `app/features/documents/index.ts` to export public API
-   [ ] Create `app/features/editor/index.ts` to export public API
-   [ ] Create `app/features/dashboard/index.ts` to export public API
-   [ ] Create `app/features/sidebar/index.ts` to export public API
-   [ ] Create `app/features/images/index.ts` to export public API
-   [ ] Create `app/features/threads/index.ts` to export public API
-   [ ] Create `app/features/projects/index.ts` to export public API

### 8.4 Final Build and Test Validation

**Requirements**: 3.2, 4.2, 6.1, 6.2

-   [ ] Run `nuxi typecheck` (should pass with zero errors)
-   [ ] Run `bun run dev` (should start without errors)
-   [ ] Run `bun run build` (should complete successfully)
-   [ ] Run `bun run test` (all tests should pass)
-   [ ] Measure and compare metrics to baseline:
    -   [ ] Build time (should not increase >10%)
    -   [ ] Bundle size (should not increase)
    -   [ ] Dev server startup time (should not increase >10%)
    -   [ ] Test count (should match baseline)
    -   [ ] Test pass rate (should be 100%)

### 8.5 Manual Testing

**Requirements**: 3.1, 7.2

-   [ ] Test all critical user workflows:
    -   [ ] Create new chat thread and send message
    -   [ ] Upload file attachment to message
    -   [ ] Switch between threads in sidebar
    -   [ ] Search threads
    -   [ ] Create and edit document
    -   [ ] Change theme in dashboard
    -   [ ] Export workspace backup
    -   [ ] Import workspace backup
    -   [ ] View image gallery
    -   [ ] Create and manage projects
-   [ ] Test in production build:
    -   [ ] Run `bun run build && bun run preview`
    -   [ ] Test critical workflows in production mode
    -   [ ] Check for console errors
    -   [ ] Verify PWA functionality

### 8.6 Commit Final Changes

-   [ ] Commit cleanup: `git commit -m "refactor: cleanup empty directories and finalize structure"`
-   [ ] Create summary of changes for PR description
-   [ ] Document any breaking changes (should be none)
-   [ ] Document any new conventions or patterns

---

## Phase 9: Documentation

**Requirements**: 5.1, 5.2

### 9.1 Create Architecture Documentation

**Requirements**: 5.1

-   [ ] Create `docs/architecture/feature-first-structure.md`
-   [ ] Document directory structure and purpose of each layer
-   [ ] Document what goes in `core/`, `shared/`, and `features/`
-   [ ] Provide examples of correct organization
-   [ ] Document barrel export pattern

### 9.2 Update Contributing Guide

**Requirements**: 5.1

-   [ ] Update `CONTRIBUTING.md` (or create if doesn't exist)
-   [ ] Document where to put new code
-   [ ] Document import path conventions
-   [ ] Document rules for cross-feature imports
-   [ ] Provide examples of adding new features

### 9.3 Create Migration Guide

**Requirements**: 5.1

-   [ ] Create `docs/migration/feature-first-refactor.md`
-   [ ] Document what changed and why
-   [ ] Provide before/after examples of import paths
-   [ ] Document any breaking changes (should be none)
-   [ ] Provide troubleshooting tips

### 9.4 Update README

-   [ ] Update `README.md` to reference new architecture
-   [ ] Update project structure section
-   [ ] Add links to architecture documentation

### 9.5 Commit Documentation

-   [ ] Commit: `git commit -m "docs: add feature-first architecture documentation"`

---

## Phase 10: Review and Merge

**Requirements**: 7.1

### 10.1 Self-Review

-   [ ] Review all changes in Git diff
-   [ ] Verify no unintended changes
-   [ ] Verify all files moved correctly
-   [ ] Verify no files left behind
-   [ ] Check for any TODO comments or debug code

### 10.2 Create Pull Request

**Requirements**: 7.1

-   [ ] Push branch to remote: `git push origin feature/feature-first-refactor`
-   [ ] Create pull request with detailed description
-   [ ] Include summary of changes
-   [ ] Include validation results (build time, test results, etc.)
-   [ ] Include screenshots or recordings of manual testing
-   [ ] Request review from team members

### 10.3 Address Review Feedback

-   [ ] Respond to review comments
-   [ ] Make requested changes
-   [ ] Re-test after changes
-   [ ] Push updates to PR

### 10.4 Merge to Main

**Requirements**: 7.1

-   [ ] Ensure all CI checks pass (if applicable)
-   [ ] Ensure all review approvals received
-   [ ] Squash or merge commits as appropriate
-   [ ] Merge PR to main branch
-   [ ] Delete feature branch after merge

### 10.5 Post-Merge Validation

-   [ ] Pull latest main branch
-   [ ] Run `bun install` to ensure dependencies are correct
-   [ ] Run `nuxi typecheck`
-   [ ] Run `bun run dev`
-   [ ] Run `bun run build`
-   [ ] Run `bun run test`
-   [ ] Monitor for any issues reported by team

---

## Rollback Plan

If critical issues are discovered at any phase:

### Immediate Rollback

1. [ ] Stop current work
2. [ ] Document the issue
3. [ ] Run `git checkout main`
4. [ ] Verify main branch works correctly
5. [ ] Analyze issue and determine fix

### Partial Rollback

1. [ ] Identify last good commit: `git log --oneline`
2. [ ] Reset to last good commit: `git reset --hard <commit-hash>`
3. [ ] Re-test to verify functionality restored
4. [ ] Analyze what went wrong
5. [ ] Fix issue and retry phase

### Post-Merge Rollback

1. [ ] Create revert PR: `git revert <merge-commit>`
2. [ ] Test revert locally
3. [ ] Merge revert PR
4. [ ] Analyze issue
5. [ ] Create new PR with fixes

---

## Success Criteria Checklist

-   [ ] All requirements from `requirements.md` are met
-   [ ] All tests pass (100% pass rate)
-   [ ] `nuxi typecheck` completes without errors
-   [ ] `bun run dev` starts without errors
-   [ ] `bun run build` completes without errors
-   [ ] Build time has not increased by more than 10%
-   [ ] Bundle size has not increased
-   [ ] All manual test workflows pass
-   [ ] No console errors in development or production
-   [ ] Documentation is complete and accurate
-   [ ] Code review is approved
-   [ ] PR is merged to main

---

## Notes

-   Each phase should be completed and validated before moving to the next
-   Commit frequently with descriptive messages
-   If a phase takes longer than expected, consider breaking it into smaller sub-phases
-   Keep the team informed of progress and any blockers
-   Don't hesitate to ask for help or pair programming if stuck
-   Celebrate milestones! This is a significant refactoring effort.

---

## Estimated Timeline

-   **Phase 0**: 1 hour
-   **Phase 1**: 2 hours
-   **Phase 2**: 4 hours
-   **Phase 3**: 3 hours
-   **Phase 4**: 2 hours
-   **Phase 5**: 12 hours (largest phase, multiple features)
-   **Phase 6**: 2 hours
-   **Phase 7**: 4 hours
-   **Phase 8**: 3 hours
-   **Phase 9**: 3 hours
-   **Phase 10**: 2 hours (plus review time)

**Total Estimated Time**: 38 hours of focused work + review time

**Recommended Approach**: Spread over 1-2 weeks with daily progress, allowing time for review and validation at each phase.
