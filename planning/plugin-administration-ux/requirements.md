# Requirements

## Introduction

Make plugin administration practical for a site with thousands of workspaces. Turn the ten proposed improvements into one experience for approving, installing, enabling, checking, updating, and recovering plugins. Administrators should see the current outcome and the next useful action without interpreting internal package terminology.

## Context

OR3 Chat uses Nuxt 4, Vue, Nuxt UI, TypeScript, Bun, Vitest, and Playwright. V2 packages have immutable package trees, one instance-wide selected version, candidate/previous pointers, durable acquisition records, signed authority review, setup plans, browser canaries, and runtime activation observations. Workspace enablement and grant reviews use the provider-backed `WorkspaceSettingsStore`; provisioning seeds configured defaults. Admin > Plugins and Dashboard > Marketplace expose overlapping operations. Dashboard catalog routes currently proxy the configured marketplace without a site approval filter. Existing work in `planning/marketplace-release-lifecycle/` already covers acquisition recovery and truthful runtime status; this plan extends those services rather than replacing them. Findings are based on the current dirty working tree, including the recent Workflows extraction and browser smoke fixes.

## Assumptions

- The ten requirement IDs below correspond, in order, to the ten suggestions in the conversation.
- This is an OR3 Chat administration project. Central marketplace publication, signing, billing, and plugin feature implementations remain separate.
- System administrators control site approval, shared package installation/version selection, future workspace defaults, and operations covering multiple workspaces. Existing workspace-admin authority remains limited to its authorized workspace.
- All workspaces continue sharing one selected package version. Workspace selection controls availability, consent, and enablement; an update or rollback of the selected version affects every enabled workspace.
- Site catalog approval, workspace permission consent, and actual runtime activation remain distinct facts. One guided action can collect the necessary decisions together, with their scope visible.
- Existing verified selected marketplace packages are initially allowed in the site catalog without granting additional workspace permissions. Uninstalled marketplace plugins start hidden from ordinary workspace users.
- “New workspaces only” means workspaces provisioned after the default is saved. Existing workspaces are changed only through an explicit rollout.
- The initial delivery supports 1,000 workspaces and uses the existing storage/provider architecture. Larger limits can follow measurements.

## Out of Scope

- Separate package versions per workspace, automatic release publication, automatic production deployment, or unreviewed permission expansion.
- A new plugin SDK, generic workflow engine, external queue, or monitoring service.
- Replacing source-plugin installation; source/development controls remain in an advanced section.
- Automatically invoking user workflows, paid models, external writes, or destructive actions during health checks.
- Copying credentials or workspace-specific setup values between workspaces.
- Automatically reverting plugin data when rolling back code.

## Requirements

### R1: One clear plugin status

**User Story:** As an administrator, I want one understandable status and next action, so that I can tell whether a plugin needs my attention.

**Acceptance Criteria:**
- R1.AC1: WHEN the same plugin and workspace are shown in Admin or Marketplace THEN both surfaces SHALL use the same status definitions and primary action.
- R1.AC2: WHEN prerequisites remain THEN the status SHALL identify the first actionable condition: needs site approval, needs permissions, needs setup, checking, ready to enable, disabled, starting, active, or needs attention.
- R1.AC3: IF the exact selected package has not been observed running in the current browser/workspace THEN the interface SHALL NOT label that runtime active; site summaries SHALL report enabled counts separately from observed health.
- R1.AC4: WHEN an update is staged THEN the working release's status SHALL remain visible and the pending update SHALL appear as a separate item; identities and diagnostic details SHALL be expandable and long values SHALL wrap.

### R2: One guided install flow

**User Story:** As an administrator, I want a guided install journey, so that I do not have to move between unrelated screens to finish installation.

**Acceptance Criteria:**
- R2.AC1: WHEN an administrator starts installation THEN one view SHALL guide release selection, workspace scope, permission review, required setup, package checks, enablement, and the outcome using the existing acquisition service.
- R2.AC2: WHEN consent or setup is required before package acquisition can advance THEN the guide SHALL present that step before retrying; visible step order SHALL follow actual server prerequisites.
- R2.AC3: WHEN the administrator reloads, returns after sign-in, or retries a failed request THEN the guide SHALL recover the authorized operation and its frozen target without duplicate installs or repeated successful workspace writes.
- R2.AC4: IF a step fails or is cancelled THEN the guide SHALL state which changes were applied, which remain, and the supported recovery action; success SHALL distinguish installed, enabled, and runtime-confirmed results.

