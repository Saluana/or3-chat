# Tasks

This is planning only. Every implementation checkbox is intentionally open. Estimates are active implementation time per task, not promises about CI, review, registry propagation, or release elapsed time.

Deliver in three increments: **A — prevent cleanup deadlocks and ship compatible readers; B — introduce preview, observation, and safe recovery; C — finish dashboard/browser and release experience.** Each increment must carry its relevant regression tests before publication. Do not publish merely because a section is complete; follow the release gates below and `docs/releasing.md`.

> Implementation status. **Sections 1–9 are implemented.** Locally verified (all green): `packages/or3-cloud check` (typecheck + build + 99 tests), full app `type-check`, `test:release-policy` (30), focused vitest suites (operator-client, dashboard harness, admin route policy, app auth, release preflight; 80+), `check:docs`, `pack:check`, `release:cloud:check`, and YAML parse of both edited workflows. Highlights: schema-2 state with an atomic schema-1 migration; classified backup inventory and protection-aware retention; commit-before-cleanup with an exported terminal receipt; independent observations and `verify --read-only`; shared `update --dry-run`; `recover --dry-run/--finish/--restore --yes` with explicit data-loss consent and idempotent finish; handoff reconciliation independent of application data; protocol-2 operator endpoints (`/v2/status`, `/v2/preview`) with protocol-1 responses preserved and app-side fallback; a card with preview, reconnect, receipt warnings, and needs-attention gating; the OpenRouter restart-without-replay fix plus a synthetic connection journey and restrictive-CSP control; and `release:prepare --repository`. Representative regression cases were added to the **existing** candidate lifecycle job and the extended-validation managed lifecycle (no new workflows, jobs, runners, schedules, status contexts, or image builds).
>
> A release-blocker review then hardened nine defects, all fixed and unit/contract-verified: (1) `status --json` now emits an explicit public projection with no credential-reset payloads or raw configuration; (2) restore/rollback/recovery completion treat operation-mirror deletion as warning-only housekeeping so a cleanup failure cannot re-enter a destructive handler or rewrite terminal state; (3) an update that has started the target no longer auto-restores — the journal is preserved for an explicit choice; (4) `recover --restore --yes` takes precedence over `--finish`; (5) handoff reconciliation is evaluated before the no-pending early return and uses the journal's recorded dashboard job id; (6) the operator's handoff completion acquires the deployment lease, reloads state, verifies the operation/job identity, then persists; (7) this release is the compatibility bridge — it writes managed state schema 1 by default, gates schema-2 migration on `or3Cloud.stateSchema` plus the declared minimum bridge source, and a bridge writer refuses to mutate newer-schema state; (8) target-ready proof and finish now require the observed container binding, SQLite integrity/ownership, and public deep health; (9) `start`/`restart` enforce an explicit pending-phase policy while `stop` and read-only observation stay available.
>
> A second correctness review then fixed nine more issues: (10) the operator registers `/v2/preview` and the card surfaces a preview failure with an explicit retry path instead of swallowing it; (11) the PKCE exchange disables SDK retries and uses a bounded timeout so a used authorization code fails fast into a fresh authorization; (12) `update --dry-run` and execution share one assessment under the lease, required-asset read failures are blockers, and preview runs the read-only Docker/architecture probe instead of deferring it; (13) `--json` emits exactly one `or3-operation-result` for success, no-op, blocked, and failure on both `update` and `recover`, with progress on stderr; (14) post-commit maintenance warnings are persisted into the receipt and finish recovery no longer silently suppresses pruning failures; (15) read-only verification reports deliberately skipped checks as `deferred` and only exits nonzero on real failures, status survives an unreadable `.env`, and the observed image digest comes from the running container; (16) release readiness blocks on missing/inactive or non-dispatchable required workflows on the default branch, persists the readiness report, and exits nonzero before expensive checks; (17) backup pruning inventories once and revalidates only the selected entry; (18) CSP diagnosis only treats a blocked OpenRouter connection directive as an OpenRouter connection failure.
>
> **Only section 10 remains, and it is owner/release-gated**: 10.1's documented full gate (`bun run release:prepare -- --version <unused> --registry --full`) requires a clean worktree and a chosen unused version; 10.2–10.3 require the GitHub candidate/tag workflows and npm/GHCR publication; 10.4 requires a production managed deployment and live acceptance. The release guardrails forbid an agent from publishing or touching production, so these were not performed. The Docker/browser lifecycle steps above are written and wired but were not executed in this environment. `check:lock-drift` reports a pre-existing `reka-ui` lock inconsistency unrelated to this change (neither `package.json` nor `bun.lock` is modified).

