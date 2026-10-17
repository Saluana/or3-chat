# Tasks

Implement [requirements](requirements.md) using the components and contracts in [design](design.md). Work in dependency order. Estimates are focused implementation time per task, excluding review/CI waits. All boxes start unchecked because this delivery has produced a plan, not runtime changes.

For every implementation task: record credible failure cases and add its meaningful failing regression **before** changing production behavior. Extend canonical suites where possible. Use real process/browser boundaries for lifecycle behavior; do not test a local reimplementation or mock a successful restart. Preserve unrelated work already present in the checkout.

Ship the safe wait policy first. Recoverable interruption is a capability gate, not a required force button. No task below authorizes a production restart, release, image publication, or deployment.

## 1. Establish evidence and resolve delivery gates

- [ ] 1.1 Capture the audit baseline and failure matrix. **2h**
      Requirements: R3.AC1–AC5, R4.AC1–AC5, R6.AC3–AC4, R7.AC2, R10.AC1–AC3, R12.AC1.
      Components: C3 Drain coordinator, C6 Configuration activation, C7 Dev supervisor, C10 Qualification evidence.
      Done when: repeatable disposable probes cover premature exit, hung count lookup, active execution, unwritable marker, live-output rebuild risk and stale inherited config; evidence distinguishes confirmed behavior from hypotheses. Record baseline versions and existing focused tests without touching a live deployment.

- [ ] 1.2 Create the named isolated restart E2E harness and failing baseline journey. **4h**
      Requirements: R12.AC1–AC3.
      Components: C10 Qualification evidence.
      Done when: `bun run test:e2e:server-restarts` exists with explicit dev/managed/failure/performance selection, temporary configuration/data, owned-process cleanup and redacted artifact output. A real admin restart journey demonstrates the existing dev refusal; restart is not intercepted into fake success. Reuse current admin-auth and Cloud harness utilities.

- [ ] 1.3 Prove the single-owner shutdown integration on the installed Nuxt/Nitro runtime. **3h**
      Requirements: R3.AC2–AC5, R7.AC5, R12.AC1.
      Components: C3 Drain coordinator, C7 Dev supervisor, C10 Qualification evidence.
      Done when: a real-process fixture identifies the final-exit owner, proves `close`/persistence cleanup on signal and dev replacement, and records timeout nesting. The selected integration removes the competing OR3 exit path and has no orphan process/worker.

- [ ] 1.4 Resolve environment provenance before dev configuration work. **4h**
      Requirements: R6.AC4, R7.AC1–AC3, R12.AC4.
      Components: C6 Configuration activation, C7 Dev supervisor, C10 Qualification evidence.
      Done when: a disposable launcher prototype on supported Bun proves changed/deleted file values and real shell/CLI overrides, including equal-valued overrides. Inventory all entry points affected by project-level auto-load opt-out and record explicit-loader migration coverage. Resolve the audit's Bun 1.3.6 versus manifest 1.3.14 mismatch; do not claim a child-only flag repairs a polluted parent.

- [ ] 1.5 Qualify the managed restart/recreate primitive before enabling it. **3h**
      Requirements: R5.AC1–AC5, R6.AC3, R10.AC3, R12.AC4.
      Components: C5 Managed controller, C6 Configuration activation, C10 Qualification evidence.
      Done when: a disposable read-only app/operator/volume fixture proves ordinary restart and environment-only recreation preserve exact image and data identity, use existing grace periods, and perform no image pull/build/data restore. Record the existing lifecycle/lease entry points to reuse.

**Gate:** Resolve 1.3–1.5 before implementing their dependent adapters. An unsafe or unproven environment reports unsupported; do not replace a failed gate with an unverified exit or kill-by-port fallback.

## 2. Define contracts and durable operation state

