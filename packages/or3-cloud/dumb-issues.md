# OR3 Cloud audit: dumb issues

This reviews the current working tree as of 2026-08-12, including the uncommitted dashboard-update work. Scope: `packages/or3-cloud`, its Compose/runtime assets, the dashboard operator and admin bridge, the Docker image, release gates, tests, and the public behavior those files claim to provide.

The package tests and typecheck pass. That does not make this releasable. Several release blockers, host-integrity failures, data-loss paths, and deterministic test-gate failures remain.

> **Remediation status (2026-08-13):** Items marked **DONE** below are fixed in
> this working tree and covered by the targeted CLI/assets tests plus the
> updated disposable Compose/operator and release-gate checks. **PARTIAL**
> items have useful regression coverage but still need the release-grade
> end-to-end scenario described in their original finding. Their original
> descriptions are retained as the audit record; unmarked items remain open.

## 1. [DONE — BLOCKER] The base Compose file is invalid when dashboard updates are unsupported

**Location:** `packages/or3-cloud/assets/compose.yaml:24-27,74-91`; `packages/or3-cloud/src/cli.ts:926-950`

The profiled operator service is embedded in the base file, and Compose interpolates profiled services even when their profile is inactive. On macOS, remote Docker, or any Linux host where `dashboardOperatorEnv()` returns `undefined`, `.env` has no `OR3_OPERATOR_*` values. `docker compose config` then fails on `${OR3_DOCKER_SOCKET}:/var/run/docker.sock:rw` with `invalid spec: ::rw: empty section between colons`. The app IPC bind is also present unconditionally.

**Consequence:** fresh unsupported installs and ordinary updates cannot start, despite documentation saying they remain CLI-only. This was reproduced against the checked-in asset.

**Fix:** put the operator service and app IPC mount in a separate `compose.operator.yaml` overlay and include it only after a real enablement probe succeeds. The base Compose file must parse with no operator variables at all.

## 2. [DONE — BLOCKER] `adopt` is broken on every platform

**Location:** `packages/or3-cloud/src/cli.ts:2828-2857`

`adopt` copies the new base Compose asset but never calls `dashboardOperatorEnv()` or `prepareDashboardOperatorIpc()`, and it calls `buildEnv()` without `dashboardOperator`. It therefore always writes an environment with none of the variables required by the operator service embedded in the base file.

**Consequence:** every adoption reaches `startProject()` with the invalid `::rw` mount specification and fails, including supported Linux hosts.

**Fix:** use the same conditional overlay/probe path as init and update. Perform every collision and compatibility preflight before writing the target directory.

## 3. [DONE — CRITICAL] Exported shell variables can redirect lifecycle commands to arbitrary images, projects, and volumes

**Location:** `packages/or3-cloud/src/cli.ts:370-378,543-557,653-657,1379-1393`

Every Docker invocation inherits `process.env`. Compose gives the caller's exported environment higher interpolation precedence than `--env-file`, so exported `OR3_IMAGE`, `OR3_VOLUME_NAME`, `OR3_COMPOSE_PROJECT`, `COMPOSE_PROJECT_NAME`, `COMPOSE_PROFILES`, and operator path variables override the validated deployment file. The code validates `.env`, then asks Compose to resolve a different configuration.

**Consequence:** a routine shell setting can make backup, restore, update, or remove operate on the wrong deployment. `OR3_IMAGE` also bypasses the package-authenticated image choice, and poisoned operator paths can expose host resources.

**Fix:** run Compose with a scrubbed environment, explicitly inject the parsed managed values, pass an explicit validated project name, and validate the resolved service image, volume names, project name, network mode, and mounts before mutation. Add poisoned-parent-environment tests.

## 4. [DONE — CRITICAL] A tampered backup is a host-code-execution package

**Location:** `packages/or3-cloud/src/cli.ts:1660-1679,1709-1728,2296-2334`

Restore trusts the backup's self-declared image, digest, full `.env`, and executable Compose/Caddy assets. The hashes are stored in the same unauthenticated manifest as the files they allegedly authenticate. An attacker can alter the assets and simply update the hashes while preserving the handful of deployment-identity values. A hostile extra Compose service can then mount the Docker socket or host filesystem; the current safety check only reasons about the `or3` port.

**Consequence:** compromise of an off-host backup location becomes root-equivalent code execution on the host when an operator restores it.

**Fix:** treat backups as data, not executable configuration. Authenticate the backup with a key stored outside it, constrain image/digest to authenticated release metadata, install assets from the matching signed `@or3/cloud` release, and reconstruct managed configuration from an allowlist.

## 5. [DONE — CRITICAL] The lifecycle journal is not a lock

**Location:** `packages/or3-cloud/src/cli.ts:1189-1217,2060-2068,2193-2218,2302-2331,2348-2378,3160-3188,3374-3382`

Every command separately reads `incompleteOperation`, sees no work, and later writes a pending record. Two CLI processes, or the dashboard operator and a CLI process, can both pass the check and overwrite each other's JSON. `remove --purge-data` does not journal itself at all.

**Consequence:** concurrent restores can both run `find /data -delete` and extract simultaneously; update, backup, reset, pruning, start/stop, and purge can interleave and corrupt data or erase recovery evidence.

**Fix:** hold an atomic deployment-wide OS lease for every mutation, including start/stop/restart/remove/recover. Include a nonce and heartbeat for dashboard recovery. Keep the JSON journal for crash recovery, not mutual exclusion.

## 6. [DONE — HIGH] Update reopens the app after its rollback snapshot

**Location:** `packages/or3-cloud/src/cli.ts:1597-1657,2220-2235`

`createBackup()` stops the app, archives the volume, and unconditionally restarts the app in `finally`. `updateCommand()` then does more work before stopping it again. Writes accepted in that interval are not present in the rollback snapshot.

**Consequence:** a failed update or later rollback silently discards conversations, uploads, and other writes that the application acknowledged after the backup completed.

