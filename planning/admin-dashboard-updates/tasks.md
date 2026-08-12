# Tasks

## 1. Contracts and release identity

- [ ] 1.1 Add the dashboard-update discriminated unions and boundary validators in `shared/cloud/dashboard-update.ts`
      Requirements: R1.AC1-R1.AC5, R3.AC2-R3.AC5, R6.AC3-R6.AC4
      Done when: unit tests reject unknown keys, oversized messages, malformed UUIDs/versions, and illegal job-state combinations while accepting every documented status and result.

- [ ] 1.2 Add protocol/minimum-source metadata to `@or3/cloud` and validate it in package/release checks
      Requirements: R1.AC2, R1.AC5, R7.AC3-R7.AC4, R7.AC6
      Done when: the packed package exposes protocol 1 metadata, preflight fails on missing/drifted metadata or a protocol-1 operator service-contract change, and existing root/package/CLI versions still have to match.

- [ ] 1.3 Add exact target-image repository and OCI source/version-label validation to the Managed Updater
      Requirements: R2.AC5-R2.AC6, R4.AC1-R4.AC2
      Done when: focused Cloud CLI tests prove wrong repository, missing/mismatched version label, prerelease, and downgrade targets fail before pending state, backup, asset, or container mutation.

## 2. Cross-process mutation safety

- [ ] 2.1 Implement the deployment-wide heartbeat lease component under `.or3-cloud/operation-lease/`
      Requirements: R6.AC1, R6.AC2, R6.AC5
      Done when: fake-clock/liveness unit tests cover atomic acquisition, five-second heartbeat, 30-second stale candidacy, live host/container refusal after sleep/pause, nonce-checked release, dead-owner archival, ambiguous-liveness refusal, and journal-aware reclamation.

- [ ] 2.2 Apply the operation lease to every mutating `@or3/cloud` command without changing read-only command behavior
      Requirements: R4.AC2, R6.AC1-R6.AC5
      Done when: update, backup mutation, restore, rollback, credentials reset, recover, adopt, lifecycle mutation, and remove paths serialize; status, doctor, verify, logs, and backup list remain concurrently readable; canonical CLI tests pass.

- [ ] 2.3 Add a process-race integration test for CLI mutation serialization
      Requirements: R6.AC2, R6.AC4, R6.AC5
      Done when: two real child processes target one fixture, exactly one reaches its mutation boundary, the loser reports `busy`, and interrupted-owner recovery preserves the operation journal.

## 3. Operator program

- [ ] 3.1 Implement the atomic Operator Program state store for release checks and one active-or-last job
      Requirements: R1.AC4, R3.AC3-R3.AC5, R5.AC2-R5.AC5, R6.AC3
      Done when: writes are mode `0600` and atomic, repeated request IDs return the same job, records remain bounded to one job, and persistence tests confirm that secrets/raw child output cannot enter the file.

- [ ] 3.2 Implement stable release discovery against npm metadata with compatibility validation
      Requirements: R1.AC1-R1.AC5, R2.AC5, R7.AC3
      Done when: mocked registry tests cover the single-version endpoint, success, 10-second timeout, 256 KiB response cap, malformed metadata, prerelease, downgrade, incompatible protocol/source, last-success preservation, and exact-target revalidation.

- [ ] 3.3 Implement the versioned Unix-socket server with `status`, `check`, and `start-update` only
      Requirements: R2.AC4-R2.AC5, R3.AC2, R6.AC3-R6.AC4
      Done when: socket integration tests enforce protocol path/method/body limits, reject every unrecognized operation or field, return typed busy/idempotent results, and confirm no TCP listener is opened.

- [ ] 3.4 Implement the exact-package child runner and terminal-state reconciliation
      Requirements: R2.AC5-R2.AC6, R3.AC2-R3.AC6, R4.AC1-R4.AC6, R5.AC1, R5.AC5
      Done when: tests prove the runner uses `spawn` without a shell, constant package/repository/flags, exact version arguments, disabled lifecycle scripts, bounded redacted diagnostics, and state/digest/health-based `succeeded`, `failed_safe`, `failed_restored`, or `needs_attention` classification.

- [ ] 3.5 Implement startup reconciliation and dashboard-owned exact-version recovery
      Requirements: R5.AC2-R5.AC5, R6.AC2, R6.AC5
      Done when: restart tests cover pre-mutation exit, pending target update, already-completed target, automatically restored source, ambiguous state, and refusal to recover an unrelated manual CLI operation.

- [ ] 3.6 Bundle the Operator Program as a managed `@or3/cloud` asset and reload it after persisted completion
      Requirements: R4.AC4, R5.AC2-R5.AC3, R7.AC4
      Done when: `npm pack --dry-run` includes the program, managed-asset checksum/backup/restore tests include it, dashboard-origin jobs use the pinned supervisor reload without recreating the container, and host CLI update/restore restarts then probes the service so both paths load the installed or restored asset.

