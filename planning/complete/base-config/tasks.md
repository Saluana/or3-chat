# OR3 Base Config System - Implementation Tasks

## 1. Core Configuration Types and Validation
**Requirements: 6.1, 6.2**

- [x] 1.1 Create TypeScript interfaces
  - [x] Create `types/or3-config.d.ts` with `Or3Config` and `Or3ConfigOptions` interfaces
  - [x] Export all types from module

- [x] 1.2 Implement Zod validation schema
  - [x] Create `utils/or3-config.ts`
  - [x] Define `or3ConfigSchema` with all fields and defaults
  - [x] Implement `mergeWithDefaults()` function for deep merging
  - [x] Implement `validateConfig()` function with strict mode support
  - [x] Implement `formatConfigErrors()` for user-friendly error messages
  - [x] Export `defineOr3Config()` helper and `DEFAULT_OR3_CONFIG`

- [x] 1.3 Create default config file
  - [x] Create `config.or3.ts` in project root
  - [x] Use `defineOr3Config()` with sensible defaults
  - [x] Document environment variable overrides

---

## 2. Composable Access Layer
**Requirements: 5.2**

- [x] 2.1 Create `useOr3Config` composable
  - [x] Create `app/composables/useOr3Config.ts`
  - [x] Import and re-export validated config as readonly
  - [x] Ensure SSR compatibility (same values on server and client)

- [x] 2.2 Create feature flag helpers
  - [x] Add `isFeatureEnabled(featureName: string): boolean` helper
  - [x] Add type-safe feature names

---

## 3. Feature Gating Implementation
**Requirements: 2.1, 2.2, 2.3, 2.4, 2.5**

- [x] 3.1 Modify `mentions.client.ts` plugin
  - [x] Import `useOr3Config` composable
  - [x] Check `features.mentions.enabled` master flag (early return if false)
  - [x] Filter document sources based on `features.mentions.documents`
  - [x] Filter conversation sources based on `features.mentions.conversations`

- [x] 3.2 Modify `workflows.client.ts` plugin
  - [x] Import `useOr3Config` composable
  - [x] Check `features.workflows.enabled` master flag (early return if false)
  - [x] Check `features.workflows.execution` before allowing workflow runs

- [x] 3.3 Modify `workflow-slash-commands.client.ts` plugin
  - [x] Check `features.workflows.slashCommands` flag
  - [x] Skip slash command registration if disabled

- [x] 3.4 Modify workflow editor components
  - [x] Check `features.workflows.editor` flag
  - [x] Hide editor UI and "New Workflow" buttons when disabled
  - [x] Show read-only view of existing workflows

- [x] 3.5 Modify `workspaces.client.ts` plugin (backup feature)
  - [x] Import `useOr3Config` composable
  - [x] Conditionally register backup dashboard app based on `features.backup.enabled`

- [x] 3.6 Modify documents feature
  - [x] Check `features.documents.enabled` in document-related components
  - [x] Hide document menu items when disabled

- [x] 3.7 Modify dashboard feature
  - [x] Check `features.dashboard.enabled` in sidebar
  - [x] Add redirect middleware for `/dashboard` when disabled

---

## 4. Limit Integration
**Requirements: 3.1, 3.2, 3.3**

- [x] 4.1 Refactor hardcoded file size limits
  - [x] Modify `app/db/files.ts` to use `getMaxFileSizeBytes()` from OR3 config
  - [x] Modify `server/api/storage/presign-upload.post.ts` to use config
  
- [x] 4.2 Implement chat attachment limits
  - [x] Modify chat input component to enforce `limits.maxFilesPerMessage`
  - [x] Show toast when limit is exceeded

---

## 5. Site Branding Integration
**Requirements: 1.1, 1.2**

- [x] 5.1 Apply site name and description
  - [x] Update `nuxt.config.ts` or `app.vue` to use `site.name` in `<title>`
  - [x] Add meta description from `site.description`

- [x] 5.2 Apply custom logo and favicon
  - [x] Create logo component that uses `site.logoUrl` with fallback
  - [x] Configure favicon from `site.faviconUrl` if provided

- [x] 5.3 Apply default theme
  - [x] Modify theme initialization to use `site.defaultTheme` when user has no preference

---

## 6. Testing
**Requirements: 6.2**

- [x] 6.1 Unit tests for config validation
  - [x] Create `tests/unit/or3-config.test.ts`
  - [x] Test default value application
  - [x] Test Zod validation errors
  - [x] Test strict mode behavior
  - [x] Test type inference

- [x] 6.2 Integration tests for feature gating
  - [x] Test that disabled features don't initialize plugins
  - [x] Test that UI elements are hidden when features are disabled

---

## 7. Documentation
**Requirements: 6.3**

- [x] 7.1 Document environment variables
  - [x] Add comments in `config.or3.ts` for each env var
  - [x] Update README or create docs page

- [x] 7.2 Document migration from hardcoded values
  - [x] List all migrated values
  - [x] Explain backwards compatibility
