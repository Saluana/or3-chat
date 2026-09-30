# Implementation Tasks

Checkmarks record completed tasks; unchecked tasks still need their stated qualification. Existing lifecycle work is a dependency to reuse. Paths below are relative to `or3-chat` unless a sibling provider is named.

Delivery order: **1. Status and contracts → 2. Site approval and catalog → 3. Workspace rollout → 4. Guided install and updates → 5. Health and recovery.** Write executable failure scenarios before implementing the behavior they verify. Preserve the user's existing dirty changes and the completion history in prior plans.

## 1. Status and contracts

- [x] 1.1 Capture the current admin journeys and define status scenarios (2h)
      Components: Status Projection, Lifecycle Journey, Health Projection.
      Requirements: R1.AC1–R1.AC4, R8.AC1, R9.AC2.
      Done when: existing admin/marketplace statuses, session/workspace identities, and acquisition stages are mapped to the proposed projection; scenarios cover disabled, unreviewed, setup-blocked, current-active/update-failed, and unobserved runtime states. Identify which existing tests can carry each case before writing production code.

- [x] 1.2 Implement the shared status and action contract (3h)
      Components: Status Projection.
      Requirements: R1.AC1–R1.AC4, R8.AC1, R8.AC3.
      Done when: `lifecycle-view.ts` and existing failure presentation derive status/action from authoritative facts without persisted status duplication; selected/candidate state and browser/site scope remain distinct.

- [x] 1.3 Expose the minimum admin status facts (3h)
      Components: Status Projection, Site Policy, Health Projection.
      Requirements: R1.AC1–R1.AC4, R8.AC2, R9.AC1.
      Done when: existing admin package/list DTOs expose identity, authorized actions and scoped prerequisites without settings/secrets; fields for later policy and rollout work have explicit absent/pending states rather than invented success.

- [x] 1.4 Apply shared status and inline remediation to existing views (3h)
      Components: Status Projection, Lifecycle Journey.
      Requirements: R1.AC1–R1.AC4, R8.AC1–R8.AC4.
      Done when: Admin Plugins and Marketplace Installed use the same meanings, give each unavailable action a reason, preserve focus, and wrap details at 375px and 1440px; targeted UI regressions and one typecheck pass.

Phase 1 exit: operators can identify the current outcome and next action without learning package pointer terminology.

## 2. Site approval and catalog

- [x] 2.1 Define approval migration and bypass scenarios (2h)
      Components: Site Policy, Approved Catalog, Permission Review.
      Requirements: R5.AC1–R5.AC5, R6.AC2–R6.AC3.
      Done when: executable cases cover empty policy, verified installed packages, hidden-package restart, corrupt policy, quarantined release, new unapproved release, direct URLs, direct acquisition/enablement, and workspace-admin restrictions before implementation begins.

- [x] 2.2 Add bounded site policy persistence and migration (4h)
      Components: Site Policy.
      Requirements: R5.AC3–R5.AC5, R6.AC2.
      Done when: versioned per-plugin records use atomic writes/revision checks, migration seeds only verified selected marketplace visibility once, and no migration changes grants or enablement. Hiding an installed plugin survives restart.

- [x] 2.3 Implement the approved dashboard catalog (4h)
      Components: Approved Catalog, Site Policy.
      Requirements: R5.AC1–R5.AC4.
      Done when: local approved display metadata drives post-filter counts/search/pagination; detail and preflight resolve the approved exact version, and missing registry/empty approval states are useful. Tests prove hidden entries cannot reappear through pagination.

- [x] 2.4 Enforce policy at every mutation boundary (4h)
      Components: Approved Catalog, Permission Review, Lifecycle Journey.
      Requirements: R5.AC2–R5.AC5, R6.AC2–R6.AC3.
      Done when: install requests, acquisition starts, and enablement reject missing site approval; admin bypasses require an explicit authorized approval action; paid Library checks and existing workspace authorization remain enforced.

- [x] 2.5 Add the system-admin catalog approval view (3h)
      Components: Approved Catalog, Site Policy, Lifecycle Journey.
      Requirements: R5.AC3–R5.AC5, R8.AC1–R8.AC4.
      Done when: Admin > Plugins can browse the full configured registry, review and approve an exact release, remove it from discovery, and clearly distinguish removal from disabling existing workspaces. Dashboard users see only approved entries.

- [x] 2.6 Qualify the visibility transition (2h)
      Components: Approved Catalog, Site Policy, Lifecycle Journey.
      Requirements: R5.AC1–R5.AC5, R8.AC4.
      Done when: existing marketplace E2E cases verify UI states and real route tests enforce policy/roles; installation migration and direct-link cases pass; the public marketplace documentation/docmap explain site approval versus permission consent.