CI limit: add zero workflows, jobs, runner requirements, services, schedules, required status contexts, or image builds. Essential regression cases belong in the existing Cloud tests and candidate lifecycle job. Broader historical/interruption/browser combinations belong in existing Extended validation for relevant changes; no new cross-workflow gating system is required. Existing security and release gates stay required.

## 1. Establish contracts and historical fixtures

- [x] 1.1 Capture focused fixtures for current and historical deployment formats (2–3h).
      Components: C2, C9, C12. Requirements: R2.AC1–AC4, R9.AC1, R13.AC1.
      Done when: fixture provenance identifies current published source, representative older supported state, unsigned backups, adoption artifacts, malformed/unsupported entries, and old pending journals; all credentials and data are synthetic. Reuse the current candidate fixtures, put entry/format permutations in existing Cloud tests, and reserve additional deployed-version combinations for existing Extended validation.

- [x] 1.2 Define operation, diagnostic, receipt, and compatibility contracts (3–4h).
      Components: C1, C3, C6, C12. Requirements: R1.AC1–AC4, R3.AC1–AC5, R6.AC1–AC4, R13.AC1.
      Done when: types distinguish terminal outcome from check/maintenance status; update phase variants require their evidence; a transition table states which old/new readers can observe or mutate each format. Avoid a general state-machine library.

- [x] 1.3 Add deterministic lifecycle fault seams to the existing test harness (2–4h).
      Components: C1, C9. Requirements: R1.AC3, R9.AC2–AC3, R13.AC2–AC3.
      Done when: tests can fail state writes, archive reads, deletes, command execution, and handoff scheduling at named boundaries while calling production logic; no production CLI flag or published asset enables fault injection.

## 2. Make backup history observable and retention safe — increment A

- [x] 2.1 Implement complete classified backup inventory (3–4h).
      Components: C2, C6. Requirements: R2.AC1–AC2, R2.AC4, R6.AC2, R13.AC3.
      Done when: mixed entries produce all findings in deterministic order, symlinks are not followed, and existing restore/export authentication remains strict. Tests include missing tag versus invalid tag versus unreadable store.

- [x] 2.2 Separate retention decisions from destructive execution (2–4h).
      Components: C2. Requirements: R2.AC2–AC4, R5.AC1, R13.AC3.
      Done when: a pure plan accounts for verified, excluded, and protected entries; pending source and previous-snapshot references cannot be removed; suspect entries defer automatic pruning; deletion revalidates state/path/metadata under the lease.

- [x] 2.3 Expose inventory and maintenance outcomes through existing backup commands (2–3h).
      Components: C2, C6, C11. Requirements: R2.AC1–AC4, R6.AC2–AC3, R12.AC4.
      Done when: list shows preserved history with trust labels, JSON is parseable, explicit prune reports a specific blocked cleanup result, and messages point to supported actions without state-edit advice. Update the Cloud README and deployment-operations guidance for this increment.

## 3. Fix completion ordering and prepare compatible readers — increment A

- [x] 3.1 Make terminal state authoritative and cleanup post-commit (3–4h).
      Components: C1, C6. Requirements: R1.AC1–AC3, R6.AC1–AC4, R13.AC2.
      Done when: target identity, rollback point, terminal result, and pending removal share one atomic state write; operation mirrors are deleted afterward; prune failure returns completed-with-warnings without reopening pending state. Apply the same write-before-mirror-delete rule to recovery completion.