- [ ] 2.1 Add validated lifecycle contracts and the server adapter registry. **3h**
      Requirements: R1.AC1–AC4, R2.AC2, R10.AC3.
      Components: C1 Lifecycle adapters, C2 Admin lifecycle API.
      Done when: request/response schemas reject invalid IDs, revisions, phase states and arbitrary execution fields; registry registration is SSR-only and disposable under dev reload. Unsupported capabilities have stable redacted codes; client contracts carry no server dependencies.

- [ ] 2.2 Implement the bounded receipt/journal store and replay rules. **4h**
      Requirements: R2.AC1–AC4, R11.AC1, R11.AC3–AC4.
      Components: C5 Managed controller, C7 Dev supervisor.
      Done when: private atomic persistence precedes acceptance, identical replay returns the original result, conflicting payloads fail, and 24-hour replay survives controller restart. Capacity refuses new work without evicting active/unresolved/unexpired records; disk failure and malformed state fail closed. Keep managed state schema versions unchanged.

- [ ] 2.3 Add boot identity, bounded readiness and effective-state evidence. **3h**
      Requirements: R3.AC1, R5.AC4, R6.AC4, R11.AC1, R11.AC4.
      Components: C4 Boot observer, C6 Configuration activation.
      Done when: one boot identity survives module reloads but changes on actual replacement; readiness is bounded and reflects drain/provider state; public responses stay coarse and existing liveness remains compatible. Private effective-state comparison rejects old boot, wrong target and copied-but-inaccurate revisions.

## 3. Protect active work and unify shutdown

- [ ] 3.1 Implement preparation and final-drain states with deadlines. **4h**
      Requirements: R3.AC1–AC5, R4.AC2, R11.AC4.
      Components: C3 Drain coordinator.
      Done when: the existing controller has idempotent preparation, cancel/resume and final closure; the monotonic deadline exists before any participant lookup. Hanging/rejected participants cannot bypass budgets. Default preparation timeout cancels before termination; final drain completes promptly when empty.

- [ ] 3.2 Register request/persistence work and classify admission. **4h**
      Requirements: R3.AC1–AC4, R9.AC1.
      Components: C3 Drain coordinator, C9 Client continuity.
      Done when: actual work is tracked through persistence after socket close; new long work is deferred, existing upload/commit and control callbacks can finish, and final draining gates new mutations. Query strings do not break health/control exemptions. Passive SSE closes without consuming the whole drain window.

- [ ] 3.3 Make background execution participate in preparation. **4h**
      Requirements: R4.AC1–AC5.
      Components: C3 Drain coordinator.
      Done when: schedulers stop new claims, active execution promises/flushes are tracked, owned leases remain renewed until completion, and memory jobs cause wait/cancel rather than silent loss. Existing fenced checkpoints and uncertain-tool semantics remain unchanged; a restart never automatically repeats an uncertain tool.

- [ ] 3.4 Classify workflow/plugin/browser-tool blockers. **3h**
      Requirements: R4.AC2–AC5, R12.AC4.
      Components: C3 Drain coordinator, C10 Qualification evidence.
      Done when: each supported execution owner registers lifecycle participation or is explicitly unsupported for interruption; inactive parked records and executing tool work have documented separate treatment. Capability tests prove no recoverable-interruption action is advertised without quiescence/checkpoint/fencing conformance. Rebuild provider outputs if any provider implementation changes.

- [ ] 3.5 Wire the qualified Nitro signal/close integration and remove direct exit. **3h**
      Requirements: R3.AC3–AC5, R10.AC1–AC3.
      Components: C3 Drain coordinator, C1 Lifecycle adapters.
      Done when: OS signals and controller replacement enter the same lifecycle with one exit owner, cleanup occurs once within the proven grace budget, and no admin helper writes a restart marker or calls delayed `process.exit()`. The unsafe rebuild path cannot execute a shell/build while replacement APIs are being introduced.

## 4. Make the source launcher restartable

- [ ] 4.1 Implement explicit launch environment loading from the proven gate. **4h**
      Requirements: R6.AC4, R7.AC1–AC3, R12.AC4.
      Components: C6 Configuration activation, C7 Dev supervisor.
      Done when: clean inherited values and file-derived values have distinct provenance; standard dev commands reload changed/deleted keys with correct precedence, and duplicate dotenv loading in preparation is removed. Every entry point affected by auto-load opt-out retains its prior semantics under its recorded regression fixture.

