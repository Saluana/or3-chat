# OR3 Base Config System Requirements

## Introduction

This document defines the requirements for a **base configuration system** for OR3-Chat that operates independently from the cloud configuration (`or3-cloud-config.ts`). While the cloud config handles authentication, sync, storage, and server-side features, the base config manages **site branding, feature toggles, and client-side limits** that apply to both cloud-connected and offline/local deployments.

The base config will follow the same architectural patterns as the cloud config (Zod schema validation, `defineOr3Config` helper, TypeScript types) to ensure consistency and a familiar developer experience.

---

## 1. Site Branding & Identity

### 1.1 Site Metadata
**User Story:** As an instance administrator, I want to configure site name, description, and logo so that the application reflects my branding.

**Acceptance Criteria:**
- WHEN `site.name` is set THEN the value SHALL appear in page titles and meta tags
- WHEN `site.description` is set THEN the value SHALL appear in meta description
- WHEN `site.logoUrl` is set THEN the specified image SHALL be used as the site logo
- WHEN `site.faviconUrl` is set THEN the specified favicon SHALL be used
- IF `site.name` is not provided THEN the default value "OR3" SHALL be used
- IF `site.logoUrl` is not provided THEN the default OR3 logo SHALL be used

### 1.2 Default Theme
**User Story:** As an instance administrator, I want to set a default theme so that users see my preferred styling on first visit.

**Acceptance Criteria:**
- WHEN `site.defaultTheme` is set THEN new users SHALL see that theme on first load
- WHEN a user has already selected a theme THEN their preference SHALL override the default
- IF `site.defaultTheme` is not a valid installed theme THEN a warning SHALL be logged and "blank" used

---

## 2. Feature Toggles

### 2.1 Workflow Feature
**User Story:** As an instance administrator, I want granular control over workflow capabilities so that I can offer pre-built workflows without exposing the editor.

**Acceptance Criteria:**

**Master Toggle:**
- WHEN `features.workflows.enabled` is `false` THEN ALL workflow functionality SHALL be disabled
- IF `features.workflows.enabled` is not specified THEN it SHALL default to `true`

**Editor Toggle:**
- WHEN `features.workflows.editor` is `false` THEN the workflow editor UI SHALL be hidden
- WHEN `features.workflows.editor` is `false` THEN users SHALL NOT be able to create or modify workflows
- WHEN `features.workflows.editor` is `false` THEN existing workflows SHALL still be executable
- IF `features.workflows.editor` is not specified THEN it SHALL default to `true`

**Slash Commands Toggle:**
- WHEN `features.workflows.slashCommands` is `false` THEN workflow slash commands SHALL NOT register
- WHEN `features.workflows.slashCommands` is `false` THEN `/` SHALL NOT trigger workflow autocomplete
- IF `features.workflows.slashCommands` is not specified THEN it SHALL default to `true`

**Execution Toggle:**
- WHEN `features.workflows.execution` is `false` THEN workflows SHALL NOT be executable
- WHEN `features.workflows.execution` is `false` THEN "Run" buttons SHALL be disabled with tooltip explaining
- IF `features.workflows.execution` is not specified THEN it SHALL default to `true`

**Example Configurations:**
| Use Case | enabled | editor | slashCommands | execution |
|----------|---------|--------|---------------|-----------|
| Full access | true | true | true | true |
| Pre-built only (no editor) | true | false | true | true |
| View-only library | true | false | false | false |
| Completely disabled | false | - | - | - |

### 2.2 Document Editor Feature
**User Story:** As an instance administrator, I want to enable/disable the document editor so that I can simplify the interface for chat-only deployments.

**Acceptance Criteria:**
- WHEN `features.documents.enabled` is `false` THEN the document editor pane mode SHALL be unavailable
- WHEN `features.documents.enabled` is `false` THEN the "New Document" option SHALL be hidden from menus
- IF `features.documents.enabled` is not specified THEN it SHALL default to `true`

### 2.3 Workspace Backup Feature
**User Story:** As an instance administrator, I want to enable/disable workspace backup functionality so that I can control data export capabilities.

**Acceptance Criteria:**
- WHEN `features.backup.enabled` is `false` THEN the backup dashboard app SHALL be hidden
- WHEN `features.backup.enabled` is `false` THEN backup-related menu items SHALL be hidden
- IF `features.backup.enabled` is not specified THEN it SHALL default to `true`

### 2.4 Mentions Feature
**User Story:** As an instance administrator, I want granular control over @mentions so that I can enable/disable specific mention sources.

**Acceptance Criteria:**

**Master Toggle:**
- WHEN `features.mentions.enabled` is `false` THEN ALL mention functionality SHALL be disabled
- WHEN `features.mentions.enabled` is `false` THEN `@` symbols SHALL NOT trigger autocomplete
- IF `features.mentions.enabled` is not specified THEN it SHALL default to `true`

**Document Mentions Toggle:**
- WHEN `features.mentions.documents` is `false` THEN documents SHALL NOT appear in mention suggestions
- WHEN `features.mentions.documents` is `false` THEN existing @doc mentions SHALL render as plain text
- IF `features.mentions.documents` is not specified THEN it SHALL default to `true`