Phase 2 exit: workspace users see a usable site-approved catalog; administrators retain full discovery and explicit control.

## 3. Workspace rollout

- [x] 3.1 Define rollout failure cases and real-provider harness (3h)
      Components: Rollout Service, Permission Review, Provisioning Integration.
      Requirements: R3.AC1–R3.AC4, R4.AC1–R4.AC5, R6.AC2–R6.AC5.
      Done when: scenarios cover stale preview, concurrent admins, duplicate start, write-before-crash, setup failure, deleted workspace, cancellation, new workspace creation, and 1,000 targets; a disposable harness invokes real routes/provider stores and records an artifact.

- [x] 3.2 Implement preview and durable rollout records (4h)
      Components: Rollout Service, Site Policy.
      Requirements: R3.AC1, R3.AC4, R4.AC1–R4.AC4.
      Done when: preview resolves paginated selection into a deduplicated frozen target set, binds package/policy/precondition revisions and expiry, reports impact counts, and persists bounded records with lease/revision/retention behavior.

- [x] 3.3 Make enablement writes concurrency-safe (3h)
      Components: Rollout Service, Provisioning Integration.
      Requirements: R4.AC3–R4.AC5, R6.AC5.
      Done when: all competing enablement mutation paths use provider-native CAS, retries preserve unrelated plugin entries, and providers without CAS receive the explicit bulk capability error. SQLite/Convex regressions prove conflicting writes cannot silently lose a choice.

- [x] 3.4 Extend permission review to explicit scope (4h)
      Components: Permission Review, Site Policy, Rollout Service.
      Requirements: R6.AC1–R6.AC5.
      Done when: one review binds full verified authority and target snapshot/default decision; server-derived deltas cover more than grant names; applying consent uses existing workspace review records; unchanged/narrower access follows existing comparison rules.

- [x] 3.5 Implement bounded continuation, retry and cancellation (4h)
      Components: Rollout Service, Permission Review.
      Requirements: R3.AC1, R3.AC4, R4.AC2–R4.AC4, R6.AC3, R6.AC5.
      Done when: continuation caps work at 25 outcomes/time budget, provider calls are bounded, uncertain writes reconcile by read-back, successful work is not replayed, failures remain attributable, and cancellation preserves completed results. Duplicate/expired runners cannot mutate concurrently.

- [x] 3.6 Integrate future-workspace defaults and provisioning recovery (4h)
      Components: Provisioning Integration, Site Policy, Rollout Service.
      Requirements: R3.AC2–R3.AC3, R4.AC1, R4.AC4–R4.AC5, R6.AC2–R6.AC4.
      Done when: auth-default, user-created and admin-created workspaces apply only applicable reviewed defaults, setup-needed plugins remain disabled, explicit old choices are preserved, and provisioning failure returns the created workspace with repair context instead of duplicating it on retry.

- [x] 3.7 Build workspace selection, impact review and progress (4h)
      Components: Rollout Service, Lifecycle Journey, Status Projection.
      Requirements: R3.AC1–R3.AC4, R4.AC1–R4.AC5, R8.AC1–R8.AC4.
      Done when: admins can search/paginate selected targets, choose all-existing/new-only/future inclusion, review disabled targets and counts, resume progress, and open only failed/blocked workspaces; cancellation explains whether a future default is already saved.

- [x] 3.8 Run the 1,000-workspace interruption gate (4h)
      Components: Rollout Service, Permission Review, Provisioning Integration.
      Requirements: R3.AC1–R3.AC4, R4.AC3–R4.AC5, R6.AC2–R6.AC5.
      Done when: the real-provider harness accounts for every target after interruption/restart/retry, verifies batch/response bounds, proves CAS and role isolation, and produces a redacted receipt with all failures and observed timings. The UI can resume after its browser closes.

Phase 3 exit: an administrator can approve and enable one release for 1,000 existing workspaces and choose a future default with recoverable, visible results.

## 4. Guided install and updates

- [x] 4.1 Define complete install/update browser journeys (2h)
      Components: Lifecycle Journey, Status Projection, Permission Review.
      Requirements: R2.AC1–R2.AC4, R7.AC1–R7.AC4, R8.AC2.
      Done when: E2E scenarios cover install-time consent/setup, admin-session expiry, switching workspaces, refresh, failed update with current version still active, and return from scoped setup; expected operations are identified before UI implementation.

