# Requirements

## Introduction

Make publishing, installing, and updating OR3 plugins one understandable journey without replacing the existing security or acquisition architecture. The central rule is that the exact package tested is the package reviewed, published, installed, and identified as running. Deliver client status and recovery first, a real local development installation workflow second, and a connected publisher workflow third.

## Context

OR3 Chat uses Bun, Nuxt, Vue, isolated portable workers, and existing sidebar, pane, and tool registries. Its acquisition service already persists resumable operations, verifies signed release digests and authority, performs candidate health checks and a browser canary, and promotes an instance-wide package pointer with concurrency protection. The client requests reconciliation after acquisition completes but does not await confirmation that the exact package is running. OR3 Marketplace uses Nuxt, Clerk, D1, and R2; it already has submission revisions, package/source uploads, validation evidence, review decisions, and resumable publication intents. The SDK already provides validate, test, build, pack, and inspect commands. This plan connects and clarifies those systems instead of introducing another release coordinator.

## Assumptions

- This is a cross-repository plan stored in the host repository; implementation will affect `or3-chat` and `or3-marketplace`. A representative portable plugin can serve as a verification fixture without making the host Tasks-specific.
- The initial development-install workflow supports the existing portable profile only. Other plugin profiles continue using their supported acquisition paths.
- Package selection remains instance-wide. Unpublished candidates run in a dedicated, loopback-only local development instance with separate application data and extension storage, not as a workspace override in a shared instance.
- Workspace permissions remain explicit. Authentication, grant review, trusted review, and publication approval are distinct decisions even when presented in one journey.
- "Running" refers to an observed activation in the current browser and workspace. It is not a claim about every open browser or enabled workspace.
- Local candidate testing may use a dirty source snapshot. Release qualification must use the exact clean source commit and dependency inputs required by repository release policy; qualification does not silently rebuild or replace the candidate.
- Delivery uses existing APIs and persistence wherever possible. Any schema additions are additive and justified by a concrete acceptance criterion.
- This plan does not authorize execution, new grants, publication, installation, or production deployment. Those actions require the appropriate authorization when implementation reaches them.

## Out of Scope

- A second marketplace, release service, job queue, authentication system, or plugin framework.
- Weakening signature checks, enabling raw custom uploads in ordinary deployments, overwriting published versions, or manually modifying package pointers.
- Arbitrary publisher HTML, CSS, JavaScript in the host DOM, or bypassing worker isolation.
- Automatic production rollout, npm publication, production deployment, or automatic permission expansion.
- A general workspace-specific package-version override.
- Automatic data rollback, speculative migration infrastructure, or a promise that every old package can read newer plugin data.
- Treating a worker health check as visual or interaction acceptance, or treating publisher-supplied test reports as trusted marketplace review.
- Redesigning the Tasks product itself, billing, marketplace discovery ranking, or unrelated host UI.

## Requirements

### R1: Truthful Package Status

**User Story:** As a workspace user, I want to know what is available, installed, and running, so that an update cannot appear successful while I am still using another package.

**Acceptance Criteria:**
- R1.AC1: WHEN the plugin detail or installed view is opened THEN it SHALL distinguish the available release, instance-selected package, and current workspace/browser activation, including their versions and exact package identities in expandable details.
- R1.AC2: IF a package is installed but activation has not been observed THEN the client SHALL show a non-running state such as "Starting", "Disabled", or "Not observed", rather than "Running".
- R1.AC3: WHEN the current activation belongs to another package or workspace generation THEN it SHALL NOT satisfy the selected package's running confirmation.
- R1.AC4: WHEN a development candidate is selected THEN the interface SHALL label it "Development candidate" and SHALL NOT present it as a published marketplace release.

### R2: One Resumable Update Journey

**User Story:** As an instance administrator, I want one update action and a resumable progress view, so that refreshes, interrupted sessions, and retries do not make me repeat or guess the workflow.

