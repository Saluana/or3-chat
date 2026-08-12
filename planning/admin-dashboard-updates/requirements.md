# Requirements

## Introduction

OR3 Cloud administrators need to apply supported OR3 releases from the admin dashboard without opening a terminal or running Docker commands for each update. The feature will expose the existing managed `@or3/cloud` update safety model through a one-click dashboard flow rather than create a second updater. Docker remains an installation/runtime prerequisite, but routine update operations become an implementation detail.

## Context

`or3-chat` is a Nuxt 4/Vue application using Bun and Vitest, with a deployment-level super-admin dashboard under `/admin`. Managed Basic Auth + SQLite + filesystem deployments are installed and operated by the version-matched `@or3/cloud` package and a generated Docker Compose project. Its existing `update` command already pins exact package/image versions, records image digests and pending operations, creates checksum-verified stopped-volume backups, installs versioned Compose/Caddy assets, waits for deep health, and automatically restores the previous image/data on failure. The application container currently has no Docker socket or deployment-directory mount, while the release workflow publishes the qualified GHCR image before the matching npm package becomes the stable registry version.

## Assumptions

- Dashboard updates apply only to the supported single-node managed `@or3/cloud` profile; source checkouts, custom Compose layouts, and unsupported provider stacks keep their existing manual operations.
- A brief service interruption is acceptable because the existing safe update path stops the application to create a consistent data backup.
- The npm `latest` version of `@or3/cloud` remains the stable release pointer and is published only after the matching application image has been qualified and promoted.
- New managed installations may add one narrowly scoped operator sidecar. Existing managed installations require one final exact-version CLI update to install that bridge.
- The existing deployment super-admin identity is the only role authorized to start a deployment update.
- The administrator's session secrets and application data remain in the persistent managed volume, so an application-container replacement does not intentionally invalidate the admin session.
- Dashboard updates require an active Docker context backed by a bind-mountable Unix socket; unsupported remote/TCP contexts keep the existing host CLI path and report the dashboard bridge unavailable.

## Out of Scope

- Removing Docker from installation or from the managed runtime.
- Automatic, scheduled, unattended, beta-channel, or version-picker updates.
- Starting manual data rollback or arbitrary backup restore from the dashboard.
- Publishing OR3 releases from the dashboard or changing the current candidate/tag/npm/GHCR promotion policy.
- Supporting generated source deployments, custom images, arbitrary registries, multi-node deployments, or non-managed Compose projects.
- Exposing Docker Engine, shell commands, raw updater logs, or deployment secrets to the application container or browser.

## Requirements

### R1: Managed update availability

**User Story:** As a deployment super admin, I want the Operations page to tell me whether a stable update is available, so that I do not need to inspect npm, GHCR, or the host manually.

**Acceptance Criteria:**
- R1.AC1: WHEN a super admin opens the Operations page on a dashboard-update-capable managed deployment THEN the system SHALL show the installed version, the latest compatible stable version, the last-check time, and whether an update is available.
- R1.AC2: WHEN an update check runs THEN the operator SHALL resolve the npm `latest` metadata for `@or3/cloud` with a 10-second request deadline and SHALL accept only a complete, non-prerelease semantic version.
- R1.AC3: IF the operator bridge is absent or the deployment is not managed by `@or3/cloud` THEN the page SHALL show dashboard updates as unavailable and SHALL NOT show an enabled update action.
- R1.AC4: IF release discovery fails THEN the current application SHALL remain available, the last successful check SHALL remain visible when one exists, and the page SHALL offer a retry without starting a deployment mutation.
- R1.AC5: IF the discovered release does not declare a supported dashboard-update protocol and minimum source version THEN the system SHALL mark it incompatible and SHALL NOT offer the update action.

### R2: Narrow authorization and privilege boundary

**User Story:** As a deployment owner, I want dashboard updates isolated from ordinary application code and workspace administration, so that the convenience does not expose general host control.