**Fix:** keep the service stopped from snapshot creation through commit/rollback, or use a database/filesystem snapshot with an explicit write barrier. Never reopen writes against a snapshot that will be presented as the rollback point.

## 7. [DONE — HIGH] Recovery can bless a partially erased volume as healthy

**Location:** `packages/or3-cloud/src/cli.ts:1581-1594,1895-1975,2252-2269`

Failed-update restoration first rewrites the old `.env`, then destructively clears and extracts `/data`. If extraction is interrupted, recovery sees the old environment, starts the old image, and may clear the pending operation without replaying the backup. Deep health only proves that the remaining databases/providers answer; it does not prove every archived file was restored.

**Consequence:** a half-restored volume can be recorded as fully recovered, permanently discarding files while removing the evidence that recovery is still required.

**Fix:** persist explicit phases before every destructive step. Once fallback restore begins, recovery must replay and checksum-validate the recorded snapshot or swap in a fully prepared replacement volume; environment equality is not recovery evidence.

## 8. [DONE — HIGH] Restore and rollback destroy the only live state before proving the replacement

**Location:** `packages/or3-cloud/src/cli.ts:1581-1594,1709-1744,2302-2390`

Both operations overwrite `.env` and assets, delete `/data`, and extract in place. They do not take a pre-restore snapshot or prepare a new volume. On failure, the catch block merely tries to start whatever partial target is left.

**Consequence:** a bad archive, disk error, permission problem, or interruption can turn a recoverable running deployment into a partially erased one. This contradicts the README's claim that failed restores preserve/restore managed assets safely.

**Fix:** restore into a fresh volume and atomically switch only after checks pass, or create and journal a verified pre-restore snapshot and restore it on every failure.

## 9. [DONE — HIGH] Legacy ownership migration fails on ordinary nested root-owned data

**Location:** `packages/or3-cloud/src/cli.ts:713-739,1581-1594,2232-2249`

Migration changes only the `/data` directory's UID/GID. The subsequent `find /data -delete` and extraction run as UID 65532. Nested directories still owned by root and mode `0755` cannot be emptied by that user. Checking only the mount root also misses a mixed-ownership volume whose root already looks correct.

**Consequence:** the migration partially deletes top-level data and then fails on common legacy layouts.

**Fix:** use a narrowly hardened root helper to clear the old volume before extracting as the target UID, or restore into a new correctly owned volume and swap. Test nested root-owned directories and files.

## 10. [DONE — HIGH] The ownership migration phase is absent from the recovery journal

**Location:** `packages/or3-cloud/src/cli.ts:2209-2217,2232-2248`; recovery at `packages/or3-cloud/src/cli.ts:1895-1975`

The previous UID/GID and whether migration started exist only in process memory. The pending record stores target version/image/digest, not the old ownership or migration phase.

**Consequence:** a crash after `chown` leaves recovery unable to decide whether to finish target extraction or restore the old owner before fallback. The old runtime can be stranded even when the archive is good.

**Fix:** journal old ownership, migration requirement, and phase before the first ownership mutation; make each recovery transition idempotent.

## 11. [DONE — HIGH] Recovery forgets where an external restore came from

**Location:** `packages/or3-cloud/src/cli.ts:1895-1935,2296-2329`

Restore accepts an absolute backup path, but the pending operation records only `manifest.backupId`. Recovery resolves that ID under the deployment's local backup directory instead of using the external source, and it does not record immutable archive/config hashes.

**Consequence:** after interruption, recovery cannot find the valid external backup or can select a different local backup with the same ID.

**Fix:** copy external backups into a managed staging location before mutation, or journal the canonical path plus all immutable hashes and revalidate them during recovery.

## 12. [DONE — HIGH] A crafted backup ID can overwrite managed state

**Location:** `packages/or3-cloud/src/cli.ts:1660-1679,2109-2152`

`readManifest()` accepts any truthy `backupId`. Export interpolates that value into `.or3-cloud/exports/${backupId}.json` without enforcing the generated backup-ID grammar. `backupId: "../state"` resolves to `.or3-cloud/state.json`.

**Consequence:** exporting a crafted external backup can overwrite lifecycle state before any restore is attempted.

**Fix:** validate every manifest ID with the same strict generated-ID parser before path construction, and require an internal backup directory basename to equal its manifest ID.

## 13. [DONE — HIGH] Purge can delete the backup it says will remain

**Location:** `packages/or3-cloud/src/cli.ts:2113-2165,3350-3406`

Export rejects a destination inside the source backup, but not a destination inside the wider deployment or `.or3-cloud`. Purge accepts a different filesystem device, then recursively removes `.or3-cloud`. A mounted backup disk below that directory passes the device test and is traversed by recursive deletion.

**Consequence:** purge can delete the live volumes and the supposedly surviving verified export in one command.

**Fix:** require the canonical export destination to be outside every purge target and preferably outside the deployment root. Revalidate containment and mount identity immediately before deletion.

## 14. [DONE — HIGH] Most destructive commands do not verify the deployment directory

**Location:** `packages/or3-cloud/src/cli.ts:1396-1420,1895-1975,2060-2077,2193-2294,2302-2390`

Recover, backup, update, restore, rollback, and doctor load managed state but do not call `assertDeploymentDirectoryIdentity()`. Even that helper derives identity from the basename, so a copy under another parent with the same basename can pass.

**Consequence:** running a copied or renamed deployment can mutate the original named Docker volume/project while reading configuration from the copy.

**Fix:** persist a random deployment ID and canonical root, label Docker resources with it, validate both for every command, and reject moved deployments until an explicit relocation operation updates the identity.

## 15. [DONE — HIGH] Image integrity is checked on a mutable tag, not the running container

**Location:** `packages/or3-cloud/src/cli.ts:788-853,963-1027,1223-1227,2271-2284`

Compose receives `repository:version`, while digest checks inspect whatever local image that tag names at check time. The code never binds Compose to `repository@sha256:...` and does not inspect the image ID/digest of the actual running `or3` container after startup.