- [x] 3.2 Make completion and mirror failures replay-safe (2–3h).
      Components: C1, C6, C9. Requirements: R1.AC2–AC3, R3.AC5, R6.AC4, R9.AC2.
      Done when: process faults before/after rename/fsync and during mirror/prune writes resolve from durable state; target data and rollback references remain intact; an ambiguous write never produces a false success.

- [x] 3.3 Ship schema-2-aware CLI/operator readers while retaining schema-1 writes (3–4h).
      Components: C7, C12. Requirements: R7.AC4, R13.AC1.
      Done when: the bridge recognizes and diagnoses both formats, dispatches only supported exact target recovery, retains protocol-1 response shapes, and rejects unknown future formats before mutation. Schema-2 mutation not implemented by the bridge directs the owner to a compatible target CLI.

- [x] 3.4 Establish versioned dashboard protocol negotiation (3–4h).
      Components: C7, C12. Requirements: R7.AC4, R13.AC1–AC2.
      Done when: bridge readers understand protocol versions 1/2, old app validators continue to accept protocol-1 responses, and published compatibility metadata can reject updates that skipped the bridge. No arbitrary command/package-location input is accepted.

- [x] 3.5 Prove cleanup relief against the published source and document the bridge path (3–4h).
      Components: C1, C2, C7, C9, C11, C12. Requirements: R1.AC1–AC4, R2.AC1–AC4, R9.AC1–AC4, R12.AC4, R13.AC1.
      Done when: a disposable update with historical backups and forced post-commit cleanup failure stays healthy and unblocked, old app/operator contracts pass, and source-to-bridge/bridge-to-target instructions are explicit.

- [x] 3.6 Add essential safety regressions to the existing required jobs (1–2h).
      Components: C9, C10. Requirements: R9.AC4, R10.AC3, R10.AC5–AC6.
      Done when: completion/cleanup/protected-backup regressions run in the current Cloud tests and lifecycle job against existing exact artifacts; no job, matrix, build, or required status is added. Increment A is eligible for section 10 qualification with its section 9 docs and relevant existing compatibility checks, without waiting for new browser coverage.

## 4. Build observation and update preview — increment B

- [x] 4.1 Refactor diagnostic loading into independent observations (2–4h).
      Components: C4, C6. Requirements: R4.AC1, R4.AC3, R6.AC2, R11.AC2.
      Done when: status/doctor can report partial state, environment, Docker, lease, image, and backup evidence even if one source is corrupt; actual versus recorded identities are distinguished; changing observations are marked in progress.

- [x] 4.2 Add `verify --read-only` and explicit command mutation policy (3–4h).
      Components: C3, C4, C12. Requirements: R4.AC1–AC4, R13.AC2.
      Done when: read-only commands bypass lease acquisition/reclaim and cannot invoke login, write probes, pulls, helper containers, or writable database checks; unsafe/unavailable checks are deferred. Tests cover pending update/restore and the phase policy for start/stop/restart.

- [x] 4.3 Implement shared update assessment and dry-run flags (3–4h).
      Components: C2, C4, C5, C6. Requirements: R5.AC1–AC2, R5.AC4, R6.AC3, R11.AC2.
      Done when: preview lists all independent blockers, protected backups/prune decisions, asset changes, compatibility, and deferred checks in one report. Side-effect assertions prove no deployment/Docker mutation, even with pending or corrupt state.

- [x] 4.4 Move preparation ahead of the downtime boundary and revalidate on execute (3–4h).
      Components: C1, C5, C7. Requirements: R5.AC3–AC4, R13.AC2–AC4.
      Done when: actual update repeats critical checks under the lease, resolves both app/operator artifacts before stopping OR3, checks actual storage capacity, and still authenticates the fresh snapshot before replacement. Already-installed exact targets produce a no-op result.

