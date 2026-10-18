# Requirements

## Introduction

Make server restarts initiated from the OR3 admin dashboard safe, observable, and fast in managed production deployments and source development. Replace the current delayed process exit and development-mode refusal with a supervised operation that protects active work, applies supported configuration changes correctly, and verifies recovery. This plan covers restart behavior and the related save-settings/rebuild surfaces identified in the October 17, 2026 audit; it does not authorize deployment or implementation by itself.

## Context

OR3 uses Nuxt 4.5.2, Vue, Nitro 2.13.4, Bun repository commands, Vitest, and Playwright. The admin API already provides deployment-super-admin, SSR, host, and same-origin guards. `server/admin/system/server-control.ts` writes a working-directory marker and calls `process.exit(0)` after 250 ms; development requests are rejected. Separate OR3 and Nitro shutdown handlers exist, while background jobs have provider-owned leases, checkpoints, and fenced writes. Managed Cloud already has a Unix-socket operator, a deployment mutation lease, durable recovery state, and a read-only application container. The source launcher owns runtime selection and provider preparation but currently preloads `.env` into inherited environment variables. The current restart UI only acknowledges initiation. All 12 focused restart/shutdown tests passed during the audit, but isolated probes reproduced interrupted work, ignored job counts, an unbounded lookup, an unwritable marker, and stale inherited configuration; those probes were not production-container E2E qualification.

## Assumptions

- Initial supported targets are the managed single-host Basic Auth/SQLite/filesystem profile and source development started by OR3's launcher on macOS/Linux. Other launchers, Windows, arbitrary production process managers, and multi-instance deployments report unsupported until independently qualified.
- The same admin restart flow serves Operations, Registration, and Themes. Existing user edits in those surfaces must be preserved during implementation.
- A brief interruption is acceptable; preserving committed data, local drafts, and correct tool outcomes takes priority over speed.
- The default policy waits for active work, with a five-minute maximum preparation period. Expiry cancels a dashboard restart before process termination. An explicit alternative may interrupt only work with a qualified recovery contract.
- Initial performance targets on a recorded reference runner are warm idle outage p95 <= 10 seconds for managed restart and <= 60 seconds for development restart. These are proposed qualification targets, not measured current performance or promises for every machine.
- Routine restarts keep the same application image, data volume, credentials, and provider stack. They do not require a complete backup, registry lookup, package installation, or build.
- Supported settings apply through the authoritative launch configuration. Configuration provenance and effective values must be verified; setting changes that alter credentials, ports/origin, provider selection, database paths, or deployment identity remain operator/source setup work in this first implementation.
- Commands in this plan are contributor commands run through Bun. Existing runtime selection for native SQLite and managed container runtimes remains intact; this work does not migrate application runtimes.
- Current code and `docs/cloud-updates.md` govern managed recovery. Older dashboard-update planning language about unconditional automatic data rollback is not authoritative.

## Out of Scope

- Zero-downtime replicas, distributed restart orchestration, or sharing local SQLite/filesystem state across hosts.
- Automatically replaying uncertain tool effects or promising continuation of the same interrupted upstream model stream.
- Image updates, package publication, version bumps, release ceremonies, or automatic database/data rollback.
- A new general-purpose job service, unrestricted command runner, or Docker access inside the application container.
- A new production source-build service. The unsafe in-process rebuild action is retired; separately staged builds remain a future feature.
- Hot reloading arbitrary auth/provider configuration. Existing safe runtime-readable settings may avoid restart; startup-bound settings still require verified activation.
- Changing canonical user/workspace storage, workspace DB scoping, sync wire format, cursor semantics, or static-build behavior.

## Requirements

### R1: Truthful availability and authorization

**User Story:** As a deployment super admin, I want restart availability to reflect the actual launch environment, so that an enabled button represents an operation the host can perform.

**Acceptance Criteria:**
- R1.AC1: WHEN a restart surface loads THEN it SHALL expose a typed capability identifying `managed`, `development`, or `unsupported`, permitted actions, and a redacted unavailable reason.
- R1.AC2: WHEN a browser reads or mutates restart state THEN the API SHALL enforce deployment-super-admin access and the existing SSR/host gates; mutations SHALL additionally enforce same-origin intent and a dedicated bounded rate limit.
- R1.AC3: IF a supervisor, required protocol, writable operation store, or supported configuration path cannot be established THEN the system SHALL refuse before draining or exiting.
- R1.AC4: WHILE running a static build or an unsupported launcher THEN no development control channel or operator dependency SHALL be required by client output.

