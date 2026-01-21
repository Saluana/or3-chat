# OR3 Base Config System - Implementation Tasks

## 1. Core Configuration Types and Validation
**Requirements: 6.1, 6.2**

- [ ] 1.1 Create TypeScript interfaces
  - [ ] Create `types/or3-config.d.ts` with `Or3Config` and `Or3ConfigOptions` interfaces
  - [ ] Export all types from module

- [ ] 1.2 Implement Zod validation schema
  - [ ] Create `utils/or3-config.ts`
  - [ ] Define `or3ConfigSchema` with all fields and defaults
  - [ ] Implement `mergeWithDefaults()` function for deep merging
  - [ ] Implement `validateConfig()` function with strict mode support
  - [ ] Implement `formatConfigErrors()` for user-friendly error messages
  - [ ] Export `defineOr3Config()` helper and `DEFAULT_OR3_CONFIG`

- [ ] 1.3 Create default config file
  - [ ] Create `config.or3.ts` in project root
  - [ ] Use `defineOr3Config()` with sensible defaults
  - [ ] Document environment variable overrides

---

## 2. Composable Access Layer
**Requirements: 5.2**

- [ ] 2.1 Create `useOr3Config` composable
  - [ ] Create `app/composables/useOr3Config.ts`
  - [ ] Import and re-export validated config as readonly
  - [ ] Ensure SSR compatibility (same values on server and client)

- [ ] 2.2 Create feature flag helpers
  - [ ] Add `isFeatureEnabled(featureName: string): boolean` helper
  - [ ] Add type-safe feature names

---

## 3. Feature Gating Implementation
**Requirements: 2.1, 2.2, 2.3, 2.4, 2.5**

- [ ] 3.1 Modify `mentions.client.ts` plugin
  - [ ] Import `useOr3Config` composable
  - [ ] Check `features.mentions.enabled` master flag (early return if false)
  - [ ] Filter document sources based on `features.mentions.documents`
  - [ ] Filter conversation sources based on `features.mentions.conversations`

- [ ] 3.2 Modify `workflows.client.ts` plugin
  - [ ] Import `useOr3Config` composable
  - [ ] Check `features.workflows.enabled` master flag (early return if false)
  - [ ] Check `features.workflows.execution` before allowing workflow runs

- [ ] 3.3 Modify `workflow-slash-commands.client.ts` plugin
  - [ ] Check `features.workflows.slashCommands` flag
  - [ ] Skip slash command registration if disabled

- [ ] 3.4 Modify workflow editor components
  - [ ] Check `features.workflows.editor` flag
  - [ ] Hide editor UI and "New Workflow" buttons when disabled
  - [ ] Show read-only view of existing workflows

- [ ] 3.5 Modify `workspaces.client.ts` plugin (backup feature)
  - [ ] Import `useOr3Config` composable
  - [ ] Conditionally register backup dashboard app based on `features.backup.enabled`

- [ ] 3.6 Modify documents feature
  - [ ] Check `features.documents.enabled` in document-related components
  - [ ] Hide document menu items when disabled

- [ ] 3.7 Modify dashboard feature
  - [ ] Check `features.dashboard.enabled` in sidebar
  - [ ] Add redirect middleware for `/dashboard` when disabled

---

## 4. Limit Integration
**Requirements: 3.1, 3.2, 3.3**

- [ ] 4.1 Refactor hardcoded file size limits
  - [ ] Modify `app/db/files.ts` to use `useOr3Config().limits.maxFileSizeBytes`
  - [ ] Modify `server/api/storage/presign-upload.post.ts` to use config
  
- [ ] 4.2 Implement chat attachment limits
  - [ ] Modify chat input component to enforce `limits.maxFilesPerMessage`
  - [ ] Show toast when limit is exceeded

---

## 5. Site Branding Integration
**Requirements: 1.1, 1.2**

- [ ] 5.1 Apply site name and description
  - [ ] Update `nuxt.config.ts` or `app.vue` to use `site.name` in `<title>`
  - [ ] Add meta description from `site.description`

- [ ] 5.2 Apply custom logo and favicon
  - [ ] Create logo component that uses `site.logoUrl` with fallback
  - [ ] Configure favicon from `site.faviconUrl` if provided

- [ ] 5.3 Apply default theme
  - [ ] Modify theme initialization to use `site.defaultTheme` when user has no preference

---

## 6. Testing
**Requirements: 6.2**

- [ ] 6.1 Unit tests for config validation
  - [ ] Create `tests/unit/or3-config.test.ts`
  - [ ] Test default value application
  - [ ] Test Zod validation errors
  - [ ] Test strict mode behavior
  - [ ] Test type inference

- [ ] 6.2 Integration tests for feature gating
  - [ ] Test that disabled features don't initialize plugins
  - [ ] Test that UI elements are hidden when features are disabled

---

## 7. Documentation
**Requirements: 6.3**

- [ ] 7.1 Document environment variables
  - [ ] Add comments in `config.or3.ts` for each env var
  - [ ] Update README or create docs page

- [ ] 7.2 Document migration from hardcoded values
  - [ ] List all migrated values
  - [ ] Explain backwards compatibility
