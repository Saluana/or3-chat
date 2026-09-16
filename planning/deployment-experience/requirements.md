# Requirements

## Introduction

Make OR3 Cloud installation, updates, and recovery predictable for owners and maintainers. A healthy deployment must not become unusable to the management tools because cleanup failed, and an operator must be able to understand the live state without reading CLI source. This is an implementation plan, not a release authorization or a claim that the proposed commands already exist.

## Context

Inspected the `or3-cloud` checkout on 2026-09-15, initially at `3515053d` and subsequently `1294a6ecde95f45066a8f8f3ff8018796dbad2a9`; intervening changes were unrelated UI work. OR3 uses Nuxt 4/Vue, Bun 1.3.14 for development, Vitest plus Bun CLI tests, and a managed Basic Auth + SQLite + filesystem profile. The standalone TypeScript CLI in `packages/or3-cloud/src/cli.ts` owns JSON state, authenticated backups, Docker Compose/Caddy assets, and a deployment lease. Its published package version is recorded locally as 0.1.67. The dashboard invokes exact, provenance-verified packages through `packages/or3-cloud/assets/dashboard-operator.mjs`. Current candidate qualification already includes legacy unsigned/adoption fixtures and rollback/restart/persistence checks. `docs/cloud-updates.md` separates source development, development images, and stable managed releases; `docs/releasing.md` defines candidate evidence and immutable tag publication. No tests, registry checks, workflow dispatches, or production operations were performed for this plan.

## Assumptions

- Primary scope is the managed local/VPS deployment experience, including its dashboard and release tooling. Source-development guidance is included where it prevents deployment confusion.
- Preserve existing deployment identities, single-writer leases, exact artifact binding, backup authentication, registration policy, and data protection. Easier operation must not depend on bypassing them.
- Historical unsigned archives must remain available as historical artifacts, but cannot acquire retroactive authenticity merely because their checksums are internally consistent.
- Users should normally need one preview and one update action. Routine update runs the same preflight automatically; preview is optional.
- A recovery action that can discard writes requires an explicit choice. Missing proof is not proof that replacement completed.
- Use current components and test harnesses. No new hosted service, scheduler, deployment framework, or paid monitoring dependency is necessary.
- CI scope is explicitly capped: reuse existing jobs and builds, keep essential update/recovery regressions mandatory, and place broader historical/browser matrices in existing Extended validation for relevant changes. Existing security and publication gates remain intact.
- Public command examples in this plan are proposed interfaces. Production runbooks remain unchanged until implementation ships.
- Do not choose or reserve release versions during planning. A compatibility release may precede the new operation format; exact identities are selected during qualification.
- Existing user commits and edits are outside this plan. Only these three planning documents are created.

## Out of Scope

- Implementing, testing, publishing, or deploying the plan during this task.
- Zero-downtime clustering, Kubernetes, alternative storage providers, or a redesigned installer wizard.
- Silently importing/signing legacy backups, changing application authentication, automatic account creation, or weakening CSP to wildcards.
- Manual npm/GHCR publication as a qualification bypass, moving immutable tags, or using development images in managed production.
- A general backup forensics/import product, unattended destructive rollback, or automated purchases and CI billing changes.
- New CI workflows, jobs, runners, services, schedules, required status contexts, or additional image builds introduced by this plan. A new cross-workflow gating or artifact-orchestration system is also out of scope.

## Requirements

### R1: Durable deployment completion independent of cleanup

**User Story:** As an owner, I want an update that installed a healthy release to remain complete when retention or receipt cleanup fails.

**Acceptance Criteria:**

- R1.AC1: WHEN replacement and required checks succeed THEN the CLI SHALL atomically persist the target identity, rollback reference, terminal result, and absence of a pending operation before optional pruning or operation-file deletion.
- R1.AC2: IF optional housekeeping fails THEN the CLI SHALL preserve the running version, report a maintenance warning, and permit the next otherwise-safe operation; it SHALL NOT recreate a pending update or restore old data.
- R1.AC3: IF the terminal state write fails or its completion is uncertain THEN the CLI SHALL report an unresolved commit, preserve recovery evidence, and determine the durable outcome on retry before performing replacement or restoration.
- R1.AC4: WHEN a privileged operator handoff is incomplete THEN the system SHALL report that boundary separately from backup retention and SHALL NOT describe an unverified operator as successfully upgraded.

### R2: Complete backup inventory with explicit trust

**User Story:** As an owner of a long-lived deployment, I want historical or damaged backups to be visible without making unrelated safe updates impossible.

**Acceptance Criteria:**