- [ ] 4.2 Add the private persistent dev supervisor/control channel. **4h**
      Requirements: R1.AC1–AC4, R2.AC1–AC4, R7.AC1, R7.AC5.
      Components: C7 Dev supervisor, C1 Lifecycle adapters.
      Done when: the wrapper owns one child tree, private instance-scoped socket/token and bounded durable receipts; validates identity and legal transitions; and stays alive through replacement failure. Missing/stale ownership never triggers kill-by-port or arbitrary PID termination.

- [ ] 4.3 Implement owned-child replacement and cache-preserving relaunch. **4h**
      Requirements: R7.AC1–AC5, R11.AC4.
      Components: C7 Dev supervisor, C3 Drain coordinator.
      Done when: a valid prepared receipt replaces the whole owned Nuxt CLI child on the original runtime/args/port/origin, waits for old listeners to close, and performs one verified replacement. Prepared provider artifacts are reused; invalidated prerequisites fail before stopping. Ctrl+C and startup failure leave no hidden respawn loop.

- [ ] 4.4 Coalesce environment watchers and verify repeated dev use. **3h**
      Requirements: R7.AC2–AC6, R8.AC3.
      Components: C7 Dev supervisor, C4 Boot observer, C10 Qualification evidence.
      Done when: watcher/manual requests for the same revision produce one relaunch, two consecutive replacements verify new boots, and auth, effective configuration, actual HMR and optional HTTPS/WebSockets still work. The fixture proves no duplicate watchers or stale occupied ports.

## 5. Add managed lifecycle support through the existing operator

- [ ] 5.1 Add the versioned lifecycle namespace and local qualified runner. **4h**
      Requirements: R1.AC3, R5.AC1–AC2, R12.AC4.
      Components: C5 Managed controller, C1 Lifecycle adapters.
      Done when: the existing operator/client support `/lifecycle/v1` with bounded validation and capability discovery, and a qualified exact-version runner is staged through the existing install/update packaging path. Restart does not download packages. Legacy update protocol responses remain byte-shape compatible; old operators report unsupported.

- [ ] 5.2 Fence lifecycle work against every managed mutation. **4h**
      Requirements: R2.AC3–AC4, R5.AC3, R11.AC3.
      Components: C5 Managed controller.
      Done when: CLI/dashboard restart and updates/backups/restores/credential operations use the existing deployment lease and check unresolved lifecycle journals. Concurrent requests cannot create a second execution, including after a controller crash releases its lock but leaves uncertain state.

- [ ] 5.3 Execute same-image restart/recreate through the canonical lifecycle command. **4h**
      Requirements: R5.AC1–AC5, R6.AC3, R10.AC3.
      Components: C5 Managed controller, C4 Boot observer.
      Done when: the existing restart command consumes validated targets, persists execution intent, verifies deployment/data/image identity, invokes the qualified primitive and observes a new ready boot. Unchanged restart leaves rollback references untouched; startup failure retains data and actionable diagnostics.

- [ ] 5.4 Reconcile operation state after operator interruption. **4h**
      Requirements: R2.AC4, R5.AC3–AC5, R11.AC4.
      Components: C5 Managed controller, C10 Qualification evidence.
      Done when: process fault injection before/after intent, stop and new-boot observation yields safe cancellation, continued observation or `needs_attention`; it never blindly repeats an uncertain restart/recreation. Unresolved state blocks competing mutations and exposes recovery guidance.

## 6. Save and activate supported settings correctly

- [ ] 6.1 Add configuration classification and optimistic atomic writes. **4h**
      Requirements: R6.AC1–AC2, R6.AC5–AC6, R10.AC2.
      Components: C6 Configuration activation.
      Done when: existing validation/env-file logic supports authoritative paths, private atomic replacement, unrelated-entry preservation and stale-revision detection. No-op saves do not require restart. Every dashboard field has a runtime/restart/build/unsupported classification; the initial apply allowlist and exclusions are explicit.