### R3: Site-wide enablement

**User Story:** As a system administrator, I want to enable a plugin across existing workspaces and optionally future ones, so that I do not repeat the same work thousands of times.

**Acceptance Criteria:**
- R3.AC1: WHEN an administrator chooses all existing workspaces THEN the server SHALL record a deduplicated snapshot of live workspace IDs and process that snapshot through normal consent, setup, and enablement checks.
- R3.AC2: WHEN a future-workspace default is enabled THEN each subsequently provisioned workspace SHALL receive only the reviewed authority allowed by that default and SHALL enable the plugin only after its own prerequisites pass.
- R3.AC3: IF a new workspace needs credentials or setup THEN it SHALL remain inactive with a specific setup action; IF the default is removed THEN existing workspace choices SHALL remain unchanged.
- R3.AC4: WHEN processing 1,000 workspaces THEN work SHALL proceed in bounded resumable batches, expose applied/pending/blocked/failed counts, and survive process restart without replaying successful side effects.

### R4: Workspace rollout controls

**User Story:** As a system administrator, I want to choose rollout scope and preview its effect, so that plugin changes affect the workspaces I intend.

**Acceptance Criteria:**
- R4.AC1: WHEN choosing enablement scope THEN the UI SHALL offer selected workspaces, all existing workspaces, and new workspaces only; including future workspaces SHALL also be an explicit option for existing-workspace rollouts.
- R4.AC2: BEFORE applying a rollout THEN the UI SHALL show plugin/version, number targeted, already enabled, to be enabled or disabled, blocked, and the future default change; selected-workspace search SHALL be paginated.
- R4.AC3: IF the selected package, policy, or a targeted workspace's relevant consent/setup/enablement changes after review THEN stale changes SHALL be rejected or re-assessed and concurrent workspace decisions SHALL NOT be silently overwritten.
- R4.AC4: WHEN cancellation or partial failure occurs THEN completed changes SHALL remain recorded, pending changes SHALL stop, and retry SHALL target unresolved results; deleted workspaces SHALL be recorded as skipped.
- R4.AC5: WHEN an administrator enables across an explicit existing-workspace target THEN the preview SHALL identify previously disabled targets; a future-only default SHALL NOT re-enable an existing workspace.

### R5: Admin-approved dashboard catalog

**User Story:** As a workspace user, I want the dashboard marketplace to show plugins approved for this site, so that browsing does not lead to unavailable choices.

**Acceptance Criteria:**
- R5.AC1: WHEN an ordinary user browses or searches Dashboard > Marketplace THEN only site-approved entries SHALL be returned, with pagination and counts computed after the approval filter.
- R5.AC2: IF a user opens an unapproved plugin detail, preflight, or install-request URL directly THEN the local server SHALL enforce the same policy and SHALL NOT expose an actionable unapproved release.
- R5.AC3: WHEN a system administrator browses Admin > Plugins > Catalog THEN they SHALL see the full configured marketplace and may approve an exact verified release for the site; a later unapproved release SHALL NOT replace the approved version in user-facing actions.
- R5.AC4: WHEN policy is initialized on an existing installation THEN verified selected marketplace packages SHALL retain visibility without changing enablement or grants; invalid/quarantined packages SHALL remain blocked. An empty approved catalog SHALL explain that the administrator has not made plugins available yet.
- R5.AC5: WHEN an administrator removes catalog approval THEN new discovery and enablement SHALL stop; the UI SHALL explicitly distinguish that from disabling existing installations and offer a separate disable action.

### R6: Review permissions once for the chosen scope

**User Story:** As a system administrator, I want to review a release's permissions once for the chosen workspaces, so that I can approve a deployment without repeating identical dialogs.

**Acceptance Criteria:**
- R6.AC1: WHEN reviewing a release THEN the UI SHALL show plain-language access descriptions, its trust mode, and added/removed/changed authority compared with the selected release, including destinations, data scopes, connections, and setup writes where present.
- R6.AC2: WHEN approval is submitted THEN it SHALL bind to the exact release identity, package digest, authority hash, reviewed grants, and target snapshot or explicit future-workspace policy; the server SHALL derive requested access from verified metadata.
- R6.AC3: WHEN applying the approval THEN existing per-workspace grant-review records SHALL be written for eligible targets; approval SHALL NOT copy credentials, bypass setup, invent grants, or expand a workspace owner's delegated authority.
- R6.AC4: IF an update's authority is unchanged or narrower under existing authority-comparison rules THEN existing consent may carry forward; IF authority expands THEN one new scoped administrator decision SHALL be required before promotion/default changes.
- R6.AC5: IF any grant write fails THEN that workspace SHALL NOT be enabled by the rollout, and retry SHALL preserve successful approvals and report the failing target.