**Consequence:** retagging between check and create can run a different image; later container recreation can move to another image while managed state still claims the authenticated digest.

**Fix:** store and run digest-qualified references, then verify the created container's immutable image ID and repository digest before committing state.

## 16. [DONE — HIGH] Historical adoption silently loses authenticated image identity

**Location:** `packages/or3-cloud/src/cli.ts:761-813,1570-1578,2793-2835`

`packagedImageDigest()` returns `undefined` when the requested version differs from the current CLI package. Adoption explicitly supports reading an older source release, so it can accept any pre-existing local tag for that historical version. The source archive helper then runs that image as root with the source data mounted and without the hardening used elsewhere.

**Consequence:** an unverified local image can read the legacy data volume and participate in adoption.

**Fix:** require the exact historical CLI/authenticated release metadata for adoption. Run archive helpers with `--network none`, read-only root, `no-new-privileges`, and dropped capabilities.

## 17. [DONE — HIGH] Adoption mixes one release's image with another release's assets

**Location:** `packages/or3-cloud/src/cli.ts:2793-2835`

The source `or3-release.json` selects the old application image, but `copyAssets()` always installs Compose/Caddy/operator files from the currently executing CLI. There is no `release.or3Version === PACKAGE_VERSION` check.

**Consequence:** an old runtime/data layout is launched under new mounts, profiles, proxy behavior, and operator assumptions that were never qualified together.

**Fix:** require the matching CLI version for adoption, or make adoption an explicit, tested migration to the current version with current authenticated image and assets.

## 18. [DONE — HIGH] Adoption can preserve public self-registration

**Location:** `packages/or3-cloud/src/cli.ts:2710-2755,2832-2846`

The source validator rejects guest access but does not enforce `OR3_AUTH_REGISTRATION_MODE=invite_only` or `OR3_AUTH_AUTO_PROVISION=false`. The code builds safe defaults and then overwrites them from the broad allowed-key list.

**Consequence:** a deployment advertised as the fixed managed Cloud profile can finish adoption with open registration and automatic provisioning enabled.

**Fix:** copy only necessary secrets/data settings and reapply the complete managed security profile after copying. Reject incompatible source policy before stopping it.

## 19. [DONE — HIGH] Restoring a pre-operator backup leaves the privileged sidecar running

**Location:** `packages/or3-cloud/src/cli.ts:1168-1175,1219-1226,1709-1744`; `packages/or3-cloud/assets/compose.yaml:74-100`

`stopProject()` stops only `or3`. A restore to a pre-dashboard backup removes operator configuration/assets and starts Compose without the profile, but Compose does not automatically remove a previously running profiled service. A host-CLI restore has no operator `finish()` path to make that process exit.

**Consequence:** an orphan process holding the Docker socket and deployment directory can survive a rollback that is supposed to remove the privileged bridge.

**Fix:** explicitly stop/remove the operator while the current overlay still exists, restore old assets/env, then start without the overlay. Verify the operator container and socket are absent before commit.

## 20. [DONE — HIGH] The "small operator runtime" is the full application image with Docker tooling added

**Location:** `Dockerfile:10-13,90-118`; `packages/or3-cloud/assets/compose.yaml:74-100`; `planning/admin-dashboard-updates/design.md:33-40`

The operator uses `${OR3_OPERATOR_IMAGE}`, which is the normal OR3 app image. That image now copies npm, the Docker CLI, and Compose into every web-service container. This directly contradicts the stated pinned, minimal, protocol-specific runtime design and even the Dockerfile comment claiming the tools are kept out of the app container.

**Consequence:** every app image is larger and carries unnecessary post-exploitation tooling; the root-equivalent operator runtime changes with ordinary application releases and can be recreated mid-update.

**Fix:** publish and pin a minimal operator-runtime image by immutable digest for the protocol major. Keep the frequently changing operator program as a verified managed asset.

## 21. [DONE — HIGH] Operator enablement is based on `stat()`, not proof that the bridge works

**Location:** `packages/or3-cloud/src/cli.ts:926-960`

The probe checks platform, path shape, and host socket metadata only. It does not resolve the active Docker context, prove the daemon can bind the same host path, prove the recorded UID/GID can create host-owned files, or prove Docker access from the proposed container/group mapping.

**Consequence:** rootless, remapped, unusual-context, or permissions-mismatched Linux installations can be marked enabled and then fail at Compose startup or leave root-owned IPC state.

**Fix:** run a disposable probe using the exact runtime, mounts, user, and supplementary group; require Docker access and host-owner file creation before enabling the overlay.

## 22. [DONE — HIGH] The dashboard updater child has no timeout

**Location:** `packages/or3-cloud/assets/dashboard-operator.mjs:348-385`

Package installation has a timeout, but the actual `@or3/cloud update` process at lines 377-381 does not. Docker, registry, health, or filesystem hangs can leave it alive forever. There is no heartbeat lease that lets a replacement operator distinguish a live child from a dead one.

**Consequence:** the dashboard can remain permanently "running," block all future updates, and leave an ambiguous lifecycle operation after a container restart.

**Fix:** give the updater a bounded operational deadline, maintain a deployment-wide heartbeat lease, terminate the process group safely, and reconcile through the recorded journal.

## 23. [DONE — HIGH] Interrupted dashboard updates are not automatically recovered

**Location:** `packages/or3-cloud/assets/dashboard-operator.mjs:409-433`; `planning/admin-dashboard-updates/design.md:191-218`

On restart, an active job plus pending managed state is changed to `needs_attention` with instructions to run host-side `recover`. The approved design calls for exact-version, dashboard-owned recovery after proving the previous owner is gone.

**Consequence:** the feature advertised as a managed dashboard update path still requires shell access at the failure point where recovery matters most.

**Fix:** record origin/job identity in the lifecycle journal and lease, then run the exact target CLI's `recover` only for stale dashboard-owned operations. Preserve unrelated manual operations for host intervention.

## 24. [DONE — HIGH] Release compatibility is a protocol number with no source-version gate

