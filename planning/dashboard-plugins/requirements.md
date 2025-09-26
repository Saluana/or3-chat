# Requirements: Dashboard Plugin Refactor & UX Hardening

**artifact_id:** 2a9640f4-5c88-4d52-be41-b7f1a4a558f7

## Introduction

The dashboard modal currently duplicates navigation logic that already exists (or should exist) in the shared dashboard composable. Utility styling for dashboard pages is scattered across multiple Vue components, and image/workspace tooling needs performance and memory safeguards. This document captures user-facing requirements so we can streamline the dashboard plugin experience, improve maintainability, and protect resource usage.

## Requirements

### 1. Unified Dashboard Navigation Flow

**User Story:** As a dashboard developer, I want the modal view to rely on a single composable for navigation and page resolution so that fixes and enhancements land in one place.

**Acceptance Criteria:**

-   WHEN the dashboard opens, THEN the active plugin id, active page id, and derived landing lists SHALL come from the shared dashboard composable state.
-   WHEN a plugin tile is clicked, THEN the composable SHALL decide whether to invoke a handler, load a single page, or present the landing list without duplicating this logic in `Dashboard.vue`.
-   WHEN navigation errors occur (e.g., missing page), THEN the composable SHALL surface a structured error result that the view can render.

### 2. Tailwind Class Safety

**User Story:** As a frontend engineer, I want dashboard-tailored utility classes to compile reliably so that the build never fails due to invalid Tailwind tokens.

**Acceptance Criteria:**

-   WHEN dashboard components render, THEN class bindings SHALL use Tailwind-compatible syntax (e.g., `!p-0` instead of `p-0!`).
-   IF custom CSS overrides are required, THEN they SHALL be expressed via `:class` bindings or extracted CSS utilities instead of invalid inline modifiers.

### 3. Shared Retro Utility Styling

**User Story:** As a theming maintainer, I want shared “retro” and accessibility utilities defined once so that dashboard pages remain stylistically consistent and easy to update.

**Acceptance Criteria:**

-   WHEN a component needs the `.sr-only` or retro chip/input styling, THEN it SHALL import the shared stylesheet instead of duplicating scoped CSS.
-   WHEN the shared stylesheet changes, THEN all dashboard pages SHALL pick up the update without extra modifications.

### 4. Gallery Grid Resource Hygiene

**User Story:** As an images page user, I want the gallery to stay responsive during long browsing sessions so that memory usage and reflow remain controlled.

**Acceptance Criteria:**

-   WHEN gallery items are removed or replaced, THEN stale `Blob` URLs SHALL be revoked within the next render cycle.
-   WHEN large batches of items load, THEN observer registration SHALL be throttled/debounced to avoid blocking the main thread.

### 5. Workspace Backup Streaming Efficiency

**User Story:** As a workspace admin, I want large exports to avoid unnecessary base64 churn so that backups succeed on low-memory devices.

**Acceptance Criteria:**

-   WHEN exporting large workspaces, THEN binary payloads SHALL stream in chunks without accumulating full base64 strings in memory.
-   IF base64 conversion is unavoidable, THEN processing SHALL stay within documented per-line size limits and reuse typed arrays when possible.

### 6. Test & Documentation Coverage

**User Story:** As a QA engineer, I want regression tests and docs updated so that future contributors can rely on automated coverage.

**Acceptance Criteria:**

-   WHEN the refactor ships, THEN unit tests SHALL cover the composable navigation paths (handler, single page, multi-page).
-   WHEN the shared utilities change, THEN developer docs SHALL describe where to add new dashboard plugins/pages and styling hooks.