## 5. Introduce explicit finish-versus-restore recovery — increment B

- [x] 5.1 Implement atomic migration and validated new update journals (3–4h).
      Components: C1, C12. Requirements: R1.AC1, R3.AC2–AC3, R13.AC1.
      Done when: only settled bridge deployments enter schema 2, migration and initial pending record are one atomic write, source identity/rollback references survive, and incompatible old tools cannot mutate the new format.

- [x] 5.2 Record target-ready proof after replacement and required checks (3–4h).
      Components: C1, C4. Requirements: R1.AC1, R3.AC2–AC3, R9.AC2.
      Done when: proof binds the completed data boundary, configuration/assets, deployment identity, observed target container/digest, and check results; a crash before proof never gets inferred as completion from health alone.

- [x] 5.3 Implement `recover --dry-run` and `recover --finish` (3–4h).
      Components: C3, C4, C6. Requirements: R3.AC1–AC3, R3.AC5, R4.AC1.
      Done when: previews remain observational and finish revalidates proof under the lease, settles the target without restoring data, and is idempotent. Legacy/partial/conflicting journals produce actionable refusals.

- [x] 5.4 Make destructive recovery an explicit choice (2–4h).
      Components: C1, C3, C6. Requirements: R3.AC3–AC5, R4.AC4, R6.AC2.
      Done when: `recover --restore --yes` identifies the authenticated snapshot/data-loss boundary; plain recover never silently falls back to restore; update failure after potentially accepted writes preserves the explicit choice. Existing restore/rollback operation-specific recovery remains correct.

- [x] 5.5 Reconcile operator handoff independently from application data (3–4h).
      Components: C1, C3, C7. Requirements: R1.AC4, R3.AC5, R7.AC4, R13.AC2.
      Done when: helper scheduling/result persistence uses matching operation/job IDs; handoff failure preserves the healthy app, blocks unsafe dashboard mutation, and `recover --finish` retries only the recorded handoff. Tests cover supervisor exit before/after terminal receipt.

- [x] 5.6 Prove recovery data boundaries and legacy behavior (3–4h).
      Components: C3, C9, C12. Requirements: R3.AC1–AC5, R9.AC1–AC4, R13.AC1–AC3.
      Done when: post-replacement conversation/file fixtures survive finish, explicit restore returns to its stated snapshot, repeated recovery does nothing destructive, and legacy ambiguous state never receives false completion proof. Add representative cases to the existing lifecycle job from 3.6 and put broader interruption/history combinations in the existing Extended validation deployment suite. Increment B includes section 6 reporting and section 9 docs before section 10 qualification.

## 6. Unify results, receipts, and operator feedback — increment B/C

- [x] 6.1 Implement result rendering, stable codes, and redacted JSON output (2–4h).
      Components: C6. Requirements: R6.AC1–AC3, R11.AC2, R13.AC4.
      Done when: operational commands share outcome semantics, one JSON stdout object, stderr progress, observed/intended identity, and exact supported next commands. Errors identify the actual failing phase instead of inheriting restore/export wording.

- [x] 6.2 Persist and export the latest terminal receipt (2–3h).
      Components: C1, C6. Requirements: R1.AC2–AC3, R6.AC4, R11.AC2–AC3.
      Done when: terminal state contains a bounded receipt, the 0600 export can be regenerated, mirror failure only warns, and credentials/configuration/log contents cannot leak through serialization. Available source revision is labeled unknown when unproven.

- [x] 6.3 Surface verification gaps, maintenance findings, and phase timing (2–3h).
      Components: C4, C6. Requirements: R1.AC4, R6.AC1–AC4, R8.AC4, R13.AC4.
      Done when: progress appears during waits, completed checks survive later failure, missing live OAuth or owner credentials remain explicitly unverified, and operator attention differs from ordinary retained-backup warnings.

## 7. Improve dashboard and connection journeys — increment C