**Location:** `packages/or3-cloud/package.json:18-20`; `packages/or3-cloud/assets/dashboard-operator.mjs:114-138,177-185`; `planning/admin-dashboard-updates/design.md:170-189`

Package metadata contains only `dashboardUpdateProtocol: 1`. It does not publish or enforce `minimumSourceVersion`, and the updater does not validate target OCI source/version labels before mutation.

**Consequence:** a future release can be offered to an older bridge that cannot safely consume it; package/image mix-ups are detected less directly than the design requires.

**Fix:** publish structured protocol plus minimum-source metadata, enforce it during check and start, and validate the pulled image's repository/revision/version labels in addition to its digest.

## 25. [DONE — BLOCKER] The extended lifecycle workflow is deterministically red

**Location:** `.github/workflows/extended-validation.yml:131-168`; `packages/or3-cloud/src/cli.ts:2199-2203`

The workflow computes `next_version` and runs the current CLI with `update --to "$next_version"`. The CLI explicitly rejects every target not equal to its own `PACKAGE_VERSION`, before either the normal-update or unhealthy-rollback scenario runs.

**Consequence:** the documented deployment validation gate cannot pass and does not test the behavior it claims to test.

**Fix:** build/use an exact target-version package with matching assets and image metadata, or redesign the fixture so source and target CLIs are distinct real artifacts.

## 26. [PARTIAL — HIGH] The release candidate gate never exercises the dashboard update path

**Location:** `.github/workflows/release-cloud-candidate.yml:158-201`; `planning/admin-dashboard-updates/tasks.md:105-119`

The candidate workflow tests host-CLI update/rollback/verify only. It never calls the admin API/operator path and has no dashboard success, failed-target restoration, interrupted-operator, existing-install bridge, concurrency, or privilege-negative lifecycle case.

**Consequence:** a release can pass while the newly privileged update path is completely broken—as the current Compose/adopt defects demonstrate.

**Fix:** add a disposable dashboard lifecycle harness bound to the exact candidate tarball and image digest, and require its evidence in the release receipt.

## 27. [DONE — HIGH] Restore refuses backups that would fit after replacing current data

**Location:** `packages/or3-cloud/src/cli.ts:433-460,1696-1707`

Free space is measured before deletion, then required to exceed the full uncompressed backup plus 50% or 64 MiB. The actual extraction deletes the current data first. A same-sized restore on a filesystem more than roughly two-thirds full is rejected even when replacing the current volume would leave ample room.

**Consequence:** legitimate disaster recovery fails precisely on constrained hosts where it is most needed.

**Fix:** restore into a new volume and check that volume's capacity, or account for safely reclaimable current data without weakening the no-partial-restore guarantee.

## 28. [DONE — HIGH] Export regressed support for pre-operator backups

**Location:** `packages/or3-cloud/src/cli.ts:1137-1165,2109-2157`

`readManifest()` intentionally supports managed-asset inventory v1 without `dashboard-operator.mjs`. `backupExportCommand()` ignores that inventory and loops over current `managedAssetNames()`, which always includes the operator file.

**Consequence:** valid legacy backups can be read/restored but cannot be exported off-host, blocking the safety prerequisite for purge.

**Fix:** export the exact validated inventory returned by `verifiedManagedAssetContents()`, not today's package inventory.

## 29. [DONE — HIGH] Retention trusts corrupt metadata and can delete the wrong backup

**Location:** `packages/or3-cloud/src/cli.ts:1288-1375,1635-1655`

Enumeration validates only schema/id/date, never checks checksums, and does not require directory name to match `manifest.backupId`. Pruning recomputes a path from that ID rather than deleting the validated enumerated path. Corrupt new backups count toward `keep`, and automatic pruning happens before app restart/deep health succeeds.

**Consequence:** a renamed or malformed backup can cause deletion of a different valid backup; unusable new backups can evict the last good older copy.

**Fix:** strictly validate types, ID/path equality, inventory, and checksums before retention; retain `keep` verified backups; prune only after restart and verification succeed.

## 30. [MEDIUM] The operator image is accidentally frozen at the first enabling release

**Location:** `packages/or3-cloud/src/cli.ts:2222-2231`

Once `OR3_DASHBOARD_UPDATES_ENABLED=true`, update skips `dashboardOperatorEnv()` and carries the old `OR3_OPERATOR_IMAGE` forward. That avoids self-recreation only by leaving the operator on an arbitrary old app image forever.

**Consequence:** runtime security fixes never reach existing operator containers, and behavior depends on which release happened to enable the bridge.

**Fix:** use the separate pinned protocol runtime. Upgrade that digest only through an explicit bridge/protocol migration that safely supervises replacement.

## 31. [MEDIUM] Check results disappear on the next status request

**Location:** `packages/or3-cloud/assets/dashboard-operator.mjs:159-185`; `app/components/admin/system/AdminSystemUpdateCard.vue:74-100`

`check()` returns `latestVersion` and `updateAvailable` but does not persist them. `status()` returns neither. The UI replaces its state from `GET /status`, so a page load/poll loses the last release check and reverts the Latest card to "Check for updates."

**Consequence:** update state is not durable across reloads/restarts, failures cannot retain the last successful check, and the UI contradicts the planned persisted status model.

**Fix:** atomically persist a typed release-check result with `checkedAt`, failure state, incompatibility reason, and last successful result.

## 32. [MEDIUM] The application trusts arbitrary operator JSON as typed state

**Location:** `server/admin/update/operator-client.ts:46-100,114-137`

The client parses JSON and resolves `parsed as T` without runtime validation. A mismatched/corrupt operator can supply invalid discriminants, phases, timestamps, or oversized strings within the byte limit. `getDashboardUpdateStatus()` also converts every socket/protocol/server error into a normal `unsupported` response.

**Consequence:** corruption and operator failures are hidden as unsupported installs, while malformed data reaches UI control logic.

**Fix:** define one shared discriminated schema, validate exact keys at both boundaries, and distinguish unsupported from unavailable/protocol-corrupt responses.