**Acceptance Criteria:**
- R2.AC1: WHEN a dashboard update status, check, or start endpoint is called THEN the server SHALL require a deployment super-admin context; a workspace-admin context SHALL receive HTTP 403.
- R2.AC2: WHEN a check or start mutation is called THEN the server SHALL enforce the existing admin intent header and exact same-origin mutation guard.
- R2.AC3: WHILE the application is running, its container SHALL NOT receive the Docker socket or a mount of the managed deployment directory.
- R2.AC4: WHILE the operator is running, it SHALL expose no TCP/UDP port and SHALL accept only the versioned `status`, `check`, and `start-update` messages over a local Unix socket.
- R2.AC5: WHEN the operator receives a start request THEN it SHALL reject command text, flags, image references, registry references, prerelease versions, downgrades, and versions not identified as official compatible `@or3/cloud` releases.
- R2.AC6: BEFORE any data or running-container mutation, the operator SHALL verify that the exact target image has the expected OR3 repository and `org.opencontainers.image.version` label.
- R2.AC7: WHEN the operator or its child updater writes managed files THEN it SHALL write as the recorded deployment owner and SHALL NOT leave root-owned state, asset, operation, or backup files behind.

### R3: One-click update experience

**User Story:** As a deployment super admin, I want to confirm one update action and follow its result in the dashboard, so that routine upgrades require no terminal work.

**Acceptance Criteria:**
- R3.AC1: WHEN a compatible newer release is available and no operation is active THEN the Operations page SHALL present one update action naming the exact target version and warning that a brief interruption will occur.
- R3.AC2: WHEN the super admin confirms the action THEN the API SHALL return an accepted job identifier without waiting for the deployment update to finish.
- R3.AC3: WHILE an update is queued, running, or recovering THEN the Operations page SHALL show its persisted state, source version, target version, and start time and SHALL disable additional update actions.
- R3.AC4: WHILE the application is temporarily unreachable during replacement THEN the browser SHALL retry status requests, and WHEN the application becomes reachable again THEN the page SHALL resume showing the same job without requiring a second update request.
- R3.AC5: WHEN the job succeeds, fails before mutation, fails and restores, or requires attention THEN the page SHALL show the terminal result and a concise next action without exposing secrets or unredacted command output.
- R3.AC6: AFTER the bridge has been installed, a normal successful update SHALL require no host terminal command, Docker command, SSH session, or administrator-provided registry credential.

### R4: Reuse of the safe managed updater

**User Story:** As a deployment super admin, I want a dashboard update to have the same backup, verification, and rollback guarantees as the supported CLI, so that convenience does not weaken data safety.

**Acceptance Criteria:**
- R4.AC1: WHEN an update job starts THEN the operator SHALL execute `@or3/cloud` at the exact target version and SHALL require its package version, requested version, generated deployment assets, and target application image version to match.
- R4.AC2: BEFORE stopping or replacing the current application for an update THEN the managed updater SHALL require current deep health, no incomplete operation, supported host architecture, sufficient backup space, and the recorded current image digest.
- R4.AC3: BEFORE applying the replacement image THEN the managed updater SHALL create and checksum a stopped-volume backup containing data, protected configuration, and all managed deployment assets.
- R4.AC4: WHEN applying a target release THEN the managed updater SHALL install that release's Compose, Caddy, and dashboard-operator assets atomically before starting the target application.
- R4.AC5: WHEN the target application starts THEN the managed updater SHALL require Compose health, deep provider health, and the expected pulled image digest before recording success.
- R4.AC6: WHEN success is recorded THEN the managed state SHALL contain the exact target version and digest and SHALL retain the previous version's verified backup as the immediate rollback point.

### R5: Failure and interruption recovery

**User Story:** As a deployment super admin, I want failed or interrupted dashboard updates to recover automatically whenever it is safe, so that a dropped browser or restarted container does not strand the deployment.