- [x] 4.2 Consolidate the admin plugin detail and entry points (3h)
      Components: Lifecycle Journey, Status Projection, Approved Catalog.
      Requirements: R1.AC1–R1.AC4, R2.AC1, R7.AC1, R8.AC1–R8.AC4.
      Done when: Catalog/Installed/Updates share one detail and next-action component, advanced source/development controls are separated, and dashboard links retain exact workspace/operation context without granting admin powers from a Chat login.

- [x] 4.3 Connect the install guide to acquisition, setup and rollout (4h)
      Components: Lifecycle Journey, Permission Review, Rollout Service.
      Requirements: R2.AC1–R2.AC4, R3.AC1, R6.AC2–R6.AC3.
      Done when: one guide follows real acquisition prerequisites, stages/downloads once, completes canary/promotion through existing APIs, then enables approved target workspaces through the rollout service. The result distinguishes installation, scoped enablement and runtime observation.

- [x] 4.4 Preserve context through resume and remediation (3h)
      Components: Lifecycle Journey, Status Projection.
      Requirements: R2.AC3–R2.AC4, R8.AC1–R8.AC4.
      Done when: sign-in, refresh, Continue, Retry, Configure and diagnostics restore only authorized operation context; stale inputs fail visibly; no second client state machine or duplicate operation is introduced.

- [x] 4.5 Connect the dedicated update review (4h)
      Components: Lifecycle Journey, Permission Review, Site Policy, Rollback Coordinator.
      Requirements: R6.AC1, R6.AC4, R7.AC1–R7.AC4.
      Done when: current/proposed versions and all-enabled-workspace impact are explicit, access/setup changes drive the existing gates, blocked workspace setup prevents promotion, and future policies advance only under valid approval. Existing disabled workspaces stay disabled.

- [x] 4.6 Qualify guide recovery and accessibility (3h)
      Components: Lifecycle Journey, Status Projection, Permission Review, Rollout Service.
      Requirements: R1.AC1–R1.AC4, R2.AC1–R2.AC4, R7.AC1–R7.AC4, R8.AC1–R8.AC4.
      Done when: targeted route/browser journeys pass at desktop/mobile widths, keyboard focus survives all transitions, long errors stay contained, and reload/session recovery continues the same operation. Capture screenshots and update the install/update guide.

Phase 4 exit: installation and updates each have one discoverable guided journey with a clear next action and no manual hopping between unrelated admin screens.

## 5. Health and recovery

- [x] 5.1 Define health and rollback failure scenarios (2h)
      Components: Health Projection, Rollback Coordinator, Status Projection.
      Requirements: R9.AC1–R9.AC4, R10.AC1–R10.AC4.
      Done when: scenarios cover mismatched digest, unopened workspace, timeout, missing required/optional contribution, quarantined previous release, incompatible state in another workspace, changed enabled set, and failures before/after pointer commit.

- [x] 5.2 Expose scoped health checks and retry (4h)
      Components: Health Projection, Status Projection, Lifecycle Journey.
      Requirements: R1.AC3, R9.AC1–R9.AC4, R8.AC1–R8.AC3.
      Done when: existing server checks and exact portable/trusted browser observations produce a readable result with scope/time, 30-second timeout is honest, retries do not reinstall, and check execution cannot invoke paid models or user workflows.

- [x] 5.3 Extend rollback preflight to every affected workspace (4h)
      Components: Rollback Coordinator, Permission Review.
      Requirements: R10.AC1–R10.AC4, R7.AC1–R7.AC2.
      Done when: rollback validates expected current/previous digests and revisions, checks all live enabled workspaces through existing trust/setup/state rules, and rejects stale evidence at commit. Failure cannot silently substitute the admin's selected workspace for the full impact set.

- [x] 5.4 Add Restore previous version and truthful recovery status (3h)
      Components: Rollback Coordinator, Lifecycle Journey, Health Projection.
      Requirements: R10.AC1–R10.AC4, R8.AC1–R8.AC4, R9.AC2.
      Done when: a single entry point opens an exact impact review, unsupported recovery has a reason, success preserves data/enablement and reconciles runtimes, and partial failure reports the actual selected version. Previously completed rollout records are not rewritten as if rollback reversed workspace choices.

- [x] 5.5 Run the actual-plugin Chrome smoke (4h)
      Components: Lifecycle Journey, Health Projection, Rollback Coordinator, Approved Catalog.
      Requirements: R2.AC1–R2.AC4, R5.AC1–R5.AC3, R7.AC1–R7.AC4, R9.AC1–R9.AC4, R10.AC1–R10.AC4.
      Done when: disposable Workflows and portable-plugin journeys prove import, `/` selection, simple execution, refresh persistence, update and compatible rollback through the UI; screenshot/receipt evidence identifies versions, digests, workspaces and checked behavior. Model execution is separately labeled if tested.