### R2: One operation with durable identity

**User Story:** As an administrator, I want a restart to survive a lost response or browser reload without accidentally starting it twice.

**Acceptance Criteria:**
- R2.AC1: WHEN a validated request is accepted THEN the controller SHALL persist its operation before returning HTTP 202 with the operation ID; acceptance SHALL take <= 2 seconds on the healthy local qualification fixture and SHALL NOT await restart completion.
- R2.AC2: WHEN the same request ID and payload are submitted again within the advertised 24-hour replay window THEN the controller SHALL return the original operation, including terminal results; reused IDs with different payloads SHALL be rejected.
- R2.AC3: WHEN distinct lifecycle mutations race THEN exactly one SHALL acquire the authoritative lock; managed restart SHALL share the existing lease with CLI updates, backups, restores, credential changes, and lifecycle commands.
- R2.AC4: IF the controller crashes across an execution boundary THEN recovery SHALL inspect recorded identity and live state before any further mutation and SHALL report `needs_attention` rather than blindly repeat an uncertain termination or replacement.

### R3: Coordinated, bounded shutdown

**User Story:** As a user with in-flight work, I want a restart to drain owned work and close resources in a defined order.

**Acceptance Criteria:**
- R3.AC1: WHEN restart preparation begins THEN new long-lived work SHALL be deferred, existing work and its completion/control requests SHALL remain able to finish, and readiness SHALL cease advertising normal admission.
- R3.AC2: WHEN final draining begins THEN request work, persistence flushes, observers, and provider cleanup SHALL participate in one lifecycle controller; passive SSE observers SHALL NOT consume the entire drain window.
- R3.AC3: WHEN a shutdown deadline is set THEN every provider lookup and participant SHALL be bounded by the remaining monotonic deadline, with no unbounded lookup preceding it.
- R3.AC4: WHEN all required work settles THEN draining SHALL finish promptly; the default final application drain budget SHALL be 15 seconds, with supervisor/container termination budgets leaving at least five seconds for final cleanup.
- R3.AC5: IF an external termination signal arrives THEN it SHALL enter the same lifecycle once, with one final-exit owner; dashboard restart SHALL NOT call `process.exit()` from its route/helper or race an independent Nitro exit timer.

### R4: Honest background and tool recovery

**User Story:** As someone generating responses or executing tools, I want restart to preserve durable progress and avoid duplicate side effects.

**Acceptance Criteria:**
- R4.AC1: WHILE preparing a restart THEN background claim/recovery schedulers SHALL stop admitting new execution, while owned work retains leases needed to finish safely.
- R4.AC2: WHEN the default wait policy reaches five minutes with active execution or unresolved tool outcomes THEN the operation SHALL cancel before termination, restore normal admission, and explain the blocker.
- R4.AC3: IF explicit recoverable interruption is selected THEN only participants/providers advertising and passing a fenced checkpoint/handoff contract SHALL be interrupted; lease release SHALL occur only after execution is quiescent and its checkpoint is durable.
- R4.AC4: WHEN a job recovers THEN completed tool receipts SHALL remain authoritative; uncertain effects SHALL not replay, and any repeated model request/partial-output reset SHALL be surfaced as recovery rather than seamless continuation.
- R4.AC5: IF a memory-backed job, workflow, browser tool, or plugin cannot prove safe handoff THEN the dashboard SHALL wait for completion or refuse interruption; a generic abort SHALL not masquerade as restart-safe suspension.
- R4.AC6: WHEN SQLite or Convex background execution is selected THEN wait-policy accounting SHALL include streaming jobs, parked browser tools, workflows and pending admission/history delivery across the durable store. Zero SHALL prove no blockers; missing backend capabilities or lookup failures SHALL never authorize replacement.

### R5: Managed restart without deployment drift

**User Story:** As a managed Cloud owner, I want dashboard restart to operate within the deployment's existing safeguards.