**Acceptance Criteria:**
- R5.AC1: IF the target update fails after the verified backup exists THEN the updater SHALL restore the previous configuration, managed assets, image, and backup and SHALL require previous-version deep health before reporting `failed_restored`.
- R5.AC2: IF the browser closes or loses connectivity THEN the operator SHALL continue the accepted job independently of the browser and application process.
- R5.AC3: IF the operator restarts during a dashboard-owned update THEN it SHALL reconcile its persisted job with the managed operation journal and SHALL run the exact-version recovery path before accepting another job.
- R5.AC4: IF recovery cannot establish an unambiguous healthy version THEN the operator SHALL leave the managed operation journal and verified backup intact, SHALL report `needs_attention`, and SHALL NOT guess, delete data, or clear the operation record.
- R5.AC5: WHEN an update reaches any terminal state THEN the operator SHALL atomically persist a redacted result containing timestamps, versions, result code, and backup identifier when available.

### R6: Concurrency and request safety

**User Story:** As an operator, I want dashboard and CLI operations serialized, so that two administrators cannot mutate the same deployment concurrently.

**Acceptance Criteria:**
- R6.AC1: WHEN any managed mutation begins THEN `@or3/cloud` SHALL acquire one deployment-wide operation lease shared by CLI and dashboard-triggered executions.
- R6.AC2: IF a non-stale operation lease or incomplete managed operation already exists THEN a second mutation SHALL fail before changing data, configuration, assets, or containers.
- R6.AC3: WHEN the same accepted dashboard request identifier is submitted more than once THEN the operator SHALL return the original job and SHALL NOT start a second child process.
- R6.AC4: WHEN two distinct update requests race THEN exactly one SHALL be accepted and the other SHALL receive a typed `busy` response mapped to HTTP 409.
- R6.AC5: IF an operation process exits without releasing its lease THEN the recovery path SHALL use the persisted lease owner, heartbeat, and operation journal to distinguish an active operation from a safely reclaimable stale lease.

### R7: Simple installation, release, and operations

**User Story:** As an OR3 maintainer, I want dashboard updates to consume the existing release artifacts and managed updater, so that enabling one-click updates does not create a second release train.

**Acceptance Criteria:**
- R7.AC1: WHEN a new managed deployment is initialized with a supported Unix Docker context THEN its generated Compose project SHALL include the pinned operator runtime, Unix-socket bridge, restart policy, and versioned operator program asset without an additional setup command.
- R7.AC2: WHEN an existing managed deployment with a supported Unix Docker context performs the documented one-time exact-version bridge update THEN subsequent compatible stable releases SHALL be installable from the dashboard.
- R7.AC3: WHEN an ordinary OR3 release is published THEN dashboard discovery SHALL use the existing version-matched npm package and GHCR application image and SHALL NOT require a new per-release update service, database, channel manifest, or operator image.
- R7.AC4: WHEN the operator program changes within protocol 1 THEN it SHALL ship as a managed asset in the matching `@or3/cloud` package, SHALL leave the running operator service contract unchanged during the update, and SHALL reload through the pinned supervisor after the job is persisted.
- R7.AC5: WHEN `@or3/cloud doctor` runs on a dashboard-update-capable deployment THEN it SHALL verify the operator container, Unix socket, program-asset checksum, deployment mount, Docker access, and absence of externally published operator ports.
- R7.AC6: BEFORE a dashboard-update-capable release is promoted THEN qualification SHALL exercise a dashboard-triggered successful update, a failed target with automatic restoration, persistence of login/chat/file data, and interrupted-operator recovery against the exact candidate artifacts.
- R7.AC7: WHEN this behavior ships THEN the installation, operations, configuration, release, and public documentation map SHALL describe the one-time bridge requirement, dashboard flow, supported scope, and CLI fallback.
- R7.AC8: WHILE OR3 is built in static/non-SSR mode THEN dashboard-update integration SHALL NOT require a Unix socket, Docker, operator runtime, or server-only module in the generated client output.