- [x] 5.6 Qualify provider and security boundaries (4h)
      Components: Site Policy, Approved Catalog, Permission Review, Rollout Service, Provisioning Integration, Rollback Coordinator.
      Requirements: R3.AC1–R3.AC4, R4.AC3–R4.AC5, R5.AC2–R5.AC5, R6.AC2–R6.AC5, R10.AC2–R10.AC4.
      Done when: SQLite and disposable Convex paths pass affected persistence/CAS cases; unauthorized direct routes, hidden releases, forged authority, stale revisions, and paid entitlement bypasses are rejected; static/unsupported profiles show accurate availability without importing server-only code.

- [x] 5.7 Finish administrator docs and provider notes (2h)
      Components: Lifecycle Journey, Site Policy, Rollout Service, Health Projection, Rollback Coordinator.
      Requirements: R1–R10.
      Done when: `public/_documentation/plugins/marketplace.md`, relevant runtime/admin guides and `docmap.json` explain approval, shared version impact, scope, future defaults, pause/resume, health limits and rollback. Provider READMEs document any new CAS expectations; no unsupported commands or production rollout steps are invented.

- [x] 5.8 Inspect the final diff and record qualification (3h)
      Components: Status Projection, Site Policy, Approved Catalog, Permission Review, Rollout Service, Provisioning Integration, Lifecycle Journey, Health Projection, Rollback Coordinator.
      Requirements: R1–R10.
      Done when: the final diff preserves unrelated work, removes superseded duplicated UI/logic, required targeted suites/typecheck/build and the named E2E harness pass, all criteria have evidence, and remaining pre-existing failures are explicitly distinguished. Check off tasks only after their completion conditions pass.

Phase 5 exit: administrators can verify a plugin's actual readiness and safely restore a compatible previous version, with complete reproducible evidence for all ten improvements.

## Traceability Matrix

| Requirement / original suggestion | Design components | Tasks |
| --- | --- | --- |
| R1 — Clear status | Status Projection, Health Projection, Lifecycle Journey | 1.1–1.4, 4.2, 4.6, 5.2, 5.7–5.8 |
| R2 — Guided install | Lifecycle Journey, Permission Review, Rollout Service | 4.1, 4.3–4.4, 4.6, 5.5, 5.7–5.8 |
| R3 — Site-wide enablement | Rollout Service, Site Policy, Provisioning Integration | 3.1–3.2, 3.5–3.8, 4.3, 5.6–5.8 |
| R4 — Workspace scope | Rollout Service, Provisioning Integration, Lifecycle Journey | 3.1–3.3, 3.5–3.8, 5.6–5.8 |
| R5 — Approved catalog | Approved Catalog, Site Policy, Lifecycle Journey | 2.1–2.6, 5.5–5.8 |
| R6 — Scoped permission review | Permission Review, Site Policy, Rollout Service | 2.1–2.2, 2.4, 3.1, 3.3–3.6, 3.8, 4.3, 4.5, 5.6–5.8 |
| R7 — Separate updates | Lifecycle Journey, Permission Review, Site Policy, Rollback Coordinator | 4.1–4.2, 4.5–4.6, 5.3, 5.5, 5.7–5.8 |
| R8 — Actionable blocks | Status Projection, Lifecycle Journey | 1.1–1.4, 2.5–2.6, 3.7, 4.2, 4.4, 4.6, 5.2, 5.4, 5.7–5.8 |
| R9 — Health check | Health Projection, Status Projection, Lifecycle Journey | 1.1, 1.3, 5.1–5.2, 5.4–5.5, 5.7–5.8 |
| R10 — Safe rollback | Rollback Coordinator, Permission Review, Health Projection | 5.1, 5.3–5.8 |

## Definition of Done

- All R1–R10 acceptance criteria have reproducible evidence and no traceability gaps.
- Administrators can complete the install, approval, 1,000-workspace enablement, future default, update and rollback journeys from the documented UI.
- Backend policy and authorization remain enforced when the UI is bypassed; existing grants, user data and unrelated workspace choices are preserved.
- Runtime confirmation is scoped and honest; a successful simple workflow smoke is never represented as verification of every AI/model path.
- Targeted tests, one final typecheck, the connected build, and the named disposable E2E/provider qualifications are green; final diff/whitespace checks pass.
- Administrator documentation and provider notes match shipped behavior; proof artifacts contain no credentials or private workspace content.
- Implementation does not publish packages, mutate production, reset prior planning checklists, or mark incomplete tasks finished merely to close a phase.