## 33. [MEDIUM] The accepted start route returns HTTP 200 instead of 202

**Location:** `server/api/admin/update/start.post.ts:8-21`; required mapping in `planning/admin-dashboard-updates/design.md:135-156`

The Unix operator returns 202, but the Nuxt client discards that status and the route returns a normal body without setting the event status.

**Consequence:** API consumers cannot distinguish accepted asynchronous work from synchronous success, and the implemented contract does not match the documented one.

**Fix:** preserve/map the operator result and call `setResponseStatus(event, 202)` for accepted/idempotent active jobs.

## 34. [MEDIUM] The app mounts operator IPC even when the operator is disabled

**Location:** `packages/or3-cloud/assets/compose.yaml:22-27`; `packages/or3-cloud/src/cli.ts:953-960`

The base app service always bind-mounts `.or3-cloud/operator-ipc`, while the CLI creates it only when enablement succeeds. Rootful Docker may auto-create the missing source as root.

**Consequence:** unsupported installs receive an unnecessary privileged-control surface path and can become retry-hostile because later unprivileged CLI runs cannot manage the root-owned directory.

**Fix:** add the app IPC mount only in the conditional operator overlay and precreate/probe it before enabling.

## 35. [MEDIUM] Adoption backups cannot be pruned

**Location:** `packages/or3-cloud/src/cli.ts:41,1256-1277,2884`

Cleanup accepts only `backup-*`, while adoption creates `adopt-source-*`. Once retention selects that artifact, removal throws and the pruning loop stops.

**Consequence:** retention can fail permanently and backup storage grows without bound.

**Fix:** generate a valid `backup-adopt-source-*` ID or add a strictly validated backup-kind field used consistently by creation, enumeration, and deletion.

## 36. [MEDIUM] Backup can report success for state it cannot restore

**Location:** `packages/or3-cloud/src/cli.ts:1379-1393,1877-1882,2060-2077`

`loadManaged()` validates resource identity but not `OR3_VERSION`/`OR3_IMAGE` against managed state. The manifest records state version/image while `config.env` is copied from live `.env`; restore later requires them to match.

**Consequence:** a backup command can succeed and print a checksum for an artifact the restore command will reject.

**Fix:** require full state/environment consistency before backup/update and re-read/fully validate the completed artifact before reporting success.

## 37. [MEDIUM] Backup and recovery do not preserve intentional stopped state

**Location:** `packages/or3-cloud/src/cli.ts:1597-1657,1895-1975,2876-2920`

Backup unconditionally starts OR3 after any stop attempt. Generic recovery also starts it. Failed adoption restarts the source without recording whether it was initially stopped.

**Consequence:** an intentionally offline public deployment can become reachable as a side effect of a backup or failed migration.

**Fix:** journal initial service states and restore them exactly.

## 38. [MEDIUM] Crash leftovers are invisible and unbounded

**Location:** `packages/or3-cloud/src/cli.ts:1482-1509,1597-1647,2064-2070,2220-2222,2884-2895`

Backup IDs are allocated inside the worker and are not journaled until after completion (or never, for standalone backup). A hard crash can leave manifest-less directories and `.partial` archives that enumeration and recovery ignore.

**Consequence:** repeated interrupted operations leak disk space and leave artifacts no command can safely identify or clean.

**Fix:** allocate and journal the exact artifact ID/path before creation; recovery may then resume or remove only that validated artifact.

## 39. [MEDIUM] Docker API failures are treated as proof that volumes do not exist

**Location:** `packages/or3-cloud/src/cli.ts:1830-1833,2852-2856`

Init/adopt proceed whenever `docker volume inspect` is not `ok`. They do not distinguish `no such volume` from permission errors, daemon failures, context errors, or timeouts.

**Consequence:** a transient inspection failure can lead the CLI to operate against an existing volume it promised not to touch.

**Fix:** continue only on the daemon's explicit not-found result; fail closed on every other error and also inspect project-labeled containers/networks.

## 40. [MEDIUM] Redaction leaks secrets containing whitespace

**Location:** `packages/or3-cloud/src/cli.ts:240-247,370-395,583-590,1243-1253`

`run()` applies token-only regex redaction before callers can replace exact known secret values. For `OR3_ADMIN_PASSWORD=A secret with spaces 123`, the first pass leaves `secret with spaces 123`; the later exact replacement no longer matches the altered string. Some volume errors do not pass known secrets at all.

**Consequence:** passwords can leak into thrown errors, persisted `lastError`, CI logs, and diagnostics.

**Fix:** retain raw output internally, redact exactly once at the presentation boundary with known full values first, then apply generic patterns. Test whitespace and punctuation-heavy secrets.

## 41. [MEDIUM] Verification can send the authenticated cookie off-origin

**Location:** `packages/or3-cloud/src/cli.ts:2585-2637`

Presigned upload/download URLs may be absolute, and the CLI attaches the session cookie without requiring `url.origin === baseUrl.origin`. The fixed filesystem profile should never need a cross-origin grant. It also permits an upload before proving `storageId` is non-empty.

**Consequence:** a malformed or compromised provider response can exfiltrate the bootstrap session and can create an orphaned upload.

**Fix:** enforce same-origin URLs for this fixed profile, validate `storageId` before mutation, and reject unexpected methods/headers.

## 42. [MEDIUM] `verify` breaks after the owner changes their password normally

**Location:** `packages/or3-cloud/src/cli.ts:2552-2565,2642-2665`

Verification always signs in with `OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD` from `.env`. A normal in-app password change updates the account database, not this bootstrap environment value.

**Consequence:** healthy deployments permanently fail the mandatory production verification gate after ordinary credential hygiene.

**Fix:** use a purpose-built authenticated health probe or require short-lived verification credentials. Do not make ongoing operability depend on a first-boot password.

## 43. [MEDIUM] Every successful verification leaks another live session

**Location:** `packages/or3-cloud/src/cli.ts:2556-2639`