**Conversation Mentions Toggle:**
- WHEN `features.mentions.conversations` is `false` THEN past conversations SHALL NOT appear in mention suggestions
- WHEN `features.mentions.conversations` is `false` THEN existing @chat mentions SHALL render as plain text
- IF `features.mentions.conversations` is not specified THEN it SHALL default to `true`

**Example Configurations:**
| Use Case | enabled | documents | conversations |
|----------|---------|-----------|---------------|
| Full mentions | true | true | true |
| Docs only | true | true | false |
| Conversations only | true | false | true |
| Mentions disabled | false | - | - |

### 2.5 Dashboard Feature
**User Story:** As an instance administrator, I want to enable/disable the dashboard so that I can simplify the interface.

**Acceptance Criteria:**
- WHEN `features.dashboard.enabled` is `false` THEN the dashboard button SHALL be hidden from the sidebar
- WHEN `features.dashboard.enabled` is `false` THEN navigation to `/dashboard` SHALL redirect to home
- IF `features.dashboard.enabled` is not specified THEN it SHALL default to `true`

---

## 3. Upload & File Limits

### 3.1 File Size Limits
**User Story:** As an instance administrator, I want to configure maximum file sizes so that I can control resource usage.

**Acceptance Criteria:**
- WHEN `limits.maxFileSizeBytes` is set THEN file uploads exceeding this size SHALL be rejected
- WHEN `limits.maxCloudFileSizeBytes` is set THEN cloud storage uploads exceeding this size SHALL be rejected
- IF `limits.maxFileSizeBytes` is not set THEN 20MB (20971520 bytes) SHALL be the default
- IF `limits.maxCloudFileSizeBytes` is not set THEN 100MB (104857600 bytes) SHALL be the default

### 3.2 Chat Attachment Limits
**User Story:** As an instance administrator, I want to limit how many files can be attached to a single chat message.

**Acceptance Criteria:**
- WHEN `limits.maxFilesPerMessage` is set THEN users SHALL not be able to attach more files than this limit
- IF a user tries to exceed the limit THEN a toast notification SHALL inform them of the limit
- IF `limits.maxFilesPerMessage` is not set THEN 10 SHALL be the default

### 3.3 Storage Quotas (Optional)
**User Story:** As an instance administrator, I want to set storage quotas for local IndexedDB usage.

**Acceptance Criteria:**
- WHEN `limits.localStorageQuotaMB` is set THEN warnings SHALL appear when usage approaches this limit
- IF `limits.localStorageQuotaMB` is not set THEN no quota warnings SHALL appear (unlimited)

---

## 4. UI & Experience Settings

### 4.1 Default Pane Layout
**User Story:** As an instance administrator, I want to set the default pane layout for new users.

**Acceptance Criteria:**
- WHEN `ui.defaultPaneCount` is set THEN new users SHALL see that many panes on first load
- IF `ui.defaultPaneCount` is not specified THEN 1 SHALL be the default
- WHEN `ui.maxPanes` is set THEN users SHALL not be able to create more panes than this limit

### 4.2 Sidebar Defaults
**User Story:** As an instance administrator, I want to configure default sidebar behavior.

**Acceptance Criteria:**
- WHEN `ui.sidebarCollapsedByDefault` is `true` THEN the sidebar SHALL start collapsed for new users
- IF `ui.sidebarCollapsedByDefault` is not specified THEN `false` SHALL be the default

---

## 5. Integration with Cloud Config

### 5.1 Non-Interference
**User Story:** As a developer, I want the base config to work independently from cloud config.

**Acceptance Criteria:**
- WHEN cloud config is disabled THEN base config SHALL still function normally
- WHEN both configs are enabled THEN they SHALL not have overlapping or conflicting settings
- WHEN cloud features are disabled THEN cloud-dependent settings SHALL be ignored gracefully

### 5.2 Composable Access
**User Story:** As a developer, I want to easily access base config values in components and composables.

**Acceptance Criteria:**
- WHEN a component needs config values THEN a `useOr3Config()` composable SHALL provide them
- WHEN the composable is called THEN it SHALL return readonly, type-safe config values
- WHEN called on client THEN it SHALL return the same values as server (SSR compatible)

---

## 6. Developer Experience

### 6.1 Type Safety
**User Story:** As a developer, I want full TypeScript support for the config.

**Acceptance Criteria:**
- WHEN editing `config.or3.ts` THEN TypeScript SHALL provide autocomplete for all options
- WHEN an invalid value is provided THEN TypeScript SHALL show a compile-time error
- WHEN accessing config values THEN the return type SHALL be fully typed

### 6.2 Validation
**User Story:** As a developer, I want config validation at startup to catch errors early.

**Acceptance Criteria:**
- WHEN the config has invalid values THEN startup SHALL fail with a clear error message
- WHEN optional values are missing THEN sensible defaults SHALL be applied
- WHEN validation fails THEN the error message SHALL indicate which field failed and why

### 6.3 Environment Variable Support
**User Story:** As a deployer, I want to override config values via environment variables.

**Acceptance Criteria:**
- WHEN an environment variable like `OR3_SITE_NAME` is set THEN it SHALL override the file config
- WHEN environment overrides are used THEN they SHALL be documented clearly