## 4. Pinned operator runtime and managed Compose

- [ ] 4.1 Build and qualify the minimal multi-architecture operator runtime image
      Requirements: R2.AC3-R2.AC5, R2.AC7, R7.AC1, R7.AC3
      Done when: the image contains only the pinned Node/npm/Docker CLI/Compose runtime contract, constant-path reload supervisor, and pre-created IPC mountpoint, runs as an arbitrary numeric non-root UID with read-only root plus bounded tmpfs HOME/npm cache, is scanned for amd64 and arm64, and its immutable protocol-1 digest is recorded for Compose.

- [ ] 4.2 Add the hardened operator service and Unix-socket volume to managed Compose
      Requirements: R2.AC3-R2.AC4, R2.AC7, R5.AC2, R7.AC1
      Done when: resolved base/public/operator overlay tests prove only the operator mounts the resolved Docker socket and validated absolute deployment directory read-write, that directory has the same path inside and outside the container, the operator runs as the recorded owner with only the socket supplementary group, Nuxt mounts only IPC read-only when the overlay is enabled, remote/TCP contexts omit the overlay, the operator publishes no port, capabilities are dropped, restart policy is present, and local/public port rules remain unchanged.

- [ ] 4.3 Extend init, adopt, update, rollback/restore, removal, and interrupted recovery for the operator asset/service
      Requirements: R2.AC7, R4.AC3-R4.AC6, R5.AC1-R5.AC4, R7.AC1-R7.AC4
      Done when: init and the first bridge update resolve/probe the active Unix Docker socket plus deployment UID/GID before pending state; managed lifecycle tests prove supported contexts install the overlay and all files retain deployment-owner ownership; unsupported contexts still update the app without it; target assets are installed atomically; failed first-bridge update and pre-bridge rollback/restore remove the privileged service before removing its overlay; purge includes the IPC volume; and source/custom profiles remain refused.

- [ ] 4.4 Extend `@or3/cloud doctor` and status diagnostics for the operator boundary
      Requirements: R1.AC3-R1.AC4, R5.AC4-R5.AC5, R7.AC5
      Done when: doctor reports container/socket/program checksum/deployment mount/Docker access/port exposure independently, redacts paths and secrets appropriately, and gives exact CLI recovery guidance for `needs_attention`.

## 5. Admin server integration

- [ ] 5.1 Implement the bounded Unix-socket Operator Client
      Requirements: R1.AC3-R1.AC4, R2.AC3-R2.AC4, R3.AC2-R3.AC5, R7.AC8
      Done when: tests cover the 2-second status and 15-second check/start deadlines, 16 KiB response limit, invalid response validation, socket absence as `unsupported`, mid-request disconnect, prohibition on TCP/redirect fallback, and server-only imports.

- [ ] 5.2 Add status, check, and start admin API routes with exact policy and error mapping
      Requirements: R1.AC1-R1.AC5, R2.AC1-R2.AC2, R3.AC2, R6.AC3-R6.AC4
      Done when: route tests prove super-admin success, workspace-admin 403, unauthenticated denial, intent/same-origin enforcement, 202 accepted, 409 busy/conflict, 503 mutation socket failure, and normal unsupported status.

- [ ] 5.3 Extend the canonical admin route-policy contract test for deployment updates
      Requirements: R2.AC1-R2.AC2
      Done when: every new deployment-wide route is asserted super-admin-only and every POST route is asserted mutation-guarded without weakening existing workspace-admin route coverage.

## 6. Admin update experience

- [ ] 6.1 Implement `useAdminUpdate` for status, explicit checks, idempotent start, and reconnect polling
      Requirements: R1.AC1-R1.AC4, R3.AC2-R3.AC6, R6.AC3
      Done when: composable tests prove one initial check only when state is `unchecked`, one UUID per confirmed action, no start resubmission during failures, two-second active polling, bounded reconnect backoff, page-remount state recovery, and polling stop at terminal state.

- [ ] 6.2 Add the single update card and confirmation flow to the existing Operations page
      Requirements: R1.AC1-R1.AC5, R3.AC1-R3.AC6
      Done when: the card displays unsupported/current/latest/check/job/result states, names the exact target and interruption in confirmation, disables conflicting actions, links release notes, and uses existing Nuxt UI variants and admin error formatting.

- [ ] 6.3 Add focused accessibility and page integration coverage
      Requirements: R3.AC1, R3.AC3-R3.AC5
      Done when: tests verify keyboard-operable confirmation, visible labels/focus, an `aria-live` job status, disabled/busy semantics, reconnect messaging, and no horizontal overflow at the existing mobile admin breakpoint.

## 7. End-to-end safety and release qualification

