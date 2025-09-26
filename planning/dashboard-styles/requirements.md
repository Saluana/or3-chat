# Requirements: Consolidated Retro Dashboard Styling

**artifact_id:** 4b6948e9-4598-40a0-90cd-7cde09afe6a2

## Introduction

Dashboard-related Vue components currently duplicate accessibility helpers and “retro” utility styles such as `.sr-only`, `.retro-chip`, and `.retro-input`. The duplication appears across `ThemePage.vue`, `AiPage.vue`, and `WorkspaceBackupApp.vue`, creating drift risks, inconsistent hover/focus states, and heavier bundles. Centralizing these utilities will improve maintainability, ensure consistent UX, and simplify future tweaks. This document captures the user stories and acceptance criteria for the consolidation effort.

## Requirements

### 1. Single Source of Truth for Retro Utilities

**User Story:** As a dashboard maintainer, I want all retro UI helpers defined once so that every dashboard surface remains visually consistent.

**Acceptance Criteria:**

-   WHEN retro chip buttons render in any dashboard module, THEN they SHALL use styles from a shared stylesheet (no component-scoped `.retro-chip` definitions).
-   WHEN retro inputs or buttons change visual specs, THEN editing the shared stylesheet SHALL update `ThemePage.vue`, `AiPage.vue`, and any other consumers without local overrides.
-   IF a component needs to extend the shared style, THEN it SHALL do so via additional class names without duplicating the base utility rules.

### 2. Shared Accessibility Helpers

**User Story:** As an accessibility auditor, I want screen-reader-only text utilities to behave identically across dashboard features.

**Acceptance Criteria:**

-   WHEN `class="sr-only"` is used anywhere under `app/components/modal/dashboard`, THEN the styles SHALL come from a global helper (and not be redefined per component).
-   WHEN the helper needs updates (e.g., support for high-contrast themes), THEN editing the shared helper SHALL propagate everywhere.

### 3. Tailwind Compatibility & Build Safety

**User Story:** As a build engineer, I want Tailwind to compile without mis-parsed modifiers so that dashboard builds never fail unexpectedly.

**Acceptance Criteria:**

-   WHEN utility overrides are required, THEN class strings SHALL remain Tailwind-compatible (e.g., `!p-0`, `hover:bg-primary/5`).
-   WHEN legacy classes currently rely on invalid suffixes (e.g., `p-0!`), THEN they SHALL be corrected during the refactor.

### 4. Documentation & Adoption Guidance

**User Story:** As a plugin author, I want clear guidance on reusing the shared retro utilities so I can build consistent dashboard extensions.

**Acceptance Criteria:**

-   WHEN the refactor completes, THEN `docs/UI/dashboard-plugins.md` (or a linked theming doc) SHALL explain how to apply the shared retro utilities.
-   WHEN future dashboard plugins are reviewed, THEN maintainers SHALL be able to point authors to the same documentation.

### 5. Regression Safety Net

**User Story:** As a QA engineer, I want automated coverage to catch regressions caused by the CSS consolidation.

**Acceptance Criteria:**

-   WHEN unit or snapshot tests run for `ThemePage.vue` and `AiPage.vue`, THEN they SHALL confirm retro class bindings still render as expected.
-   WHEN linting or style checks execute, THEN no new warnings or errors SHALL appear from removed scoped styles.