**Acceptance Criteria:**
- R5.AC1: WHEN managed restart executes THEN it SHALL use the existing operator and qualified Cloud lifecycle implementation with exact deployment/container identity; the app SHALL receive neither Docker access nor a host deployment-directory mount.
- R5.AC2: WHEN restarting unchanged configuration THEN the operation SHALL preserve the selected image digest, volume identity, credentials, and rollback references and SHALL perform no image pull, data restore, or full-volume backup.
- R5.AC3: IF a managed mutation/recovery journal is incomplete THEN dashboard restart SHALL refuse under the same gate as the CLI.
- R5.AC4: WHEN verifying restart THEN the operation SHALL require a new application boot ID, the expected deployment/image identity, bounded provider readiness, and the expected configuration revision; an HTTP 200 from the old process SHALL not satisfy completion.
- R5.AC5: IF new startup or verification fails THEN the operator SHALL retain the operation evidence and data, remain available for diagnosis, and SHALL NOT automatically restore a database snapshot.

### R6: Configuration is saved and activated correctly

**User Story:** As an administrator changing settings, I want the UI to distinguish saved configuration from the values actually running.

**Acceptance Criteria:**
- R6.AC1: WHEN a setting is saved THEN it SHALL be validated and classified as already runtime-readable, restart-required, build-required, or unsupported for dashboard application; a no-op save SHALL not create a restart requirement.
- R6.AC2: WHEN supported settings are persisted THEN the authoritative controller SHALL serialize writes, preserve unrelated entries, write privately and atomically, and return an opaque revision with optimistic concurrency checking.
- R6.AC3: WHEN managed environment changes are activated THEN the controller SHALL recreate only the application service from validated authoritative configuration, preserving image/volume identity; it SHALL not assume container restart reloads `env_file`.
- R6.AC4: WHEN the new process starts THEN the server SHALL attest its effective allowed settings against the expected revision; external overrides, removed keys, or mismatched settings SHALL prevent a false `succeeded` result.
- R6.AC5: IF the saved revision changes after confirmation THEN the operation SHALL reject the stale request or require a new confirmation before activation, rather than apply an unseen revision.
- R6.AC6: WHEN configuration activation fails THEN the UI SHALL retain saved/current distinctions and a recoverable diagnostic; it SHALL not silently relax registration policy, rotate keys, or restore user data.

### R7: Functional development restart

**User Story:** As a source developer, I want the dashboard to restart my dev server without returning to the terminal.

**Acceptance Criteria:**
- R7.AC1: WHEN launched through `bun run dev` or `bun run dev:ssr` with authorized restart enabled THEN the dashboard SHALL restart through the surviving OR3 launcher, replacing its owned Nuxt child and reconnecting on the same selected origin.
- R7.AC2: WHEN the child is relaunched THEN the launcher SHALL reload file-derived environment values, honor genuine shell/CLI overrides, handle deleted file keys, and retain the chosen runtime, arguments, port, terminal output, and HTTPS configuration.
- R7.AC3: WHEN normal restart occurs THEN it SHALL preserve caches and prepared provider artifacts and SHALL not unconditionally reinstall packages, rebuild providers, or redeploy Convex; invalidated prerequisites SHALL return a typed setup/build-required result.
- R7.AC4: WHEN `.env` watcher activity and manual restart overlap THEN the owning launcher SHALL coalesce them into one operation for the target revision.
- R7.AC5: WHEN Ctrl+C is received or replacement startup fails THEN only the owned child/process tree SHALL be affected; repeated restarts SHALL leave no orphan worker, duplicate watcher, occupied stale port, or hidden respawn loop.
- R7.AC6: WHEN two consecutive dev restarts complete THEN admin authentication, effective configuration, HMR, and configured HTTPS SHALL remain functional without requiring manual process cleanup.

### R8: Shared restart experience

**User Story:** As an administrator, I want every restart button to show the same reliable progress and result.

**Acceptance Criteria:**
- R8.AC1: WHEN a restart is accepted THEN Operations, Registration, and Themes SHALL share state for preparation, restart, reconnection, verification, and terminal outcome, and SHALL disable duplicate/conflicting actions.
- R8.AC2: IF a response is lost or the browser reloads THEN the client SHALL reconcile using the same operation/request identity and SHALL NOT automatically submit a new restart.
- R8.AC3: WHILE the server is unreachable THEN polling SHALL use bounded requests and jitter; after the configured observation deadline the UI SHALL show an uncertain/needs-attention state instead of claiming failure or success from connectivity alone.
- R8.AC4: WHEN verified recovery succeeds THEN affected server data SHALL refresh automatically and the restart notice SHALL clear only if the intended settings are active; local drafts, current route, and workspace state SHALL be preserved.
- R8.AC5: IF reauthentication is actually required THEN the UI SHALL preserve operation identity and resume observation after sign-in, without replaying the mutation.