The command signs in and never logs out or revokes the resulting session in `finally`.

**Consequence:** repeated release/operations checks accumulate active sessions until server-side expiry/reaping.

**Fix:** call the logout/revocation endpoint in `finally`, including on upload/download failure.

## 44. [MEDIUM] Bootstrap and admin passwords are permanent deployment metadata

**Location:** `packages/or3-cloud/src/cli.ts:963-1027,1847-1854,1613-1625`

The initial owner and admin passwords remain in `.env`, are injected into containers, copied into every backup, and are retained partly because `verify` depends on the bootstrap password. The separate initial-credentials file duplicates them until manually deleted.

**Consequence:** every backup and any Docker-inspect-capable user gets long-lived credentials; compromise has a larger blast radius than necessary.

**Fix:** remove bootstrap credentials after provisioning, replace verification with a non-password mechanism, and deliver runtime secrets through a narrower secret file/store instead of general Compose environment.

## 45. [MEDIUM] Interactive credential reset echoes passwords

**Location:** `packages/or3-cloud/src/cli.ts:2940-2995`

Password prompts use ordinary `readline.question`, which displays input. Unlike init, reset has no password-file options for safe automation.

**Consequence:** rotated passwords appear on screen recordings, shoulder-surfing sessions, and some terminal logs; noninteractive users are pushed toward command-line flags.

**Fix:** use masked TTY input and add mutually exclusive owner/admin password-file flags.

## 46. [MEDIUM] Credential reset puts plaintext passwords in process arguments

**Location:** `packages/or3-cloud/src/cli.ts:3100-3130`

The CLI invokes `docker compose exec -e OR3_RESET_*_PASSWORD=<value>`. Those secrets are visible in the host `docker` process argument vector while the command runs; flag-based input also lands in shell history.

**Consequence:** other local processes/users with process-inspection rights can capture the new credentials.

**Fix:** stream a mode-0600 payload over stdin or mount a short-lived secret file and delete it after an atomic transaction.

## 47. [MEDIUM] Credential reset's admin-file update is not crash-safe

**Location:** `packages/or3-cloud/src/cli.ts:3025-3070,3133-3156`

The in-container script directly truncates/writes `admin-credentials.json`. A crash can leave malformed JSON; replay then rejects the corrupt file even though the journal contains the intended values.

**Consequence:** an interrupted reset can strand admin authentication and make the documented recovery path fail.

**Fix:** write/fsync/rename a temporary file, retain the previous bytes until database and file changes are verified, and make replay idempotent.

## 48. [MEDIUM] `doctor` ignores the new privileged boundary and can pass a dead public deployment

**Location:** `packages/or3-cloud/src/cli.ts:2394-2491`; `planning/admin-dashboard-updates/tasks.md:71-73`

Doctor does not validate operator enablement state, runtime digest, container identity, socket ownership/mode, Docker-socket/deployment mounts, or orphaned operator services. In public mode, free ports 80/443 produce warnings rather than failures, so internal deep health plus a running-but-unpublished Caddy container can still pass.

**Consequence:** the primary diagnostic command misses both the highest-privilege component and loss of the public listener.

**Fix:** validate the resolved operator boundary when enabled/disabled, fail on orphans, inspect actual Caddy mappings/listeners, and separately probe public HTTPS.

## 49. [MEDIUM] Docker commands can hang forever despite advertised deadlines

**Location:** `packages/or3-cloud/src/cli.ts:370-395,691-703,1223-1227,1482-1543`

The generic `execFile` wrapper and streaming helpers have no timeout or abort handling. Even `waitForDeepHealth()` has only an outer clock; one hung `docker compose exec` prevents the loop from reaching its deadline.

**Consequence:** init/update/recover/doctor/backup can hang indefinitely while holding the future lifecycle lock or leaving downtime active.

**Fix:** give every Docker call an abortable per-command timeout, kill the process group, close streams, and bound the total operation separately.

## 50. [MEDIUM] Remote-Docker checks inspect the client machine

**Location:** `packages/or3-cloud/src/cli.ts:741-747,880-908`

Port availability and host architecture come from the Node client, not the daemon selected by `DOCKER_HOST`. The code explicitly allows remote/TCP Docker for CLI-only operation.

**Consequence:** an x64 laptop can reject a valid remote ARM daemon, and local free-port checks say nothing about ports on the remote host.

**Fix:** query daemon architecture via `docker info`; perform host-port validation at the daemon or treat validated container startup as authoritative.

## 51. [MEDIUM] Dangerous commands silently ignore positional arguments

**Location:** `packages/or3-cloud/src/cli.ts:250-270,2302-2308,3418-3454`

Dispatch accepts extra positionals for update, rollback, doctor, recover, remove, init/adopt, and others. `or3 remove ./staging --purge-data --yes` purges the current working deployment, not `./staging`; restore ignores values after the first.

**Consequence:** a typo that looks like an explicit target can destroy a different deployment.

**Fix:** centrally declare and enforce positional arity for every command before dispatch, or consistently support an explicit directory option.

## 52. [MEDIUM] "Atomic" lifecycle files are not durable across power loss

**Location:** `packages/or3-cloud/src/cli.ts:405-412,1189-1217,1482-1504`; `packages/or3-cloud/assets/dashboard-operator.mjs:40-58`

State, journal, job, and archive commits rename temporary files without syncing the file and parent directory. Rename atomicity does not guarantee persistence after power loss.

**Consequence:** data/config can be mutated while the pending record or completed archive vanishes or reverts, defeating the crash-recovery contract.

**Fix:** fsync the temporary file before rename and fsync the containing directory afterward; add fault-injection tests around every phase boundary.

## 53. [MEDIUM] Old backups without asset hashes restore under today's assets

**Location:** `packages/or3-cloud/src/cli.ts:1137-1175`

When `managedAssetSha256` is absent, `restoreManagedAssets()` silently returns false. Restore still switches to the backup's older image/config while leaving current Compose/Caddy files in place.