**Acceptance Criteria:**
- R2.AC1: WHEN an install or update starts THEN the client SHALL present compatibility, approval/setup, verification, activation, and outcome using the existing durable acquisition operation; it SHALL NOT create an independent acquisition state machine.
- R2.AC2: WHEN the page reloads or authentication is renewed THEN the client SHALL recover the authorized operation and display its current state without creating a duplicate operation.
- R2.AC3: IF an operation requires another actor, setup, permission review, or a retry THEN the view SHALL name the next action and preserve the operation context through supported navigation.
- R2.AC4: WHEN cancellation is requested THEN the view SHALL reflect the existing service's actual cancellation boundary; it SHALL NOT claim cancellation after package promotion has committed.

### R3: Compatibility and Consent Before Promotion

**User Story:** As a workspace owner, I want updates checked against my host and existing approvals, so that a plugin cannot unexpectedly acquire access or replace a working package with an incompatible one.

**Acceptance Criteria:**
- R3.AC1: WHEN a candidate requires unsupported host features or a different supported profile THEN preflight SHALL block promotion and identify the incompatibility.
- R3.AC2: WHEN an update requests additional authority THEN the view SHALL display the requested delta and require approval by an authorized actor before proceeding.
- R3.AC3: WHEN the instance-wide package affects enabled workspaces THEN promotion SHALL require current preflight evidence for those workspaces; one workspace's consent SHALL NOT approve another's grants.
- R3.AC4: IF candidate identity, workspace enablement, grants, or relevant setup changes after review THEN stale evidence SHALL be rejected and the next required review SHALL be displayed.

### R4: Confirmed Activation and Honest Recovery

**User Story:** As a plugin user, I want activation failure to have a clear recovery path without risking my data or hiding the failure.

**Acceptance Criteria:**
- R4.AC1: WHEN promotion completes THEN the client SHALL reconcile the current workspace and confirm the selected package identity through the actual worker activation and expected host contribution registrations before displaying "Running".
- R4.AC2: IF confirmation is not received within 30 seconds THEN the client SHALL leave the server installation outcome intact and show "Installed; activation not confirmed" with an explicit retry or diagnostic action.
- R4.AC3: IF a candidate fails before promotion THEN the previous selected package SHALL remain selected; IF failure occurs after promotion THEN the view SHALL show the actual selected and observed identities rather than assuming rollback occurred.
- R4.AC4: WHEN activation is replaced or retried THEN old sidebar, pane, and tool registrations SHALL be cleaned up and late callbacks from the old activation SHALL NOT overwrite current state.
- R4.AC5: WHEN recovery offers a previous package THEN it SHALL first pass current trust, grants, compatibility, and data-readability checks; IF data readability cannot be established THEN automatic rollback SHALL NOT occur and the UI SHALL explain the limitation.
- R4.AC6: WHEN an update or recovery is performed THEN it SHALL NOT clear plugin storage or report unsaved UI state as saved; ordinary pane-close and pending-action safeguards SHALL remain in force.

### R5: A Reproducible Candidate Identity

**User Story:** As a plugin developer, I want one candidate bundle that I can test and submit unchanged, so that source edits and stale SDK artifacts cannot silently change what is released.

**Acceptance Criteria:**
- R5.AC1: WHEN candidate creation succeeds THEN it SHALL produce the package archive, matching source archive, and a machine-readable receipt containing plugin/version, package/archive/manifest/source digests, effective authority identity, required host features, SDK/build inputs, source revision, and dirty-snapshot status.
- R5.AC2: WHEN an existing candidate is tested or submitted THEN the workflow SHALL verify its recorded bytes and reuse them; it SHALL NOT implicitly rebuild the package.
- R5.AC3: IF source, dependency inputs, or package content changes THEN creating a candidate SHALL produce a separately identifiable candidate and SHALL NOT modify a previously frozen candidate.
- R5.AC4: WHEN a candidate is qualified for publication THEN the qualification SHALL bind to the exact clean source commit and dependency artifacts; an unrecorded local SDK tarball or sibling alias SHALL NOT be accepted as release provenance.
- R5.AC5: IF a published plugin version already exists THEN publication SHALL reject different bytes for that version and require an unused version.

### R6: Real Local Plugin Testing

**User Story:** As a plugin developer, I want to test an unpublished candidate inside real OR3 Chat without publishing every iteration or bypassing the normal runtime.