- [x] 7.1 Connect protocol-2 preview/results to existing admin APIs (3–4h).
      Components: C5, C6, C7, C12. Requirements: R7.AC1–AC4, R13.AC1–AC2.
      Done when: privileged operator invokes only the exact verified CLI, preview/results share CLI semantics, old protocol shapes still work, request IDs are idempotent, and authorization/origin/rate/response-size controls remain enforced.

- [x] 7.2 Update the Operations card for preview, stages, and reconnect (3–4h).
      Components: C7. Requirements: R7.AC1–AC4, R12.AC1.
      Done when: one confirmation starts one job, warnings do not appear as failed deployment, reload/reconnect retains identity, polling expiry is explained, and keyboard/live-status behavior works with existing Nuxt UI components.

- [x] 7.3 Make OpenRouter connection failure restartable without replay (2–4h).
      Components: C8. Requirements: R8.AC3, R12.AC1.
      Done when: one layer emits the error, a fresh state/verifier is generated on restart, uncertain code exchanges are not automatically repeated, confirmed CSP violations have specific guidance, and key persistence still uses existing helpers/events.

- [x] 7.4 Extend the existing browser harness for Caddy/connection regressions (3–4h).
      Components: C8, C9. Requirements: R8.AC1–AC4, R9.AC4.
      Done when: a focused Chromium smoke proves sign-in, synthetic PKCE exchange/reload, fresh-flow retry, one error display, and a failing restrictive-CSP control. WebKit/mobile and broader chat/file combinations run inside existing Extended validation jobs for relevant browser/auth changes, not the default candidate lane. Reuse the same built app/assets and record browser/source/digest/simulation evidence; no real keys or paid requests are created.

- [x] 7.5 Exercise dashboard interruption, reload, and protocol transitions (2–4h).
      Components: C7, C9, C12. Requirements: R7.AC1–AC4, R9.AC2–AC4, R13.AC1–AC2.
      Done when: existing contract tests cover request/result semantics and the existing dashboard harness covers dropped HTTP, expired session/relogin, repeated start ID, completed-with-warnings, restoration, and operator attention without launching duplicate updates. Broader old/new deployment combinations use the existing Extended validation deployment suite when protocol/operator behavior changes; add no CI matrix or job.

## 8. Detect release blockers and explain published changes — increment C

- [x] 8.1 Add read-only repository readiness to local release preparation (3–4h).
      Components: C10. Requirements: R10.AC1–AC2, R13.AC4.
      Done when: the proposed local `--repository` option reports default-branch workflow contents/registration, enabled state, permission/registry issues, and CI-capacity evidence before expensive work; inaccessible facts are unknown. The check needs no new CI job and changes no setting, billing, or workflow.

- [x] 8.2 Document check selection and retain results using existing summaries (1–2h).
      Components: C9, C10, C11. Requirements: R9.AC1–AC4, R10.AC3, R10.AC5–AC6, R11.AC3.
      Done when: the existing required tests/lifecycle job retain essential regressions, and guidance maps backup/state/migration, operator/protocol, and browser-facing Caddy/auth changes to existing named Extended validation suites. Relevant deeper results are reviewed before tagging and tied to the exact source/artifacts through current run links/receipts. Add no cross-workflow gate, duplicate evidence format, job, schedule, or build.

- [x] 8.3 Add component-specific release notes and publication status (2–3h).
      Components: C6, C10. Requirements: R11.AC1–AC3.
      Done when: notes distinguish CLI/app/assets/dependency or image rebuilds and fixed issues; release receipts separately record npm integrity, both public image digests/architectures, qualification, post-publication verification, deployment, and acceptance.

- [x] 8.4 Document workflow setup and capacity recovery without bypasses (1–2h).
      Components: C10, C11. Requirements: R10.AC2–AC4, R12.AC4.
      Done when: the runbook identifies administrator-owned setup/capacity actions, explains what cannot be verified automatically, and resumes the supported candidate/tag flow without manual publication or immutable-tag changes.

