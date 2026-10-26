# Requirements

## Introduction

Qualify OR3 for public launch through a complete, repeatable walkthrough of the product and its recovery paths. The deliverable is an executable checklist with observable expected results, supporting evidence, and a release decision. Start with [the walkthrough checklist](tasks.md); [design.md](design.md) explains how to run and record it.

## Context

OR3 is a local-first Nuxt/Vue application using Dexie, with optional authenticated Cloud sync/storage/background providers and separately installed plugins. This checkout uses Bun, supported Node-backed build wrappers, Vitest lanes, and named Playwright harnesses. Its public guides cover chat, documents, projects, knowledge/memory, Files, search, themes/profiles, plugins, workflows, external agents, and administration. The existing Cloud release checklist and update guide remain authoritative for promotion. This plan was prepared on October 25, 2026 against a working checkout containing unrelated in-progress changes; it does not establish a qualified release revision.

## Assumptions

- The request is to prepare the complete walkthrough, not execute it or publish a release.
- The release owner will select the launch modes, provider combinations, browsers, plugins, and exact candidate before execution. A visible or advertised feature must be qualified or removed from launch scope with its entry points disabled.
- Core local behavior and the deployed Cloud profile need distinct evidence. Optional provider/plugin checks apply to every combination advertised at launch; unsupported combinations are not silently included.
- Checks use disposable accounts, synthetic data, isolated destinations, and a defined model-spend budget. Real user data is not a test fixture.
- Each numbered run is approximately one to four hours per selected configuration; individual cases are smaller. Repeats, repair work, large-file soaks, and cross-browser coverage extend total effort.
- All cases begin unexecuted. Existing reports can support a case only when their artifact, provider, configuration, and tested boundary match.

## Out of Scope

- Implementing fixes, running model traffic, contacting users, deploying, publishing packages/images, or creating release tags during checklist authoring.
- Replacing the canonical release procedure, changing Cloud invariants, or treating a UI pass as a security certification.
- Making legal compliance claims, adding a new test framework, or promising unimplemented product capabilities.

## Requirements

### R1: Explicit scope and evidence

**User Story:** As the release owner, I want every result tied to the shipped artifact so that the launch decision is reproducible.

**Acceptance Criteria:**
- R1.AC1: WHEN qualification begins THEN the run SHALL identify the commit/artifact, configuration, provider and plugin versions, roles, devices, fixtures, owner, and start time.
- R1.AC2: WHEN a case is evaluated THEN its record SHALL contain pass, fail, blocked, not run, or justified not applicable status, an observed result, and an evidence or defect reference.

### R2: First use and account entry

**User Story:** As a new user, I want to reach a saved first conversation and understand account and model access.

**Acceptance Criteria:**
- R2.AC1: WHEN a fresh visitor follows an enabled local or Cloud entry path THEN they SHALL reach its intended welcome, sign-in, invitation, or model-connection flow without an unexplained dead end.
- R2.AC2: WHEN credentials, invitations, sessions, or callbacks fail THEN the app SHALL explain recovery, preserve appropriate input, and refuse unauthorized access.

### R3: Durable chat and context

**User Story:** As a chat user, I want sending, stopping, retrying, branching, and changing context to preserve my work.

**Acceptance Criteria:**
- R3.AC1: WHEN a turn is accepted, stopped, failed, retried, or reopened THEN its content, ordering, attachments, and terminal state SHALL agree with durable history without unintended duplicate sends.
- R3.AC2: IF preparation or context admission refuses a request THEN the draft SHALL remain recoverable; context changes and compaction SHALL respect documented capacity, source preservation, and model/provider qualification boundaries.

### R4: Navigation and workspace preferences

**User Story:** As a returning user, I want to find work and restore my preferred layout without losing drafts.

**Acceptance Criteria:**
- R4.AC1: WHEN a user searches, switches tabs/panes, follows a deep link, or reloads THEN the intended accessible resource SHALL open and unrelated drafts SHALL remain intact within their documented persistence lifetime.
- R4.AC2: WHEN a theme, profile, prompt, or preference changes THEN the saved scope SHALL be respected and missing optional capabilities SHALL have an explicit fallback.

### R5: Documents and reviewed AI changes

**User Story:** As a document author, I want edits and AI proposals to save safely and remain recoverable.

**Acceptance Criteria:**
- R5.AC1: WHEN saving succeeds THEN title, content, embedded files, and history SHALL survive reload; IF saving fails or conflicts THEN unsaved changes SHALL remain available with a recovery action.
- R5.AC2: WHEN AI proposes an edit THEN only an accepted, still-valid proposal SHALL mutate its authorized document region; references SHALL remain read-only.