- R2.AC1: WHEN scanning a backup store THEN the CLI SHALL return a classified entry or bounded diagnostic for every directory entry, including verified, legacy unsigned, legacy adoption, unsupported format, invalid, and unreadable entries, independent of enumeration order.
- R2.AC2: IF an entry lacks trusted metadata or has invalid authentication/checksums THEN automatic retention SHALL preserve it; explicit restore/export/recovery SHALL still reject it as a trusted restore source.
- R2.AC3: WHEN planning retention THEN it SHALL protect the immediate rollback point and every source/pre-mutation backup referenced by an unfinished operation; routine pruning SHALL have no force path that overrides those protections.
- R2.AC4: IF a suspect entry is unrelated to the requested operation THEN inventory SHALL report it without blocking a fresh authenticated snapshot and update; IF an operation depends on that entry THEN validation SHALL block before destructive mutation. A store-level read failure SHALL be distinguished from an individual bad entry.

### R3: Recovery can finish a proven replacement or explicitly restore

**User Story:** As an owner, I want to keep a healthy completed replacement when its final bookkeeping was interrupted, while retaining a safe restore option.

**Acceptance Criteria:**

- R3.AC1: WHEN `recover --dry-run` is requested THEN it SHALL explain the observed source/target identities, durable phase, available evidence, permitted recovery actions, and each action's data-loss boundary without mutation.
- R3.AC2: WHEN `recover --finish` is requested THEN it SHALL commit the existing live target only if replacement completion, exact release identity, generated assets, deployment binding, database integrity/ownership, and required local/public health are proven; it SHALL preserve writes made after replacement.
- R3.AC3: IF a journal indicates partial data replacement, restoring the previous deployment, conflicting identity, or insufficient legacy evidence THEN finish SHALL refuse without mutation. Deep health alone SHALL NOT authorize adoption.
- R3.AC4: WHEN recovery requires restoring a snapshot THEN the preview SHALL name its ID/time and the writes that will be discarded; destructive execution SHALL require `recover --restore --yes`. Automatic recovery SHALL never turn an attempted finish into a restore.
- R3.AC5: WHEN recovery is repeated after successful completion THEN it SHALL report the recorded outcome without replaying data replacement or deleting the rollback point.

### R4: Diagnostics remain available during interrupted operations

**User Story:** As an operator, I want to inspect a blocked deployment without first changing or repairing it.

**Acceptance Criteria:**

- R4.AC1: WHILE an operation or lease exists THEN `status`, `doctor`, backup inventory, `verify --read-only`, and recovery/update previews SHALL remain usable without acquiring, reclaiming, or changing the mutation lease.
- R4.AC2: WHEN read-only verification runs THEN it SHALL NOT create sessions, upload probes, checkpoint/write databases, create helper containers, pull images, repair files, or clear journals; unavailable checks SHALL be reported as unknown or skipped.
- R4.AC3: IF state, environment, or a referenced asset is unreadable THEN diagnostics SHALL report independent evidence and the exact failing boundary rather than fail solely through `loadManaged`. A changing state/lease observation SHALL be labeled in progress and SHALL not authorize mutation.
- R4.AC4: WHILE recovery is pending THEN data-changing commands and full verification SHALL remain gated; start/stop/restart SHALL use an explicit phase policy rather than provide an accidental bypass. Logs and observation SHALL remain available.

### R5: Preflight before downtime, with a truthful dry run

**User Story:** As an owner, I want all detectable blockers presented before OR3 stops serving users.

**Acceptance Criteria:**

- R5.AC1: WHEN `update --to <version> --dry-run` runs THEN it SHALL report exact source/target identities, compatibility, architecture, space estimates, backup inventory, protected snapshots, asset changes, expected downtime stages, prune decisions, and all independently detectable blockers.
- R5.AC2: WHEN preview runs THEN it SHALL NOT write deployment state/assets/leases, pull images, stop services, create snapshots, or prune. It SHALL mark checks requiring a real image pull, writable probe, or fresh snapshot as deferred, not passed.
- R5.AC3: WHEN a real update begins THEN it SHALL recheck the preview assumptions under the existing lease, resolve/pull and validate app/operator artifacts before stopping the app, and verify a fresh rollback snapshot before replacement.
- R5.AC4: IF preflight has blockers THEN update SHALL leave the existing deployment unchanged. Independent findings SHALL be reported together in stable severity/code/path order; dependent checks SHALL explicitly name their unmet prerequisite.

### R6: Clear results, errors, and receipts

**User Story:** As an owner or automation author, I want one reliable answer to what happened, what is running, and what I should do next.

**Acceptance Criteria:**