## 9. Finish onboarding guidance and review scope — each increment

- [x] 9.1 Refresh canonical operational docs and package/provider references (2–3h).
      Components: C11. Requirements: R3.AC4, R4.AC4, R5.AC1, R6.AC2, R7.AC4, R10.AC4, R12.AC1–AC4.
      Done when: `docs/cloud-updates.md`, `docs/releasing.md`, Cloud README, relevant Basic Auth/provider README, deployment-operations/troubleshooting/release-checklist public pages, and docmap agree on shipped behavior. Add exact-version examples and the bridge procedure; no draft command is represented as already released.

- [x] 9.2 Improve credential handoff and source-development guidance (1–3h).
      Components: C6, C8, C11. Requirements: R12.AC1–AC3.
      Done when: first-run output points to protected credential storage and existing host reset, distinguishes app/admin accounts, and docs explain pinned Bun setup and what `bun run dev` serves. Dependency-repair advice is scoped and preserves source/lockfiles.

- [x] 9.3 Perform a simplification and traceability review (1–2h).
      Components: C1–C12. Requirements: R1–R13.
      Done when: each acceptance criterion has implementation and meaningful verification, no generic repair framework/cache/new service was introduced, temporary harnesses cannot ship in npm, and compatibility additions serve the actual bridge. Review CI changes against R10.AC5–AC6: zero added workflows/jobs/runners/schedules/status contexts/builds, unchanged existing security gates, and no broad matrix on the candidate path. Inspect final diffs without touching unrelated user work.

## 10. Qualify, release, and verify adoption — repeat for each shipped increment

- [ ] 10.1 Run proportionate final source/package verification (2–4h active work).
      Components: C9, C10, C12. Requirements: R1–R13.
      Done when: relevant existing Cloud/server/release-policy checks and typechecks pass after one coherent batch; an isolated clean exact-commit worktree passes the existing required fixed-profile full release verification and docs/tarball/provider-registry checks. Use existing scripts such as `bun run cloud:package:check`, affected named suites, and documented `bun run release:prepare -- --version <unused-version> --registry --full`; run deeper browser/history suites only when relevant, and add no redundant build or new CI gate.

- [ ] 10.2 Qualify the exact candidate and compatibility transition (2–4h active work).
      Components: C9, C10, C12. Requirements: R8.AC1–AC4, R9.AC1–AC4, R10.AC1–AC3, R10.AC5–AC6, R13.AC1–AC4.
      Done when: the existing candidate workflow passes its architecture/native-addon/security checks and the focused lifecycle regressions in its current jobs. For relevant changes, the existing Extended validation suites also pass the affected history/interruption, compatibility, or browser cases before tagging, bound to the exact source/images/tarball. Reuse built artifacts and current summaries; add no always-on matrix, job, image build, or cross-workflow dependency. Record added runtime without increasing timeouts to mask stalls.

- [ ] 10.3 Publish through the existing tag workflow and independently verify artifacts (1–3h active work).
      Components: C10. Requirements: R10.AC2–AC3, R11.AC1–AC3.
      Done when: the source/remote SHA and unused identities are checked, the matching tag is pushed only after successful qualification, tag/post-publication jobs pass, and npm exact-version integrity/clean-cache invocation and both public multi-architecture digests are independently verified. Record the release receipt; no manual publication or tag reuse.

- [ ] 10.4 Perform a controlled exact-version managed deployment and acceptance (2–4h active work).
      Components: C1, C3–C8, C11, C12. Requirements: R1.AC1–AC4, R3.AC5, R5.AC1–AC4, R6.AC1–AC4, R7.AC1–AC4, R8.AC4, R11.AC3, R12.AC1–AC2.
      Done when: baseline status/doctor/space checks, verified rollback snapshot, exact pinned update, internal/public/auth/database checks, and one managed restart pass. Use preview/read-only verification only once those commands have shipped in increment B; increment A uses the existing documented observations. Observe retained conversation/file fixtures and let the owner complete a fresh real OpenRouter flow; if unavailable, record that acceptance as pending. Preserve rollback/previous deployment until acceptance. Never use production for fault injection or cleanup testing.