**Acceptance Criteria:**
- R6.AC1: WHEN an owner explicitly enables the local development workflow THEN it SHALL run only in a development build on a dedicated loopback-bound instance with separate application data and extension storage.
- R6.AC2: IF a production build, ordinary instance, unauthorized session, cross-origin mutation, or non-loopback access attempts development admission THEN the server SHALL reject it even if the development flag is supplied.
- R6.AC3: WHEN a local candidate is admitted THEN it SHALL reuse archive validation, profile/feature checks, derived authority, explicit grants, candidate checks, and managed pointer selection; only marketplace publication/signature provenance SHALL be replaced by explicitly labeled local admission.
- R6.AC4: WHEN that candidate opens THEN it SHALL run in the real isolated worker and use real host sidebar, pane, tool, and storage integrations; it SHALL NOT use a demo page, fixture-only renderer, or unrestricted host imports.
- R6.AC5: WHEN a developer replaces a candidate THEN the workflow SHALL identify the new digest, preserve the dedicated instance's plugin data, clean up the old activation, and require fresh authority review when necessary.
- R6.AC6: WHEN the server configuration is not eligible for local development admission THEN the interface SHALL not offer "Test in local OR3" as an actionable install path and SHALL explain the required dedicated instance.

### R7: Evidence Bound to the Tested Bytes

**User Story:** As a reviewer, I want to distinguish developer testing from trusted validation and know exactly which candidate each result covers.

**Acceptance Criteria:**
- R7.AC1: WHEN local verification is recorded THEN its receipt SHALL identify the package/source/provenance digests, host build/features, verification scope, timestamp, and outcome without including credentials or plugin content.
- R7.AC2: WHEN a candidate is attached to a submission THEN the existing submission revision and validation evidence SHALL bind to those artifact identities; mismatched receipts SHALL be rejected or visibly marked inapplicable.
- R7.AC3: IF artifacts or the reviewed revision change THEN prior approval and candidate-specific verification SHALL NOT be shown as applying to the replacement.
- R7.AC4: WHEN a developer report is displayed THEN it SHALL be labeled developer-supplied and SHALL NOT substitute for trusted validation, reviewer approval, or signer authorization.

### R8: Connected Publication Without Weaker Approval

**User Story:** As a publisher, I want to progress from a tested candidate to a reviewed release without manually reconstructing identities or losing my place at an authentication gate.

**Acceptance Criteria:**
- R8.AC1: WHEN the publisher submits a candidate THEN the existing package/source upload and submission flow SHALL accept its artifacts and receipt, validate their correspondence, and display the next required stage and actor.
- R8.AC2: WHEN approval, signer verification, or authentication is required THEN the workflow SHALL preserve submission and publication-intent context through a validated same-origin return path without transferring sessions or credentials between applications.
- R8.AC3: WHEN publication is retried after interruption THEN it SHALL resume or reconcile the existing bound publication intent and SHALL NOT create conflicting releases or overwrite signed bytes.
- R8.AC4: WHEN publication completes THEN the receipt SHALL identify the published version, source commit, release ID, and package digests; a supported staging install SHALL resolve to those same digests.

### R9: Actionable, Accessible Status and Diagnostics

**User Story:** As a developer or user, I want useful errors and compact status information so that I can recover without reading server logs or guessing which version is active.

**Acceptance Criteria:**
- R9.AC1: WHEN a lifecycle step fails THEN the UI SHALL display the failed stage, a user-readable reason, and only the recovery actions permitted by the authoritative current state.
- R9.AC2: WHEN diagnostic details are copied THEN they SHALL include bounded operation/release/candidate identities, relevant digests, stages, error codes, and observed runtime state; tokens, cookies, signing material, activation handles, signed URLs, and user task content SHALL be excluded.
- R9.AC3: WHEN lifecycle actions are used by keyboard or screen reader THEN controls SHALL have names, progress SHALL be announced without per-poll repetition, and focus SHALL survive progress updates and return from dialogs.
- R9.AC4: WHEN the status view is displayed at 375px or 1440px viewport width THEN controls and error messages SHALL remain usable without horizontal page overflow and SHALL use the host or marketplace's existing theme components.
- R9.AC5: WHEN this workflow ships THEN host public documentation/docmap, SDK authoring instructions, and relevant marketplace READMEs SHALL describe the supported path, trust boundaries, status meanings, and recovery limits.