- R6.AC1: WHEN an update or recovery returns THEN it SHALL distinguish blocked-before-change, completed, completed-with-warnings, restored, and needs-recovery outcomes, including observed versus intended version/digest and an observation timestamp.
- R6.AC2: WHEN an error is shown THEN it SHALL include a stable code, actual phase, affected resource, evidence about data/runtime state, and a supported exact-version next action; it SHALL NOT instruct users to remove or edit managed state manually.
- R6.AC3: WHEN `--json` is selected on the planned operational commands THEN stdout SHALL contain one versioned result object and progress SHALL go to stderr. Successful updates with housekeeping warnings SHALL exit 0; blockers or incomplete operations SHALL exit nonzero.
- R6.AC4: WHEN completion is persisted THEN a small owner-only receipt SHALL record source/target, CLI version, available source revision, app/operator digests, rollback ID, checks, warnings, and timings. Receipt export failure SHALL not invalidate a durable deployment commit; secrets and raw configuration SHALL be excluded.

### R7: Dashboard behavior matches the CLI

**User Story:** As a dashboard user, I want a preview, understandable progress, and a trustworthy outcome even when the app restarts.

**Acceptance Criteria:**

- R7.AC1: WHEN a compatible update is selected THEN the existing Operations card SHALL display the CLI-backed preview and the resolved target before one confirmation starts the job.
- R7.AC2: WHEN the connection drops during replacement THEN the card SHALL show reconnecting, preserve the accepted job ID, resume observation after reload, and never resubmit an accepted update.
- R7.AC3: WHEN the operation completes THEN the card SHALL distinguish installed release, verification gaps, cleanup warnings, restored failure, and recovery required; phase changes SHALL be announced accessibly using existing Nuxt UI patterns.
- R7.AC4: IF the operator/client protocol is incompatible THEN the card SHALL provide the supported host/bridge path. Privileged mutations SHALL retain super-admin authorization, same-origin controls, provenance verification, and deployment lease enforcement.

### R8: Verify the actual first-use browser journey

**User Story:** As a user, I want a newly deployed app to let me sign in, connect OpenRouter, and retain my work.

**Acceptance Criteria:**

- R8.AC1: WHEN a candidate changes browser-facing Caddy/CSP behavior, authentication, or the connection flow THEN the maintainer SHALL run the focused Chromium journey behind shipped Caddy through an existing Extended validation job or the same local harness before tagging. Broader WebKit/mobile coverage SHALL live in Extended validation and run for relevant browser/auth changes, not become an additional mandatory candidate job for every release.
- R8.AC2: WHEN external services are simulated THEN the harness SHALL preserve browser origin, CSP, and CORS enforcement and label evidence as simulated; a restrictive `connect-src 'self'` negative control SHALL fail the connection check. CI SHALL use synthetic credentials and make no paid model requests or real key-creation requests.
- R8.AC3: IF a code exchange fails or the result is uncertain THEN the UI SHALL offer a fresh authorization flow, avoid duplicate error toasts, and never silently replay the same code. It SHALL distinguish a confirmed CSP violation from an otherwise unclassified network failure.
- R8.AC4: IF live OpenRouter authorization was not performed THEN deployment receipts SHALL say it is unverified; infrastructure checks and deterministic browser fixtures SHALL not claim live third-party success.

### R9: Qualification models deployment history and interruption

**User Story:** As a maintainer, I want failures found against realistic historical states before consuming a release version or touching production.

**Acceptance Criteria:**

- R9.AC1: WHEN qualifying lifecycle changes THEN the existing Cloud tests SHALL cover the historical formats and invalid-entry cases, and the existing candidate lifecycle job SHALL retain its current published-source and legacy adoption/unsigned fixtures. Additional historical-version combinations SHALL run in existing Extended validation for backup/state/migration changes; fixture provenance SHALL be recorded without adding a candidate job matrix.
- R9.AC2: WHEN faults are injected at snapshot, replacement, target-ready, terminal-commit, housekeeping, and operator-handoff boundaries THEN assertions SHALL cover durable state, command availability, permitted recovery actions, actual digest, and preserved conversation/file data.
- R9.AC3: WHEN finish recovery is tested THEN fixtures written after replacement SHALL survive; WHEN restore is tested THEN the documented snapshot boundary SHALL be observed. Repeating either completed recovery SHALL cause no additional data replacement.
- R9.AC4: WHEN qualifying a release THEN essential completion, cleanup, protected-backup, and safe-recovery regressions SHALL run in the existing required Cloud tests and lifecycle job before candidate evidence is created, reusing exact candidate artifacts. Broader Docker interruption/history and browser combinations SHALL run through existing Extended validation when the corresponding behavior changes, with relevant results reviewed before tagging rather than a new always-on gate.

### R10: Release readiness detects infrastructure blockers early

**User Story:** As a maintainer, I want release setup failures diagnosed before expensive builds or immutable publication steps.

**Acceptance Criteria:**