### R7: Separate update review

**User Story:** As an administrator, I want a dedicated update view, so that I can review changes without confusing a pending release with the working one.

**Acceptance Criteria:**
- R7.AC1: WHEN an update exists THEN the view SHALL show current and proposed versions, access/setup changes, affected enabled-workspace count, and the available rollback target.
- R7.AC2: WHEN an update is checked THEN every enabled workspace SHALL pass the existing promotion prerequisites; a blocked workspace SHALL prevent shared-version promotion and identify its repair step.
- R7.AC3: WHEN a candidate is selected for checking THEN the UI SHALL label it “Update being checked” and keep raw candidate/pointer terminology in advanced details; failed checks SHALL leave the current selected version intact.
- R7.AC4: WHEN an update finishes THEN workspace enablement choices SHALL remain unchanged and future-workspace approval SHALL be advanced only within the reviewed authority; one-workspace canary evidence SHALL NOT be represented as a partial production version rollout.

### R8: Explain blocked actions in place

**User Story:** As an administrator, I want a reason and repair action next to a blocked control, so that I know what to do without reading logs.

**Acceptance Criteria:**
- R8.AC1: WHEN an action is unavailable THEN the UI SHALL provide a specific reason and, where supported, a direct action such as review permissions, complete setup, sign in as admin, retry check, or configure registry.
- R8.AC2: WHEN remediation opens another view THEN plugin, release, workspace, and operation context SHALL be retained; stale or unauthorized context SHALL be rejected on return.
- R8.AC3: IF no automated repair exists THEN the UI SHALL say so and offer a redacted diagnostic report; raw JSON and secrets SHALL NOT appear in the primary error message.
- R8.AC4: WHEN operated by keyboard or at a 375px viewport THEN status, reasons, dialogs, and next actions SHALL remain accessible without horizontal page overflow; focus SHALL remain usable after refreshes and modal return.

### R9: Built-in health check

**User Story:** As an administrator, I want a health result after enabling a plugin, so that an installed package does not look usable when it cannot start.

**Acceptance Criteria:**
- R9.AC1: WHEN a plugin is enabled or updated THEN the result SHALL combine existing server package/preflight/canary evidence with browser activation and required contribution registration evidence, identifying the workspace, exact digest, timestamp, and checks actually performed.
- R9.AC2: IF browser activation is not observed within the existing 30-second window THEN the result SHALL show “Enabled; browser check pending” with retry/open-workspace actions; it SHALL NOT undo a successful install or claim the plugin runs in unopened workspaces.
- R9.AC3: WHEN a check is retried THEN it SHALL reuse the selected package and current operation as applicable; checks SHALL NOT run user workflows, paid models, external writes, or destructive actions automatically.
- R9.AC4: WHEN a real activation fails or a required contribution is missing THEN the UI SHALL show needs attention and a specific recovery action; optional contributions SHALL be reported as degraded separately from startup success.

### R10: Simple, safe rollback

**User Story:** As a system administrator, I want one rollback action for the previous working release, so that I can recover from an update without handling package pointers manually.

**Acceptance Criteria:**
- R10.AC1: WHEN a previous package is retained THEN the UI SHALL offer one “Restore previous version” entry point and an impact review naming the exact versions and all currently enabled workspaces affected by the shared selection.
- R10.AC2: BEFORE rollback commits THEN the previous package SHALL pass current trust/quarantine, grant, dependency, setup, and data-readability checks for every affected workspace; stale package/enablement revisions SHALL be rejected.
- R10.AC3: WHEN rollback succeeds THEN the system SHALL restore the shared code selection through the existing promotion service, preserve workspace enablement and plugin data, revoke replaced activations, and report runtime confirmation with the same limits as installation.
- R10.AC4: IF rollback is incompatible or fails before commit THEN the current selection SHALL remain intact and the UI SHALL explain the supported recovery; if failure occurs after commit it SHALL report the actual selected version and next action.
