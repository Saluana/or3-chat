---
artifact_id: fdbab68e-00ce-4012-a5de-4cc2aa84fc0a
title: requirements.md
status: draft
owner: or3-chat
date: 2026-02-21
---

# requirements.md

## Introduction

This plan defines how to extract the Tasks plugin into a standalone project and support installable workspace plugins via the OR3 Cloud admin panel without breaking existing `or3-chat` behavior.

Primary goals:
- keep current Tasks behavior working during migration,
- make plugin installation and enablement actually activate runtime features,
- establish a stable plugin runtime contract so future plugins are easy to add.

## Requirements

### 1. Workspace plugin runtime loading

**User Story 1.1**
As an operator, I want plugins installed through Admin to load in the main app runtime, so enabling a plugin has immediate functional effect.

**Acceptance Criteria**
- WHEN a plugin is installed under `extensions/plugins/<id>` and enabled for the current workspace THEN the client SHALL load its `plugin.client.ts` entrypoint.
- WHEN a plugin is disabled for the workspace THEN the client SHALL NOT register that plugin's UI/runtime contributions.
- WHEN plugin runtime loading fails for one plugin THEN the system SHALL continue loading other plugins.

### 2. Workspace-scoped enablement source of truth

**User Story 2.1**
As a maintainer, I want runtime enablement to use the canonical workspace settings store, so behavior is consistent across devices and providers.

**Acceptance Criteria**
- WHEN plugin enablement is evaluated THEN it SHALL use `plugins.enabled` from `WorkspaceSettingsStore` for the active workspace.
- WHEN no workspace is resolved THEN runtime loading SHALL default to no installed workspace plugins.
- IF SSR auth is disabled THEN workspace-installed plugin runtime loading SHALL degrade safely and not crash static/local mode.

### 3. Tasks plugin extraction without regressions

**User Story 3.1**
As a user, I want the Tasks pane/sidebar/tools to keep working during extraction, so no existing task workflows break.

**Acceptance Criteria**
- WHEN extraction is in progress THEN built-in Tasks behavior SHALL remain functional.
- WHEN extracted Tasks plugin is installed and enabled THEN it SHALL provide the same pane id, sidebar id, post type, and tool names used today.
- IF both built-in and extracted Tasks registration paths are present THEN duplicate registration SHALL be prevented deterministically.

### 4. Stable plugin package contract

**User Story 4.1**
As a plugin author, I want a clear installable package contract, so I can ship plugins without touching core.

**Acceptance Criteria**
- Plugin package SHALL include a valid `or3.manifest.json` and runtime entrypoint contract.
- Manifest validation SHALL reject invalid IDs, missing fields, and unsupported extension kinds.
- Plugin runtime API SHALL be explicit and additive (registry-first, no hidden globals required for authors).

### 5. Admin UX and operability for plugins

**User Story 5.1**
As an admin, I want clear plugin install/enable status and failure feedback, so I can operate plugins confidently.

**Acceptance Criteria**
- WHEN install succeeds THEN admin UI SHALL show plugin as installed.
- WHEN plugin is enabled/disabled THEN admin UI SHALL persist and display the workspace-enabled set.
- IF runtime load fails THEN system SHALL expose a non-sensitive reason in logs and an operator-visible status surface.

### 6. Security and authorization boundaries

**User Story 6.1**
As a security reviewer, I want plugin runtime and API usage to honor existing authorization boundaries, so plugins cannot bypass auth.

**Acceptance Criteria**
- SSR plugin-owned endpoints SHALL enforce plugin access via existing plugin access checks and `can()` for resource authorization.
- Plugin installation and enablement mutations SHALL remain owner-scoped admin operations.
- Client-side visibility checks SHALL NOT replace server-side authorization.

### 7. Static-build and SSR boundary safety

**User Story 7.1**
As a maintainer, I want plugin runtime loading to preserve static build compatibility, so non-SSR deployments do not regress.

**Acceptance Criteria**
- Client plugin loader SHALL avoid server-only imports.
- Server-only plugin logic SHALL stay under `server/**` paths.
- Static builds SHALL succeed with no installed plugins and with plugin loader enabled.

### 8. Performance and scalability

**User Story 8.1**
As a maintainer, I want plugin loading to be efficient, so plugin support does not bloat startup time.

**Acceptance Criteria**
- Runtime loader SHALL only attempt imports for workspace-enabled plugins.
- Loader SHALL avoid repeated re-registration on unchanged workspace/plugin state.
- Plugin inventory and enablement reads SHALL be cached or batched per request where possible.

### 9. Testing and migration safety

**User Story 9.1**
As a maintainer, I want migration coverage and rollback safety, so extraction can ship incrementally.

**Acceptance Criteria**
- Unit tests SHALL cover loader selection logic, dedupe guards, and manifest contract validation.
- Integration tests SHALL cover install -> enable -> runtime activation and disable/uninstall behavior.
- Rollout SHALL support fallback to built-in Tasks plugin until extraction is fully validated.

### 10. Co-located plugin layout and manifest-first registration

**User Story 10.1**
As a plugin author, I want one plugin root folder to define both client runtime and server route wiring, so plugin code is easier to reason about and maintain.

**Acceptance Criteria**
- Plugin runtime SHALL support a manifest-declared client entrypoint and optional server route declarations from the same plugin root.
- Server route declarations SHALL be explicit in manifest metadata (no implicit directory magic) and constrained to plugin-scoped route prefixes.
- Existing plugins that do not provide new runtime declarations SHALL continue to work unchanged through legacy loading paths.
- Manifest validation SHALL report actionable errors for invalid entry paths, duplicate route definitions, or disallowed route prefixes.