- R10.AC1: WHEN release preparation requests repository readiness THEN it SHALL inspect default-branch workflow presence/registration, workflow enablement, required permissions, registry reachability, and available CI-capacity evidence; unavailable billing/capacity data SHALL be reported as unknown, never inferred as available.
- R10.AC2: IF qualification cannot run THEN the report SHALL state the blocked stage and supported administrator remedy, retain local results, and SHALL NOT recommend tagging, manual publication, or weakening candidate evidence.
- R10.AC3: WHEN checks are retried THEN unchanged candidates SHALL reuse the existing qualified build artifacts where documented; changed source or consumed identities SHALL follow existing immutable-version rules. Workflow summaries SHALL expose stage timing and artifact identities.
- R10.AC4: WHEN the runbook describes CI exhaustion THEN it SHALL explain how to restore the supported GitHub workflow capacity and rerun the failed stage, including account-controlled prerequisites; it SHALL not promise an unqualified offline publication escape hatch.
- R10.AC5: WHEN implementing this plan THEN CI changes SHALL add zero workflows, jobs, runner requirements, services, schedules, required status contexts, or image build invocations; new cases SHALL use existing suites/jobs and already-built artifacts.
- R10.AC6: WHEN selecting deeper checks THEN maintainers SHALL use existing named Extended validation suites for the affected behavior, retain results bound to the tested source/artifacts, and SHALL NOT add a new selector service, cross-workflow dependency gate, or duplicate qualification pipeline. Existing mandatory release/security checks SHALL remain required.

### R11: Release identity and fix status are understandable

**User Story:** As an operator choosing a version, I want to know which component changed and whether my specific issue is fixed.

**Acceptance Criteria:**

- R11.AC1: WHEN a stable release is prepared THEN its notes SHALL distinguish CLI changes, application changes, generated assets, dependency/image rebuilds, fixed issue references, and rollback/data-loss implications, including an explicit no-change statement for unchanged components.
- R11.AC2: WHEN status/preview/receipts show versions THEN they SHALL distinguish the invoking CLI, installed application, expected app/operator images, observed images, and available source revisions; an image-only rebuild SHALL not be presented as a CLI bug fix.
- R11.AC3: WHEN publication is reported complete THEN evidence SHALL separately record candidate qualification, tag workflow status, npm exact version/integrity, public multi-architecture digests, post-publication checks, and production deployment/acceptance status; a published artifact SHALL not imply a deployed application.

### R12: Supported setup and next actions are easy to find

**User Story:** As a new owner or developer, I want the right startup, update, and account-recovery path without guessing which repository or tool controls my app.

**Acceptance Criteria:**

- R12.AC1: WHEN an operator reads the primary setup/update docs or CLI completion output THEN it SHALL identify managed local, managed VPS, development Compose, and source checkout paths with one recommended next action appropriate to that path.
- R12.AC2: WHEN initial credentials are handed off THEN output SHALL explain how to save the protected credential file and how a host owner can invoke the existing managed credentials reset; it SHALL distinguish application-owner and admin access without exposing passwords or changing invite-only policy.
- R12.AC3: WHEN documenting `bun install` and `bun run dev` THEN guidance SHALL identify the pinned toolchain and explain that dev serves the local checkout/installed dependencies, not the latest npm release or VPS image. A broken dependency tree SHALL lead to scoped diagnosis/reinstall guidance, not deletion of source or lockfiles.
- R12.AC4: WHEN these interfaces ship THEN `docs/cloud-updates.md`, affected package/provider READMEs, and the relevant `public/_documentation/` pages/docmap SHALL agree on preview, recovery, results, and exact-version production commands; obsolete manual-state-edit advice SHALL be removed.

### R13: Safe compatibility and bounded operational work

**User Story:** As an existing customer, I want the new deployment tools to upgrade my installation without introducing another compatibility trap.

**Acceptance Criteria:**

- R13.AC1: WHEN a new recovery format changes the meaning of persisted phases THEN compatible readers SHALL ship before writers; unsupported old CLI/operator versions SHALL fail before data mutation, with a documented bridge upgrade path.
- R13.AC2: WHEN CLI and dashboard mutations race or restart THEN at most one lease owner SHALL mutate the deployment. Recovery SHALL not steal a live lease, and observers SHALL not rewrite state to resolve a race.
- R13.AC3: WHEN scanning or deleting artifacts THEN path confinement, no-follow checks, authenticated metadata, and protected-backup checks SHALL prevent a symlink, changed entry, or external path from selecting deletion outside the trusted backup root.
- R13.AC4: WHEN external commands or checks stall THEN existing bounded deadlines SHALL apply, phase progress SHALL appear at least every 15 seconds during a wait, and reports SHALL retain completed checks. No new daemon, queue, telemetry service, or speculative cache SHALL be required.