- [ ] 7.1 Add a named disposable dashboard-update lifecycle harness
      Requirements: R3.AC2-R3.AC6, R4.AC1-R4.AC6, R7.AC6
      Done when: one command initializes the current public version, installs/uses the bridge, triggers the exact candidate through the admin API, reconnects after replacement, and verifies target version/digest plus login, conversation, and file persistence.

- [ ] 7.2 Add failed-target restoration and interrupted-operator lifecycle cases
      Requirements: R5.AC1-R5.AC5, R7.AC6
      Done when: a deliberately unhealthy target returns to the source version with checksum-verified data, and killing the operator at recorded checkpoints recovers or produces preserved `needs_attention` evidence without guessing.

- [ ] 7.3 Add dashboard-versus-CLI concurrency and privilege-negative lifecycle cases
      Requirements: R2.AC3-R2.AC7, R6.AC1-R6.AC5
      Done when: the harness proves only one mutation runs, the app container cannot access Docker/deployment files, the operator has no published port, managed files remain deployment-owner-owned, and arbitrary image/command payloads cannot cross the protocol.

- [ ] 7.4 Add dashboard lifecycle evidence to the existing candidate workflow and receipt
      Requirements: R4.AC1-R4.AC6, R7.AC3, R7.AC6
      Done when: a release-only entrypoint injects the hashed candidate tarball and existing candidate-image override into the same operator core, is excluded from production package/assets/protocol, records dashboard success/restoration/recovery evidence bound to those artifacts, and makes the tag workflow reject a receipt missing that evidence without adding a second ordinary publication workflow.

## 8. Documentation and final verification

- [ ] 8.1 Update managed installation, operations, release, and package documentation
      Requirements: R1.AC3, R3.AC6, R5.AC4, R7.AC1-R7.AC3, R7.AC5, R7.AC7
      Done when: `docs/installation.md`, `docs/releasing.md`, the root README, and `packages/or3-cloud/README.md` explain new installs, the one-time existing-install bridge, dashboard use, supported scope, automatic restore, and CLI fallback.

- [ ] 8.2 Update public Cloud documentation and `docmap.json`
      Requirements: R2.AC3-R2.AC6, R7.AC7
      Done when: public deployment operations/config/security pages document the Unix-socket/operator boundary and limitations, `public/_documentation/docmap.json` references the behavior, and `bun run check:docs` passes.

- [ ] 8.3 Run the proportionate final gate and simplification review
      Requirements: R1-R7
      Done when: the final diff contains no version picker, scheduler, queue/database, Docker mount in Nuxt, duplicate updater, raw shell interpolation, or unrelated refactor; `bun run --cwd packages/or3-cloud check`, targeted admin/operator Vitest suites, `bun run type-check`, `bun run generate:static`, `bun run check:docs`, the named dashboard lifecycle harness, and `git diff --check` all pass.

## Traceability Matrix

| Requirement | Design component | Task numbers |
|---|---|---|
| R1 | Operations Update Card; Admin Update API; Operator Program; Release Metadata Gate | 1.1-1.2, 3.1-3.3, 4.4, 5.1-5.2, 6.1-6.2, 8.1 |
| R2 | Admin Update API; Operator Client; Operator Program; Managed Compose Bridge; Release Metadata Gate | 1.3, 3.2-3.4, 4.1-4.2, 5.1-5.3, 7.3, 8.2 |
| R3 | Operations Update Card; Admin Update API; Operator Client; Operator Program | 1.1, 3.1, 3.3-3.4, 5.1-5.2, 6.1-6.3, 7.1, 8.1 |
| R4 | Managed Updater and Operation Lease; Operator Program; Release Metadata Gate | 1.3, 2.2, 3.4, 3.6, 4.3, 7.1, 7.4 |
| R5 | Operator Program; Managed Updater and Operation Lease; Managed Compose Bridge | 3.1, 3.4-3.6, 4.3-4.4, 7.2, 8.1 |
| R6 | Admin Update API; Operator Program; Managed Updater and Operation Lease | 1.1, 2.1-2.3, 3.1, 3.3, 5.2, 6.1, 7.3 |
| R7 | Managed Compose Bridge; Operator Program; Release Metadata Gate | 1.2, 3.6, 4.1-4.4, 7.1-7.4, 8.1-8.3 |

## Definition of Done

- Every acceptance criterion in `requirements.md` has automated coverage or explicit candidate-workflow evidence, and the traceability matrix has no gaps.
- The app container has no Docker socket or deployment-directory access; the operator has no published network port or arbitrary command/image interface.
- Dashboard success, unhealthy-target automatic restoration, interrupted-operator recovery, persistence, concurrency, and existing-install bridge scenarios pass against exact candidate artifacts.
- `bun run --cwd packages/or3-cloud check`, the targeted admin/operator suites, `bun run type-check`, `bun run generate:static`, `bun run check:docs`, the named dashboard lifecycle harness, and `git diff --check` are green.
- Documentation and package tarball inspection are complete, the final diff has been reviewed, and no unrelated or speculative infrastructure remains.