### R9: Client continuity during maintenance

**User Story:** As a connected user, I want a planned restart to pause server activity without losing local work or exhausting healthy retries.

**Acceptance Criteria:**
- R9.AC1: WHEN maintenance produces retryable transport errors THEN sync and file transfer queues SHALL retain original operation identities, local bytes, cursors, and pending state; announced maintenance SHALL not consume permanent-failure retry budgets.
- R9.AC2: WHEN the server recovers THEN transports SHALL reconnect with bounded jitter and existing idempotency/fencing; they SHALL not create a second paid generation or replay an uncertain tool automatically.
- R9.AC3: WHILE maintenance persists beyond the observation window THEN clients SHALL reduce retry traffic and show recoverable status while retaining pending data; genuine authorization or validation failures SHALL remain distinct.
- R9.AC4: WHEN reconnecting in another workspace or tab THEN completion and retry writes SHALL remain scoped to the originating workspace and SHALL not require clearing Dexie, credentials, or browser caches.

### R10: Safe rebuild boundary

**User Story:** As an operator, I want restart controls to avoid rewriting a running application build.

**Acceptance Criteria:**
- R10.AC1: WHEN the legacy rebuild-and-restart endpoint is called THEN it SHALL perform no shell/build execution and SHALL return a typed build-required/unsupported result with deployment-appropriate guidance.
- R10.AC2: WHEN a managed installation needs new code THEN the UI SHALL direct the administrator to the existing qualified update flow; source installations SHALL point to the existing source build/deployment documentation.
- R10.AC3: WHILE ordinary restart runs THEN live `.output` files SHALL remain unchanged and no arbitrary command field SHALL cross the lifecycle control protocol.

### R11: Measured speed and bounded diagnostics

**User Story:** As a maintainer, I want evidence explaining restart latency and failure without unbounded logs or secret exposure.

**Acceptance Criteria:**
- R11.AC1: WHEN an operation changes phase THEN structured records SHALL capture operation/boot identity, phase, elapsed time, workload counts, and a typed reason; credentials, file contents, prompts, and raw environment values SHALL be excluded.
- R11.AC2: WHEN qualifying warm idle restarts on the recorded reference runner THEN at least 20 managed runs and 10 dev runs SHALL report outage p50/p95/max against the assumed 10-second/60-second p95 targets, with preparation time reported separately.
- R11.AC3: WHILE retaining receipts THEN storage SHALL be bounded, active/unresolved operations SHALL never be evicted, and a full replay store SHALL refuse new work before breaking the promised replay window.
- R11.AC4: WHEN a phase exceeds its budget THEN the result SHALL identify that phase and its failure code; verification retries SHALL not silently become repeated process restarts.

### R12: Qualification, documentation, and compatibility

**User Story:** As a maintainer, I want repeatable proof that dashboard restarts preserve data and work across supported modes.

**Acceptance Criteria:**
- R12.AC1: WHEN implementation of a boundary is scoped THEN its credible failures and regression coverage SHALL be recorded before production code changes; new regression tests SHALL demonstrate the intended failure before the repair, favoring real process/browser boundaries.
- R12.AC2: WHEN qualification runs THEN a named isolated E2E harness SHALL exercise real dashboard restarts, two tabs, sync writes, upload/commit, generation/tool recovery, failed startup, lost acknowledgement, concurrent requests, and controller interruption without paid-network calls or live user data.
- R12.AC3: WHEN qualification completes THEN it SHALL retain redacted JSON results, timings, browser traces/screenshots, exact runtime/build identities, before/after record and file checksums, and cleanup evidence.
- R12.AC4: WHEN shipping this feature THEN static/SSR gates, legacy operator protocol compatibility, and relevant provider builds SHALL pass; unsupported older operators SHALL fail closed without changing their existing update response schemas.
- R12.AC5: WHEN behavior changes THEN public development, auth, environment, operations, background execution, sync/storage guidance, and docmap references SHALL describe the implemented contract; deployment procedures SHALL remain centralized in `docs/cloud-updates.md`.
