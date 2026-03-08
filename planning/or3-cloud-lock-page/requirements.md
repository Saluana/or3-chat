---
artifact_id: 7d4ffabd-b686-4933-8d62-64d2a88f4c59
title: Requirements - OR3 Cloud lock page
status: draft
owner: platform
date: 2026-03-08
---

# Introduction

OR3 Cloud needs an optional, deployment-level lock page that can replace the main app shell for visitors who are not allowed into the authenticated experience yet.

The feature is intentionally:

- off by default,
- SSR-auth aware,
- easy for developers to override with their own landing/login/sales page,
- safe for static builds and local-first deployments.

This requirement set treats the lock page as a top-level app-entry feature for OR3 Cloud, not as a one-off plugin page. The default experience may be a simple login screen, but developers must be able to swap it for their own implementation without forking core behavior.

## Requirements

### 1. Optional deployment-level lock page

**User Story 1.1**
As a deployment operator, I want to enable a lock page for OR3 Cloud, so that unauthorised visitors do not land directly in the main app shell.

Acceptance Criteria:
- WHEN the feature is not configured THEN the application SHALL preserve current behavior.
- WHEN the feature is enabled THEN routes backed by the main app shell SHALL render the lock experience instead of the normal shell for visitors who are not allowed through.
- WHEN `SSR_AUTH_ENABLED` is `false` THEN the lock page feature SHALL remain inert and SHALL NOT change static/local-first behavior.

### 2. Access decision must align with existing OR3 auth rules

**User Story 2.1**
As a maintainer, I want the lock page to rely on existing auth and authorization rules, so that it does not introduce a second conflicting access model.

Acceptance Criteria:
- WHEN lock-page access is evaluated THEN it SHALL use the resolved SSR session context and existing OR3 auth policy helpers.
- WHEN a visitor has a valid authenticated session with app access THEN the lock page SHALL NOT render.
- WHEN guest access is enabled and the deployment policy allows guest entry THEN the lock page SHALL NOT block those guests.
- IF access state cannot be determined safely THEN the feature SHALL fail closed and SHALL NOT render the main app shell.

### 3. Built-in default lock experience

**User Story 3.1**
As a deployment operator, I want a default lock page available out of the box, so that enabling the feature does not require custom code.

Acceptance Criteria:
- WHEN the feature is enabled without a custom override THEN OR3 SHALL render a built-in default lock page.
- The default lock page SHALL provide a clear authentication call to action using the configured auth provider UI surface.
- The default lock page SHALL be compatible with the current provider-agnostic auth adapter approach and SHALL NOT hard-code Clerk-specific UI into core entry rendering.

### 4. Developer override and extensibility

**User Story 4.1**
As a developer, I want to replace the default lock page with my own component, so that I can build a branded login page, marketing page, or custom gated landing experience.

Acceptance Criteria:
- WHEN a developer registers a custom lock page implementation THEN the deployment SHALL be able to select it by id.
- A custom lock page SHALL be able to render arbitrary UI, including branding, sales copy, and auth entry points.
- IF the configured custom lock page is missing or fails to resolve THEN the system SHALL fall back to the built-in default lock page.
- The override mechanism SHALL use an OR3 extension surface (registry/composable/hook pattern), not a hard-coded import swap.

### 5. Config surface and defaults

**User Story 5.1**
As a deployment operator, I want the lock page controlled through typed config, so that behavior is predictable and deployable through the existing OR3 Cloud config flow.

Acceptance Criteria:
- The feature SHALL be configured through typed OR3 Cloud configuration.
- The config SHALL include an explicit enable/disable flag and a way to select the active lock page implementation.
- The config SHALL default to disabled.
- Config validation SHALL reject malformed lock page settings.

### 6. Main-shell integration without wasted work

**User Story 6.1**
As a developer, I want the lock page gate to happen before heavy app-shell setup, so that locked visitors do not pay for unnecessary sidebar/pane/dashboard work.

Acceptance Criteria:
- WHEN the lock page is rendered THEN the main `PageShell` chrome and pane content SHALL NOT initialize.
- The lock page SHALL cover the shared shell routes used for the main OR3 app entry experience.
- The feature SHALL avoid duplicate access checks on hot render paths where request-local or composable-level state can be reused safely.

### 7. Security and failure handling

**User Story 7.1**
As a security reviewer, I want the lock page feature to fail safely, so that rendering errors or adapter mismatches do not expose the app shell unintentionally.

Acceptance Criteria:
- IF a custom lock page adapter cannot be resolved THEN the app SHALL render the default lock page instead of the main shell.
- IF session resolution or access evaluation throws during SSR entry rendering THEN the app SHALL not render protected shell content.
- The lock page feature SHALL NOT weaken existing server-side authorization requirements for API routes; `can()` SHALL remain authoritative for server actions.

### 8. Documentation and install flow coverage

**User Story 8.1**
As a maintainer, I want docs and setup flows to reflect the new feature, so that deployments can enable and customize it consistently.

Acceptance Criteria:
- OR3 Cloud config documentation SHALL describe the lock page settings and defaults.
- Wizard/config tooling SHALL either support the new settings or explicitly preserve them without clobbering them.
- Planning and implementation docs SHALL describe how developers register custom lock page implementations.

### 9. Testing coverage

**User Story 9.1**
As a maintainer, I want automated coverage for lock page access decisions and fallback behavior, so regressions are caught before deploys.

Acceptance Criteria:
- Unit tests SHALL cover lock-page access resolution across authenticated, guest, unauthenticated, and error states.
- Unit tests SHALL cover registry resolution and fallback to the default lock page.
- Integration tests SHALL cover shell-route rendering when the feature is enabled and disabled.
- SSR/auth integration tests SHALL verify the main shell remains hidden when access is denied.