**Consequence:** an older image runs under potentially incompatible mounts/proxy/profile behavior, contrary to the documented asset-restoration guarantee.

**Fix:** refuse legacy assetless restores with exact recovery instructions, or fetch authenticated assets for the backup release.

## 54. [MEDIUM] Invalid password-file input leaves a poisoned partial init

**Location:** `packages/or3-cloud/src/cli.ts:230-233,480-489,1040-1060,1804-1861`

Password validation permits NUL/internal newline characters, while environment serialization rejects them later. Init performs network/image work and creates/copies managed files before that rejection and before journaling the init operation.

**Consequence:** a multiline password file leaves a non-empty unmanaged directory that retry refuses and recovery cannot identify.

**Fix:** validate environment-safe characters before any side effect and journal init before the first managed filesystem mutation.

## 55. [MEDIUM] Failed asset rollback deletes its own remaining recovery copies

**Location:** `packages/or3-cloud/src/cli.ts:1070-1110`

If restoring one `.previous-*` file fails, the rollback loop aborts. The outer `finally` then deletes every remaining rollback copy anyway.

**Consequence:** a permission/filesystem error can leave a mixed release asset set and destroy the immediate copies needed to repair it.

**Fix:** attempt all rollback entries, aggregate errors, retain backups until the restored set is verified, and fsync commits.

## 56. [LOW] Purge leaves the operator executable behind

**Location:** `packages/or3-cloud/src/cli.ts:3393-3406`

The purge file list omits `dashboard-operator.mjs`, even though `copyAssets()` always installs it.

**Consequence:** the command claims managed files are gone, but re-init rejects the non-empty directory and a stale privileged program remains on disk.

**Fix:** derive purge targets from `managedAssetNames(mode)` plus the explicitly managed secret/state files.

## 57. [LOW] The published GPL package omits its license text

**Location:** `packages/or3-cloud/package.json:6,21-24`

`npm pack --dry-run --ignore-scripts --json` includes README, assets, dist, and package metadata, but no `LICENSE`. The repository-level license is outside the package root and is not packed.

**Consequence:** distributed tarballs declare GPL-3.0 without shipping the license text, creating avoidable compliance and consumer-scanner failures.

**Fix:** include a `LICENSE` file in the package (or explicitly include the root license during packaging) and assert it in the tarball gate.

## 58. [PARTIAL — HIGH] The tests barely execute the dangerous code

**Location:** `packages/or3-cloud/test/cli.test.ts:1-542`; `packages/or3-cloud/test/security-assets.test.ts:52-103,188-213`

Coverage reports about 22.02% of CLI lines/37.89% of functions and 14.63% of operator lines/10.71% of functions. The 61 passing tests mostly import pure helpers or search source strings with `toContain()`. They do not execute Docker lifecycle dispatch, concurrent commands, interruption phases, real operator HTTP, restore failure, purge, credential transactions, or dashboard E2E.

**Consequence:** security assertions can pass because the desired text exists while runtime wiring is broken; the invalid Compose and dead adoption path both escaped.

**Fix:** replace source-string assertions with behavior tests, add disposable Docker lifecycle scenarios, fault injection, concurrent-process cases, and the required dashboard candidate harness.

## 59. [LOW] The CLI is a 3,454-line blast radius

**Location:** `packages/or3-cloud/src/cli.ts:1-3454`

Argument parsing, secret handling, Compose resolution, image trust, archive streaming, backup formats, recovery state machines, adoption, verification HTTP, credential SQL, diagnostics, and destructive removal live in one file. The operator separately reimplements environment/state/version/process logic.

**Consequence:** phase invariants are implicit, boundary validators are duplicated or missing, and narrowly testing/reviewing a destructive change is unnecessarily hard.

**Fix:** split by concrete responsibility—trusted config/schema, Docker adapter, backup store, lifecycle state machine, commands—without inventing a generic framework. Keep one shared typed contract for dashboard state.

## 60. [LOW] The dashboard UI does not implement its polling/accessibility contract

**Location:** `app/components/admin/system/AdminSystemUpdateCard.vue:1-56,74-134`; `planning/admin-dashboard-updates/design.md:220-224`

The card polls every five seconds instead of two, uses an unbounded fixed interval rather than bounded reconnect backoff, and its changing job/error text has no live-region semantics.

**Consequence:** restart feedback is sluggish, a lost operator can poll forever, and screen-reader users are not notified of asynchronous state changes.

**Fix:** use the specified two-second active polling with bounded backoff/timeout, stop on terminal state, and expose status through `aria-live`/appropriate status roles.

## 61. [LOW] Backup enumeration hides real I/O failures as "no backups"

**Location:** `packages/or3-cloud/src/cli.ts:1288-1331`

`enumerateBackups()` catches every `readdir` failure and returns an empty list. It similarly turns file-stat failures into a zero-byte entry.

**Consequence:** permission errors, filesystem failures, and corrupt backup directories are misreported as absence/zero size, obscuring operational damage.

**Fix:** ignore only explicit not-found cases; surface permission/I/O/corruption errors with the affected path.

## 62. [LOW] Backup restart errors erase the original failure

**Location:** `packages/or3-cloud/src/cli.ts:1643-1656`

`createBackup()` throws again from `finally` when restart fails. JavaScript replaces the original archive/checksum/cleanup exception with the `finally` exception.

**Consequence:** operators lose the actual cause and may not know whether an artifact was completed or removed.

**Fix:** preserve the primary exception, attach restart failure as a cause/aggregate diagnostic, and report artifact state explicitly.

## 63. [DONE — HIGH] Provenance policy is applied to a bundle that was never cryptographically verified

**Location:** `packages/or3-cloud/assets/dashboard-operator.mjs:275-287,320-340`

`trustedProvenance()` fetches a DSSE envelope and checks repository/workflow/ref, but only verifies that a signature string exists. `npm audit signatures` later verifies the registry response it fetches independently. Comparing two fingerprints from `trustedProvenance()` proves the unverified response stayed stable; it does not prove that the identity-checked payload is the exact payload npm cryptographically verified.