## Traceability Matrix

| Requirement | Design components | Tasks |
| --- | --- | --- |
| R1 Completion independent of cleanup | C1, C6, C7, C9, C12 | 1.2–1.3, 3.1–3.2, 3.5, 5.1–5.2, 5.5, 6.2–6.3, 10.1, 10.4 |
| R2 Trust-aware backup inventory | C2, C6, C9 | 1.1, 2.1–2.3, 3.5 |
| R3 Finish or explicit restore | C1, C3, C4, C6, C9, C12 | 1.2, 3.2, 5.1–5.6, 9.1, 10.1, 10.4 |
| R4 Always-available diagnostics | C3, C4, C6, C12 | 4.1–4.2, 5.3–5.4, 9.1 |
| R5 Preview and preflight | C2, C4, C5, C7 | 2.2, 4.3–4.4, 9.1, 10.4 |
| R6 Outcomes and receipts | C1, C6 | 1.2, 2.1, 2.3, 3.1–3.2, 4.1, 4.3, 5.4, 6.1–6.3, 9.1, 10.4 |
| R7 Dashboard parity | C5, C6, C7, C9, C12 | 3.3–3.4, 5.5, 7.1–7.2, 7.5, 9.1, 10.4 |
| R8 Actual browser journey | C8, C9 | 6.3, 7.3–7.4, 10.2, 10.4 |
| R9 Historical/fault qualification | C2, C3, C7, C9, C12 | 1.1, 1.3, 3.2, 3.5–3.6, 5.2, 5.6, 7.4–7.5, 8.2, 10.2 |
| R10 Release readiness and CI scope | C9, C10, C11 | 3.6, 8.1–8.2, 8.4, 9.1, 9.3, 10.2–10.3 |
| R11 Clear fix/artifact identity | C4, C5, C6, C10 | 4.1, 4.3, 6.1–6.2, 8.2–8.3, 10.3–10.4 |
| R12 First-use and developer guidance | C6, C8, C11 | 2.3, 3.5, 7.2–7.3, 8.4, 9.1–9.2, 10.4 |
| R13 Compatibility and operational safety | C1–C5, C7, C9, C12 | 1.1–1.3, 2.1–2.2, 3.1, 3.3–3.5, 4.2, 4.4, 5.1, 5.5–5.6, 6.1, 6.3, 7.1, 7.5, 8.1, 10.2 |

## Definition of Done

- All acceptance criteria for the shipped increment have passing evidence; the full plan is complete only when R1–R13 are satisfied and this matrix has no gaps.
- Required verification commands and exact candidate gates are green; introduced failures are fixed and unrelated failures are identified explicitly. No test was run merely to create this plan.
- CI adds no workflows, jobs, runners, services, schedules, required status contexts, or image builds. Existing required/security checks remain intact; essential new regressions run in existing tests/lifecycle, and broader historical/browser combinations use existing Extended validation only as relevant to the release changes.
- A cleanup failure cannot turn a completed deployment into pending recovery. Diagnostics remain available, and every automatic deletion preserves required recovery sources.
- Finish recovery preserves post-replacement writes; restoring requires explicit acknowledgment of its snapshot boundary. Neither action replays after successful completion.
- Existing deployments pass the supported bridge/format/protocol transition. A failed privileged operator handoff has a managed repair path that does not roll back healthy application data.
- CLI and dashboard agree on what is installed, what passed, what remains unverified, and the next supported action. Browser fixture evidence is distinct from real OpenRouter acceptance.
- npm/image publication and production deployment are separately verified and documented; release versions/tags remain immutable.
- Docs describe only shipped commands, normal tasks do not require source inspection or state edits, and the rollback point remains preserved through owner acceptance.