- [ ] 6.2 Route supported saves through the authoritative controller. **4h**
      Requirements: R1.AC3, R6.AC2–AC6.
      Components: C6 Configuration activation, C5 Managed controller, C7 Dev supervisor.
      Done when: managed saves reach the host deployment config through the operator, dev saves reach the supervisor-owned file, and neither writes an assumed app-local `.env`. Save-versus-restart races serialize correctly; a revision changed after confirmation is rejected before stop.

- [ ] 6.3 Verify runtime mappings, effective values and deletions. **3h**
      Requirements: R5.AC4, R6.AC3–AC6, R7.AC2.
      Components: C6 Configuration activation, C4 Boot observer.
      Done when: supported registration/admin settings map through the runtime entrypoint and dev launch path with documented alias/override precedence; setting removal uses the expected default. A deliberately conflicting external override produces verification failure and preserved saved/current state, not a success toast.

## 7. Expose guarded lifecycle APIs and application preparation

- [ ] 7.1 Implement capabilities/status reads and validated restart submission. **4h**
      Requirements: R1.AC1–AC4, R2.AC1–AC3, R8.AC2.
      Components: C2 Admin lifecycle API, C1 Lifecycle adapters.
      Done when: deployment-super-admin, SSR, host, same-origin intent, no-store and bounded rate-limit behavior are proven on all relevant routes. Accepted responses are durable 202s; identical replays reconcile, mismatched IDs/conflicts fail, and no operator details/secrets leak.

- [ ] 7.2 Connect durable acceptance to preparation and prepared receipts. **4h**
      Requirements: R2.AC1–AC4, R3.AC1–AC4, R4.AC2, R5.AC4.
      Components: C2 Admin lifecycle API, C3 Drain coordinator, C4 Boot observer.
      Done when: browser disconnection does not cancel accepted preparation; lost controller acknowledgement is reconciled with the same ID; missing preparation expires without stop. Controllers revalidate boot, lease, target revision and receipt before replacement; cancellation and admission restoration cannot race an authorized stop.

- [ ] 7.3 Finish retiring rebuild execution and legacy capability flags. **2h**
      Requirements: R1.AC1, R10.AC1–AC3, R12.AC4.
      Components: C2 Admin lifecycle API, C1 Lifecycle adapters.
      Done when: the legacy endpoint returns typed non-executing guidance, no command string crosses the protocol, existing callers receive compatible actionable errors, and source/managed modes point to their supported build/update documentation. Static imports remain clean.

## 8. Make every admin restart surface consistent

- [ ] 8.1 Implement shared restart observation and cross-tab reconciliation. **4h**
      Requirements: R8.AC1–AC5, R2.AC2.
      Components: C8 Restart UI.
      Done when: the existing composable owns shared phases, pending identity, bounded jittered polling and reauthentication recovery. Two tabs, lost POST response and browser reload observe one operation without automatically creating a new request ID or replaying a mutation after login.

- [ ] 8.2 Integrate Operations, Registration and Themes. **3h**
      Requirements: R1.AC1, R6.AC1, R6.AC5–AC6, R8.AC1, R8.AC4, R10.AC2.
      Components: C8 Restart UI, C6 Configuration activation.
      Done when: all callers use shared capability/progress state and existing Nuxt UI variants, conflict buttons stay disabled, and confirmation clearly distinguishes ordinary restart from activating a saved revision. Registration's saved/current state clears only after effective verification; user edits already in these files are preserved.

- [ ] 8.3 Verify interruption, failure and successful recovery UX. **3h**
      Requirements: R8.AC2–AC5, R11.AC4, R12.AC3.
      Components: C8 Restart UI, C10 Qualification evidence.
      Done when: dashboard E2E artifacts show wait blockers, outage/reconnect, verified success, startup/config mismatch, observation expiry and reauth. Route, workspace and unsaved local drafts survive, and affected server data refreshes without a forced full-page reload.