**Consequence:** a registry-response adversary can separate the policy input from the cryptographic-verification input, defeating the intended trusted-workflow restriction while still satisfying the brittle `npm audit` text checks.

**Fix:** independently verify the inspected Sigstore bundle and transparency evidence, or obtain a structured verified bundle from npm and run `provenanceStatement()` against that exact verified payload.

## 64. [DONE — HIGH] An operator-driven update can recreate the container running the updater

**Location:** `packages/or3-cloud/src/cli.ts:1223-1227`; `packages/or3-cloud/assets/compose.yaml:74-100`

The operator launches the CLI inside its own container. The CLI installs new Compose assets and runs `docker compose up` for the whole project. Any release that changes the operator image, environment, mounts, command, or service definition lets Compose recreate the container that is still running the update before state commit. The stale-operator-image bug masks only some cases.

**Consequence:** a legitimate bridge/service change can kill its own transaction at the most dangerous point and force ambiguous recovery.

**Fix:** operator-origin updates must update/verify only application-facing services, commit terminal lifecycle state, then re-exec or replace the operator under an external/pinned supervisor.

## 65. [DONE — HIGH] A partially successful release cannot produce a successful rerun

**Location:** `.github/workflows/release-cloud.yml:61-74`; `docs/releasing.md:110-121`

The tag workflow fails immediately whenever npm already serves the version. If npm accepted the immutable package and a later propagation/verification step failed, rerunning the unchanged tag can never reach exact-artifact verification, even though the release procedure relies on retrying unchanged publication verification and requires a successful workflow.

**Consequence:** a correctly published immutable package can leave the release permanently red, encouraging manual bypasses or an unnecessary version bump solely to repair workflow state.

**Fix:** when the version exists, compare public integrity, shasum, provenance, and receipt identity. Continue verification only for an exact match; reject every mismatch and never republish.

## 66. [MEDIUM] The privileged Unix API is world-writable and has no defense-in-depth authorization

**Location:** `packages/or3-cloud/assets/dashboard-operator.mjs:468-531`

The socket is chmod `0666`; `/check` and `/start` authenticate no peer or capability. The read-only app bind prevents file writes, not socket connections. Any server-side code execution or request primitive in the large Nuxt process bypasses the super-admin/CSRF HTTP route and can directly force a verified update, backup, downtime, and rollback path.

**Consequence:** the browser/API authorization boundary is the only thing preventing unprivileged update initiation; compromise of the app process immediately gains the operator's closed-but-disruptive control plane.

**Fix:** use the narrowest group/mode possible, rate-limit and audit operations, validate peer credentials where supported, and add an operator-verifiable, short-lived authorization proof. Document that application RCE remains inside this trust boundary.

## 67. [MEDIUM] `cap_drop` does not sandbox a process holding the Docker socket

**Location:** `packages/or3-cloud/assets/compose.yaml:81-99`

The operator receives the Docker socket read-write and the whole deployment directory read-write. Docker API access is host-root-equivalent; non-root UID, read-only container root, and dropped Linux capabilities do not materially contain a compromised operator.

**Consequence:** a vulnerability in the operator, npm, Docker client, or its supply chain compromises the host, not merely the sidecar.

**Fix:** put a narrowly allow-listed Docker control proxy in front of the daemon and restrict filesystem writes to exact managed paths. At minimum, model and document this service as a host-root trust component instead of presenting container hardening as a boundary.

## 68. [DONE — HIGH] The required Content Security Policy does not exist

**Location:** `packages/or3-cloud/assets/Caddyfile:1-18`; `scripts/release/smoke-browser.mjs:363-382`

The public proxy sets HSTS, `nosniff`, X-Frame-Options, Referrer-Policy, and Permissions-Policy, but no `Content-Security-Policy`. Repository search finds no general application header supplying one, while the release browser smoke explicitly requires `frame-ancestors 'none'`.

**Consequence:** public Cloud lacks the defense the release gate claims to require, and the clean browser smoke should fail once it actually reaches this assertion.

**Fix:** add a compatible explicit CSP at the application or proxy boundary and test the exact production response, not source text.

## 69. [MEDIUM] Package provenance is not cross-bound to image source identity

**Location:** `packages/or3-cloud/assets/dashboard-operator.mjs:242-273`

The provenance policy requires an expected tag ref and merely some 40-hex `gitCommit`. It does not compare that commit to authenticated `org.opencontainers.image.revision`/version labels or a signed candidate receipt for the embedded image digest.

**Consequence:** trusted package-workflow identity and trusted image-source identity remain separate assertions rather than one end-to-end source/package/image identity.

**Fix:** carry the candidate source SHA in signed package metadata/receipt and require equality across verified provenance, package metadata, image labels, and managed target version before mutation.

## 70. [MEDIUM] Normal package checks never test the manifest shape that gets published

**Location:** `packages/or3-cloud/package.json:18-20`; `.github/workflows/release-cloud-candidate.yml:119-139`

The checked-in package lacks `or3Cloud.imageDigest`. Candidate qualification mutates it only after normal release preparation/tests. Consumers and the operator require that release-only field, but ordinary package tests exercise a different manifest.

**Consequence:** schema mistakes, packaging omissions, and compatibility failures in the exact published metadata can bypass the regular gate.

**Fix:** generate the final manifest before package qualification or run the complete package/operator suite against the exact final tarball after digest injection.

## 71. [LOW] HSTS claims every subdomain without validating that promise

**Location:** `packages/or3-cloud/assets/Caddyfile:1-10`

`Strict-Transport-Security` always includes `includeSubDomains`. Users can configure an apex or parent domain whose unrelated subdomains are not all HTTPS-safe.

**Consequence:** one OR3 deployment can tell browsers to force HTTPS for unrelated sibling services and make them unreachable.

**Fix:** omit `includeSubDomains` by default, or make it an explicit option with documentation and validation that the operator controls the whole subtree.