### R6: Projects, knowledge, and memory

**User Story:** As a project user, I want relevant context to follow the owning project without contaminating other work.

**Acceptance Criteria:**
- R6.AC1: WHEN a chat uses project instructions, models, tools, sources, or memory THEN it SHALL use its owning project's saved policy and permitted current evidence.
- R6.AC2: IF extraction, replacement, exclusion, deletion, or a workspace change invalidates context THEN the app SHALL retain valid originals and either omit optional context or visibly refuse missing required context.

### R7: Files and verified recovery

**User Story:** As a workspace owner, I want uploaded files and backups to provide an actual recovery path.

**Acceptance Criteria:**
- R7.AC1: WHEN file transfers, caching, deletion, or restore occur THEN retained references and original bytes SHALL remain consistent, and incomplete operations SHALL not report success.
- R7.AC2: WHEN a local or Cloud backup passes qualification THEN it SHALL have been restored into an isolated supported destination and representative content and file hashes SHALL match.

### R8: Isolation, offline work, and sync

**User Story:** As a user with several workspaces and devices, I want asynchronous work to stay in its originating scope.

**Acceptance Criteria:**
- R8.AC1: WHEN accounts, workspaces, roles, or tabs change during an operation THEN no content, credentials, result, or notification SHALL be delivered to an unauthorized destination.
- R8.AC2: WHEN an offline client reconnects or retries THEN supported changes SHALL converge under the existing ordering, tombstone, idempotency, bounded-queue, and rate-limit contracts.

### R9: Tools and background execution

**User Story:** As a user running tools or long jobs, I want truthful status, approval controls, cancellation, and recovery.

**Acceptance Criteria:**
- R9.AC1: WHEN an action requires approval or is unavailable THEN execution SHALL honor that boundary; recovery SHALL not replay completed side effects.
- R9.AC2: IF a transport fails or a view detaches THEN the app SHALL preserve canonical execution state and origin; completion, failure, cancellation, and notification SHALL reflect the actual job result.

### R10: Optional extensions and integrations

**User Story:** As an extension user, I want installation, permissions, runtime support, and saved data to behave predictably.

**Acceptance Criteria:**
- R10.AC1: WHEN an advertised plugin is installed, configured, enabled, updated, disabled, or removed THEN its verified package and workspace authority SHALL control activation, with retained user data and explicit recovery on failure.
- R10.AC2: WHEN a workflow, external agent, marketplace account, or webhook is included at launch THEN its actual deployed integration SHALL pass its applicable journey, authorization, interruption, and recovery checks.

### R11: Security and privacy boundaries

**User Story:** As a user, I want access controls and credential custody to protect my workspace.

**Acceptance Criteria:**
- R11.AC1: WHEN an unauthorized client accesses a protected resource or mutation directly THEN server/provider authorization SHALL deny access regardless of UI visibility.
- R11.AC2: WHEN content, credentials, logs, exports, or external requests are handled THEN their documented custody and disclosure boundaries SHALL hold, with no unintended script execution or secret exposure.

### R12: Usability and performance

**User Story:** As a desktop, mobile, or assistive-technology user, I want the complete launch journey to remain usable.

**Acceptance Criteria:**
- R12.AC1: WHEN the core journey runs on each supported device/browser THEN keyboard, touch, focus, visible viewport, and accessible control behavior SHALL permit completion.
- R12.AC2: WHEN production and populated-workspace performance checks run THEN the candidate SHALL meet the repository's applicable budgets and the release owner's recorded load/recovery targets.

### R13: Administration and release operations

**User Story:** As an operator, I want configuration, upgrades, health checks, and rollback to preserve service and data.

**Acceptance Criteria:**
- R13.AC1: WHEN administrators change settings or lifecycle state THEN scope, revision checks, secret custody, active-versus-saved state, and restart recovery SHALL match the documented deployment contract.
- R13.AC2: WHEN promotion is requested THEN the canonical code, staging, applicable scale, backup/restore, and rollback gates SHALL have evidence for the exact artifact and provider stack.

### R14: Public readiness and sign-off

**User Story:** As the launch owner, I want public claims and support arrangements to match the qualified product.

**Acceptance Criteria:**
- R14.AC1: WHEN a user follows launch documentation THEN visible features, costs, limits, recovery instructions, privacy disclosures, and support links SHALL match the shipped configuration.
- R14.AC2: WHEN the release decision is recorded THEN there SHALL be no unresolved critical/high-impact launch blocker, no unexplained unexecuted applicable case, and named owners for monitoring and accepted minor defects.