## 9. Preserve client work through the outage

- [ ] 9.1 Qualify existing sync maintenance behavior without duplicating it. **3h**
      Requirements: R9.AC1–AC4.
      Components: C9 Client continuity.
      Done when: real server deferrals/disconnects preserve outbox IDs, attempts, cursors and originating workspace; reconnect is bounded/jittered and idempotent. Fix only missing behavior; genuine auth/validation failures remain distinct from maintenance.

- [ ] 9.2 Defer storage maintenance and resume expired transfers safely. **4h**
      Requirements: R9.AC1–AC4.
      Components: C9 Client continuity.
      Done when: announced maintenance does not spend permanent-failure attempts, pending bytes survive, and expired presigned URLs are renewed for the existing transfer. Upload/commit fault injection proves exactly one committed reference with the expected checksum after recovery, including a workspace switch.

- [ ] 9.3 Verify stream/job reattachment and tool outcome safety. **4h**
      Requirements: R4.AC1–AC5, R9.AC2–AC4, R12.AC2–AC3.
      Components: C9 Client continuity, C3 Drain coordinator, C10 Qualification evidence.
      Done when: deterministic local model/tool fixtures prove existing job-ID/offset recovery, preserved partial foreground output, no automatic duplicate paid generation, and no repeated uncertain tool effect. Memory jobs wait/cancel; unqualified workflows/tools cannot be force-interrupted. Recovery stays bound to the originating workspace.

## 10. Qualify safety, performance and documentation

- [ ] 10.1 Run the complete isolated functional/failure matrix. **4h**
      Requirements: R1–R10, R12.AC1–AC3.
      Components: C10 Qualification evidence.
      Done when: the named harness passes dev and managed fixtures with real dashboard requests, two tabs, duplicate/conflicting IDs, lost acknowledgement, stale config, active work, failed startup, old boot, operator crash and two consecutive restarts. Data/checksum/tool-receipt and owned-process cleanup artifacts are retained and redacted.

- [ ] 10.2 Measure phase latency and warm restart distributions. **3h**
      Requirements: R11.AC1–AC4.
      Components: C10 Qualification evidence, C5 Managed controller, C7 Dev supervisor.
      Done when: at least 20 managed and 10 dev runs report warm idle outage p50/p95/max and separate preparation costs, with runner/runtime/image identity and probe resolution. The initial 10 s / 60 s p95 targets pass or a specific measured bottleneck is fixed and remeasured; no safety timeout is shortened to manufacture a pass.

- [ ] 10.3 Run affected compatibility and build qualification. **3h**
      Requirements: R1.AC4, R7.AC2–AC3, R12.AC4.
      Components: C10 Qualification evidence.
      Done when: affected focused/script/package suites, type checking, supported static/SSR build paths and legacy operator protocol tests pass. Run the appropriate broader cross-cutting gate once at qualification; rebuild changed provider packages and run their relevant conformance lane. Record exact commands/results and distinguish any environmental blocker from a pass.

- [ ] 10.4 Update public documentation and remove stale operational claims. **3h**
      Requirements: R12.AC5, R10.AC2.
      Components: C10 Qualification evidence.
      Done when: development setup, admin/auth, environment, operations, background execution and sync/storage docs describe the implemented capability, wait/cancel semantics, verified settings activation and recovery; docmap references resolve. Keep deployment procedures in `docs/cloud-updates.md`. Reconcile deprecated automatic-rollback/restart claims where found, and update relevant OR3 Cloud findings/architecture/implementation-plan documents only when their scope actually changes.

- [ ] 10.5 Complete the acceptance review and handoff evidence. **2h**
      Requirements: R1–R12.
      Components: C10 Qualification evidence.
      Done when: every acceptance criterion links to implementation and a result; unsupported environments and conditional handoff capabilities are explicit; remaining failures block enabling that capability. Check off only completed work, retain reproducible artifacts, and describe changed behavior and measured limitations without claiming zero downtime or automatic tool continuity.

## Traceability Matrix

| Requirement | Design components | Tasks |
| --- | --- | --- |
| R1 Truthful availability and authorization | C1 Lifecycle adapters, C2 Admin lifecycle API, C6 Configuration activation, C7 Dev supervisor, C8 Restart UI | 2.1, 4.2, 5.1, 6.2, 7.1, 7.3, 8.2, 10.1, 10.3 |
| R2 Durable operation identity | C1 Lifecycle adapters, C2 Admin lifecycle API, C5 Managed controller, C7 Dev supervisor | 2.1, 2.2, 4.2, 5.2, 5.4, 7.1, 7.2, 8.1 |
| R3 Bounded coordinated shutdown | C3 Drain coordinator, C4 Boot observer | 1.1, 1.3, 2.3, 3.1, 3.2, 3.5, 7.2 |
| R4 Background/tool safety | C3 Drain coordinator | 1.1, 3.1, 3.3, 3.4, 7.2, 9.3 |
| R5 Managed lifecycle integrity | C1 Lifecycle adapters, C4 Boot observer, C5 Managed controller | 1.5, 2.3, 5.1, 5.2, 5.3, 5.4, 6.3, 7.2 |
| R6 Correct configuration activation | C4 Boot observer, C5 Managed controller, C6 Configuration activation, C7 Dev supervisor, C8 Restart UI | 1.1, 1.4, 1.5, 2.3, 4.1, 5.3, 6.1, 6.2, 6.3, 8.2 |
| R7 Functional development restart | C1 Lifecycle adapters, C6 Configuration activation, C7 Dev supervisor | 1.1, 1.3, 1.4, 4.1, 4.2, 4.3, 4.4, 6.3, 10.3 |
| R8 Shared restart experience | C2 Admin lifecycle API, C8 Restart UI | 4.4, 7.1, 8.1, 8.2, 8.3 |
| R9 Client continuity | C9 Client continuity | 3.2, 9.1, 9.2, 9.3 |
| R10 Safe rebuild boundary | C1 Lifecycle adapters, C2 Admin lifecycle API, C6 Configuration activation, C8 Restart UI | 1.1, 1.5, 2.1, 3.5, 5.3, 6.1, 7.3, 8.2, 10.4 |
| R11 Performance and diagnostics | C4 Boot observer, C5 Managed controller, C7 Dev supervisor, C10 Qualification evidence | 2.2, 2.3, 3.1, 4.3, 5.2, 5.4, 8.3, 10.2 |
| R12 Qualification and compatibility | C10 Qualification evidence | 1.1–1.5, 3.4, 4.1, 5.1, 7.3, 8.3, 9.3, 10.1–10.5 |

## Definition of Done

- All unconditional acceptance criteria pass for both supported managed and development fixtures; conditional interruption criteria are enforced by unavailable capabilities until qualified. The traceability matrix has no gaps.
- Standard development commands support repeated dashboard restart with fresh effective configuration, intact HMR/HTTPS and no orphan processes. The managed flow preserves image/data identity and uses the existing operator/lease safeguards.
- Active work is finished or the dashboard operation cancels before termination. No generic force path, live-output rebuild, unbounded lookup, duplicate tool effect, lost local data, or false success remains in a supported path.
- Focused affected tests and appropriate script/package tests are green; named functional/failure E2E and performance modes pass; affected static/SSR, type and compatibility checks are recorded. Final cross-cutting qualification uses the repository's documented lanes, not an indiscriminate broad Playwright run.
- Restart evidence includes phase timings, measured outage distributions, before/after checksums and tool receipts, runtime/build identities, redacted browser artifacts, and verified cleanup. Targets are measured, not inferred from toast timing.
- Public docs and docmap describe shipped behavior, supported modes and recovery. `docs/cloud-updates.md` remains the deployment authority. No publication or live rollout is implied by completing this checklist.
