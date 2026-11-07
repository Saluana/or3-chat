# Implementation tasks

Read [requirements](requirements.md) and [design](design.md) first. The [six mockups](requirements.md#assumptions) are saved in `assets/mockups/`; they guide layout, not product facts. Checked tasks have implementation and verification evidence in progress.md. Unchecked tasks still require their stated qualification.

Each task is a roughly 1–4 hour work slice. If investigation shows a task exceeds that size, split it at its named component boundary before coding. Do not collapse provider safety qualification into one vague “add GC” task. Tests for a slice are authored before its production changes, with a short failure inventory; subsequent validation tasks run those tests rather than writing retrospective unit tests.

Stages A–C deliver the dashboard functionality. D delivers safely qualified file reclamation and later automation. E delivers offer-version safety before any price editor/change. Neither D nor E is enabled by merely shipping A–C. Release/publication and live operational execution are separate from completing these tasks.

## 1. Baseline and first-stage verification contract — A

- [x] 1.1 Record the current SHA, uncommitted billing/trial changes, provider versions and existing behavior; confirm the plan's evidence links still match the implementation baseline. (1h)
      Components: C2, C3, C4, C11. Requirements: R2, R4, R6, R16.
      Done when: a short baseline receipt identifies current trial/reservation semantics and unrelated changes; no user changes are reverted or stashed.
- [x] 1.2 Extend the canonical admin/hosted E2E fixture before implementation with never-started, paid, review-held, expired, denied-trial and ordinary-member accounts; record privacy/provisioning failure cases. (3h)
      Components: C2, C3, C11. Requirements: R2, R3, R4, R16.
      Done when: the future inspector route is expected to preserve all DB counts/deadlines and deny workspace-admin access; failing behavior is observed for the intended missing feature.
- [x] 1.3 Define review-command race/retry and atomic-audit cases in the existing billing boundary suite, plus core journal crash cases, before schema/service changes. (3h)
      Components: C3, C8, C11. Requirements: R5, R13, R16.
      Done when: fixtures cover two admins, new review during refresh, lease loss, duplicate command, delayed identical risk event and audit failure without copying production logic.

## 2. Read-only account and review foundations — A

- [x] 2.1 Add additive billing migrations for state revision, review records, command audit and last reconciliation metadata; backfill legacy holds with an unknown reason. (3h)
      Components: C3, C8. Requirements: R5, R9, R13, R16.
      Done when: fresh and existing disposable databases migrate twice safely, retain all payment/trial/eligibility facts, and legacy holds remain blocked.
- [x] 2.2 Add SELECT-only billing lookup and extract effective access evaluation from the existing status implementation. (3h)
      Components: C3, C5. Requirements: R2, R4.
      Done when: inspection of an absent account writes nothing; user trial-claim behavior remains at its current authenticated boundary; existing access cases still pass.
- [x] 2.3 Add bounded canonical customer reads by internal ID/list/batch and owned/member workspace inspection to the existing SQLite admin store contract. (4h)
      Components: C2. Requirements: R2, R3.
      Done when: canonical IDs resolve without provisioning, retained deleted owned workspaces remain visible, pagination is stable and unsupported providers declare the capability unavailable.
- [x] 2.4 Add guarded customer inspection/list routes with explicit target IDs, bounded query validation, no-store and independent section errors. (3h)
      Components: C2, C3. Requirements: R2, R3.
      Done when: super-admin-cookie-only reads avoid session side effects; a failed billing section does not erase canonical identity; unauthorized probes return no metadata.
- [x] 2.5 Implement bounded billing-state candidate paging and batch canonical enrichment for paid/trial/attention filters. (3h)
      Components: C2, C3. Requirements: R3, R9.
      Done when: matches beyond page one are returned, unknown canonical identities are not fabricated, and counts state their population/coverage.
- [x] 2.6 Add the small private core audit journal primitive before B uses it: locked durable intent/result, redacted fields and operation identity. (3h)
      Components: C8. Requirements: R13.
      Done when: concurrent appends are intact, a crash leaves an incomplete intent, and upcoming workspace/quota/pause writers have a real audit owner without a new service or database.

## 3. Reconciliation and audited review actions — A

- [x] 3.1 Route all existing risk/conflicting-subscription paths through durable review identities and the account state revision. (3h)
      Components: C3, C8. Requirements: R4, R5, R9.
      Done when: the hold projection and open reviews remain consistent, and identical old risk events cannot silently reopen an explicitly resolved review.
- [x] 3.2 Add targeted admin refresh using the existing BillingService reconciliation, account lease and redacted outcome record. (2h)
      Components: C3, C8. Requirements: R2, R5, R9.
      Done when: no automatic refresh occurs on GET, Stripe failure preserves facts/hold, and no-customer accounts produce an explicit harmless result.
- [x] 3.3 Add review resolution with current review-set revision, mandatory reason, successful-refresh prerequisite and atomic state/audit commit. (4h)
      Components: C3, C8. Requirements: R5, R13.
      Done when: concurrent risk or conflicting subscriptions refuse stale resolution; resolving a hold recomputes access without changing paid dates; repeat operation IDs return the original outcome.

## 4. Customer UI and first useful delivery — A

- [x] 4.1 Add Customers navigation and directory using mockup 01, existing admin components and actual supported fields/filters. (3h)
      Components: C1, C2. Requirements: R1, R3.
      Done when: search, pagination, detail links, empty/error states and supported status filters work without adding a new navigation registry.
- [x] 4.2 Add the account page using mockup 02: canonical identity, ownership/memberships, payment/access separation, deadlines and plain-language blocking reasons. (4h)
      Components: C1, C2, C3, C5. Requirements: R1, R3, R4.
      Done when: every fixture state is explained accurately and absent billing data says Cloud not started; no private workspace content is requested.
- [x] 4.3 Add explicit refresh/review dialogs and account action history, including revision conflicts, pending state and operation-ID retry recovery. (3h)
      Components: C1, C3, C8. Requirements: R1, R5, R13.
      Done when: the administrator can safely refresh and resolve a legitimate hold through the UI, and a timeout cannot cause a duplicate successful decision.
- [x] 4.4 Run A's E2E/security/race cases and billing/core typechecks; capture desktop/mobile/light/dark proof and update hosted-billing/admin documentation. (3h)
      Components: C11. Requirements: R1–R5, R13, R16.
      Done when: the inspector does not provision anything, review concurrency passes, docs/docmap and affected provider README are updated, and the stage receipt names all evidence.

## 5. Storage accounting and policy UI — B

- [x] 5.1 Write B's quota/refused-upload failure cases in the existing quota/E2E fixtures before implementation. (3h)
      Components: C4, C11. Requirements: R4, R6, R16.
      Done when: cases cover active/expired reservations, same-hash retries, retained deleted workspaces, shared ownership, smaller workspace caps, over-limit reduction and unknown accounting.
- [x] 5.2 Extend the existing quota query to return one-snapshot account/workspace totals and active/deleted-retained/unclassified/reservation breakdowns. (4h)
      Components: C4. Requirements: R4, R6.
      Done when: sum of charged components matches actual admission for the fixture; no second formula or expiry-only release exists.
- [x] 5.3 Add a constraint explanation at the existing upload policy boundary with distinct safe reason codes for entitlement, permission, account cap, workspace cap, size and type. (3h)
      Components: C4, C5. Requirements: R4, R6.
      Done when: a hypothetical upload preview and actual refused upload identify the same controlling constraint without using the preview as authorization.
- [x] 5.4 Add revisioned global/account/workspace quota impact preview, including aggregate count and bounded examples. (3h)
      Components: C4, C8. Requirements: R6, R13.
      Done when: stale policy revisions are rejected, measurement time is shown, and lowering a limit never deletes data or denies permitted downloads.
- [x] 5.5 Build the Storage page from mockup 03 and the account storage section, with provider-usage drill-down and explicit freshness/completeness. (4h)
      Components: C1, C4. Requirements: R1, R6.
      Done when: active/retained/reserved/physical quantities are distinguishable, shared-owner charging is clear, and initial load performs no physical scan.
- [x] 5.6 Expose existing file-size/type/cap controls where actual writers support them; add capacity-threshold controls and explicit bounded usage refresh. (3h)
      Components: C1, C4, C6. Requirements: R6, R11.
      Done when: each editable value changes the owning enforcement path, unknown physical capacity stays unknown, and retained bytes cannot be “reset.”

## 6. Targeted support exceptions — B

- [x] 6.1 Author support expiry/revocation/review precedence and trial-denial cases before changing schemas/evaluation. (3h)
      Components: C3, C5, C11. Requirements: R4, R7, R16.
      Done when: the test inventory covers expiry during an open session, free recovery paths, paid-account trial refusal, bonus without entitlement and an unchanged original eligibility decision.
- [x] 6.2 Add the concrete billing support row and revisioned command persistence, with actor/reason audit in the same transaction. (3h)
      Components: C3, C8. Requirements: R7, R13.
      Done when: support fields do not overwrite Stripe/trial facts; permanent versus inactive pauses are unambiguous; duplicate requests are idempotent.
- [x] 6.3 Implement grant/revoke and trial extension/denial override in the shared evaluator and account actions. (3h)
      Components: C3, C5. Requirements: R4, R7.
      Done when: grants require expiry and explicit storage, trial history is preserved, and reviews/suspensions always win.
- [x] 6.4 Implement additional account storage and hosted pause/resume with optional expiry and atomic audit. (3h)
      Components: C3, C4, C5, C8. Requirements: R4, R7, R13.
      Done when: quota uses base plus active bonus, bonus alone never grants access, and pause leaves recovery/download/export/foreground BYOK usable.
- [x] 6.5 Add account action dialogs, live effective-state feedback and linked support history. (3h)
      Components: C1, C3, C8. Requirements: R1, R7, R13.
      Done when: actor, reason, expiry, scope and predicted effect are reviewable before confirmation and actual after-state is read back.
- [x] 6.6 Update customer BillingStatus/UI, session access deadline, job capabilities and sync consumers for grant/support-trial states. (3h)
      Components: C1, C3, C5. Requirements: R4, R7.
      Done when: customer and admin views agree on source/deadline, grant expiry pauses transport, and complimentary access is never represented as a paid capability or payment.

## 7. Operational pauses and storage/support qualification — B

- [x] 7.1 Author admission-pause E2E cases before integration: new versus already admitted uploads/jobs, signup/invite acceptance, checkout and existing sessions. (3h)
      Components: C5, C11. Requirements: R4, R8, R16.
      Done when: tests protect completion/abort/recovery routes and do not assume externally issued URLs/sessions can be revoked.
- [x] 7.2 Implement the revisioned private deployment-pause file and concrete account upload/background controls with audit, expiry and corrupt-file behavior. (3h)
      Components: C5, C8. Requirements: R8, R13.
      Done when: existing atomic file/lock patterns are reused; expiry needs no scheduler; inability to read policy does not implicitly resume new admissions.
- [x] 7.3 Enforce pauses at upload/job admission and wire status/retry messages to relevant clients. (3h)
      Components: C4, C5. Requirements: R4, R8.
      Done when: new work is refused for the correct reason, while existing reservation commits and admitted jobs retain their normal rules.
- [x] 7.4 Enforce registration/checkout pauses at their owning boundaries and add explicit controls in existing registration/billing/system UI. (3h)
      Components: C1, C3, C5. Requirements: R8, R11.
      Done when: sign-in/portal/webhooks remain usable, signup modes still apply after resume, and UI explains existing Stripe sessions.
- [x] 7.5 Run B's quota stress, support/pause E2E and relevant typechecks; document allowance semantics, shared-workspace behavior and remedies. (4h)
      Components: C11. Requirements: R4, R6–R8, R13, R16.
      Done when: race/admission receipts and UI screenshots pass, docs/docmap/provider READMEs match behavior, and no physical reclamation is enabled.

## 8. Billing health and observed sync diagnostics — C

- [x] 8.1 Author bounded outcome/diagnostic failure cases before adding observation persistence. (2h)
      Components: C3, C7, C8, C11. Requirements: R4, R9, R16.
      Done when: invalid signatures, processing failure, duplicate delivery, expired diagnostic retention, missing observation and observer-write failure have distinct expected outcomes.
- [x] 8.2 Add processing-outcome persistence/pruning and instrument verified webhook/refresh completion without changing successful-event dedup semantics. (3h)
      Components: C3, C8. Requirements: R9, R13.
      Done when: failed processing remains retryable, payment failure is distinct from handler failure, and records contain no raw payloads/secrets.
- [x] 8.3 Add integration health reads and explicit price-check refresh with environment, offer, validation time, counts and unresolved reviews. (3h)
      Components: C3, C7. Requirements: R9.
      Done when: page load never reconciles all subscribers or calls Stripe automatically, and price-check errors are visible with their timestamp.
- [x] 8.4 Build hosted-billing tabs from mockup 04 while retaining allowance controls and customer detail links. (3h)
      Components: C1, C3, C7. Requirements: R1, R5, R9.
      Done when: review queue, processing outcomes and offer health are usable; the fixed price is informational and storage is account-wide.
- [x] 8.5 Implement canonical sync observation reads and minimal last-success/latest-failure persistence only where existing cursor data is insufficient. (4h)
      Components: C2, C7. Requirements: R3, R4.
      Done when: the account screen distinguishes contact from completed server sync, never claims to know offline edits, and diagnostics failure cannot invalidate a committed sync operation.

## 9. Effective configuration and existing resource policy — C

- [x] 9.1 Author configuration-source/pending/enforced-policy cases and non-billing/static exclusion checks before changing projections. (2h)
      Components: C6, C11. Requirements: R10, R11, R16.
      Done when: fixtures cover unset environment defaults, saved site values, pending restart, unavailable controller, locked hosted BYOK and disabled sync with canonical backend still required.
- [x] 9.2 Extend configuration projection with effective value, source, pending revision and accurate application/editability classification. (4h)
      Components: C6. Requirements: R10.
      Done when: values come from actual owners, secrets remain redacted, provider migration is not presented as a normal toggle, and unsupported writes are rejected server-side.
- [x] 9.3 Build the Advanced Settings update from mockup 06, with deployment summary and links to the existing apply/restart workflow. (3h)
      Components: C1, C6. Requirements: R1, R10.
      Done when: mockup-only provider claims are removed, enforced properties are locked, and a saved change cannot appear applied before its real application boundary.
- [x] 9.4 Group AI funding, background concurrency/timeouts, rate groups, model/features/plugins and registration controls using existing metadata and owning forms. (3h)
      Components: C1, C5, C6. Requirements: R10, R11.
      Done when: every displayed control identifies its actual source/consumer; require-user-key differs from allow-overrides, and unsupported editors remain disabled with a supported path.
- [x] 9.5 Qualify any newly exposed resource-setting writer individually and document its enforcement/application semantics. (3h)
      Components: C5, C6, C11. Requirements: R10, R11, R16.
      Done when: only verified writers are enabled, concurrency/limits take effect at the documented boundary, and no duplicate flag or broad raw-env editor is introduced.

## 10. Overview, recovery coverage and shared activity — C

- [x] 10.1 Write health/backup/audit interruption scenarios before implementing the aggregate views and journal. (3h)
      Components: C7, C8, C11. Requirements: R12, R13, R16.
      Done when: cases cover partial provider failure, stale checks, running app with invalid backup, missing billing/key coverage, unavailable operator and mutation crash between audit intent/outcome.
- [x] 10.2 Extend provider status with structured check result/time/scope and bounded refresh; expose actual background recovery observations. (3h)
      Components: C7. Requirements: R4, R12.
      Done when: enabled and healthy are independent, stale/unknown are explicit, and a failing provider does not erase other checks.
- [x] 10.3 Add read-only backup/recovery receipt projection through existing operator/status boundaries, including coverage and incomplete operations. (4h)
      Components: C7. Requirements: R12.
      Done when: no new Docker/shell access reaches the web process; billing/trial/support state and credential escrow are separately evidenced or unknown; source deployments get truthful unsupported/manual guidance.
- [x] 10.4 Build Overview from mockup 05 using local attention queries and bounded summaries. (3h)
      Components: C1, C4, C7. Requirements: R1, R9, R12.
      Done when: each attention item links to an actionable existing view, counts disclose scope, and opening Overview does no bucket scan or global Stripe reconciliation.
- [x] 10.5 Extend the journal from 2.6 with bounded filtered reads and incomplete-operation lookup for the shared history. (3h)
      Components: C8. Requirements: R13.
      Done when: reads remain bounded as history grows, incomplete records resolve against authoritative owner state, and readers cannot receive sensitive before/after values.
- [x] 10.6 Instrument existing workspace delete/restore and plugin-permission operations at their owners; retain their current authorization and idempotency. (3h)
      Components: C8. Requirements: R2, R13.
      Done when: before/after actor/target/outcome records exist without changing workspace access semantics or silently replaying a partial operation.
- [x] 10.7 Instrument configuration save/application and pause actions; merge existing deployment-operation receipts rather than duplicating privileged execution. (3h)
      Components: C6, C8. Requirements: R8, R10, R13.
      Done when: saved versus applied changes are distinct, operator records preserve their source identity, and missing sources remain explicit.
- [x] 10.8 Add searchable Activity and account-filtered history with per-source bounded cursors. (3h)
      Components: C1, C8. Requirements: R1, R13.
      Done when: actor/target/action/time filters work across supported sources and historical coverage/incomplete operations are visible.
- [x] 10.9 Run C's E2E/config/health/history checks, typechecks and bounded-directory qualification; finish docs/docmap and saved screenshots of all six implemented screens. (4h)
      Components: C11. Requirements: R1–R13, R16.
      Done when: the six-screen receipt passes with no invented health, implicit Stripe calls or physical scans, and any performance change is supported by query-plan evidence.

## 11. Safe provider reclamation, then automation — D

Start after B accounting is stable. A–C may already ship. Keep destructive controls unavailable until the exact provider pairing has passed the entire gate below.

- [x] 11.1 Inventory existing generation guards and all canonical write/upload/restore paths; write a deletion failure matrix and eligible/legacy scope definition. (4h)
      Components: C9, C11. Requirements: R6, R14, R16.
      Done when: every path that could restore a reference or publish bytes is named; mutable legacy keys and uncertain references are excluded, not guessed safe.
- [x] 11.2 Extend existing disposable provider lifecycle coverage before code with claim/delete/complete crashes, delayed publication, active/expired intents and repeated cleanup. (4h)
      Components: C9, C11. Requirements: R14, R16.
      Done when: receipts independently verify object hashes/existence and canonical charges, including failing controls for live references and stale claims.
- [x] 11.3 Add bounded dry-run candidate inspection with explicit blocked reasons and exact generation identities. (3h)
      Components: C4, C9. Requirements: R6, R14.
      Done when: repeated dry runs change neither bytes nor accounting, incomplete scans are labeled, and caller-supplied storage paths cannot authorize deletion.
- [x] 11.4 Complete canonical claim/publication/reference barriers using the existing coordinator and migration mechanism. (4h)
      Components: C9. Requirements: R14.
      Done when: a claimed generation cannot be republished or gain references through any inventoried path, including restore and racing admissions.
- [x] 11.5 Implement idempotent accounting completion and unresolved-intent reconciliation tied to independently verified deletion proof. (4h)
      Components: C4, C9. Requirements: R6, R14.
      Done when: accounting decreases once only after valid completion, expired intents never release by time alone, and replacement generations charge correctly.
- [x] 11.6 Implement exact filesystem-generation deletion and resumable operation state; keep the capability disabled during development. (4h)
      Components: C9. Requirements: R14.
      Done when: paths/sidecars and symlink/traversal protections are verified; crashes preserve charges/barriers and retries cannot delete a replacement generation.
      Implementation: [x] bounded cleanup composition, durable claim replay and gateway entry point; [x] Linux source-snapshot filesystem and SQLite integration tests; [x] installed physical deletion and process-kill/replay checks. The completed pairing/lifecycle receipts are recorded under 11.7 and 11.12; cleanup remains explicit opt-in.
- [x] 11.7 Qualify SQLite + filesystem with installed artifacts, crash races, backup/restore and admission checks. (4h)
      Components: C9, C11. Requirements: R14, R16.
      Done when: the repeatable lifecycle receipt verifies bytes, hashes, accounting and post-restart usability; only this qualified pairing can advertise cleanup.
      Evidence: installed normal registration, process-kill/replay and admission controls, certified live-generation backup/restore/restart, independent hashes/accounting, sign-in and live-file cleanup refusal pass. Final VPS receipt: `8d975483/REPORT.md`; cumulative evidence is in `reclamation-qualification.md`.
- [x] 11.8 Implement exact S3 generation/version deletion, including multipart/versioning ambiguity and retry behavior. (4h)
      Components: C9. Requirements: R14.
      Done when: bucket/key/version ownership is proven, deletion markers do not masquerade as removal, and unsupported versioning/legacy layouts remain blocked.
- [x] 11.9 Qualify SQLite + S3 with disposable versioned/unversioned fixtures, delayed PUT and lost-response scenarios. (4h)
      Components: C9, C11. Requirements: R14, R16.
      Done when: independent object and accounting receipts pass before this pairing advertises cleanup; filesystem qualification is not reused as proof.
- [x] 11.10 Add destructive preview/confirmation/progress/resume UI only for qualified pairings and record each cleanup action. (3h)
      Components: C1, C8, C9. Requirements: R1, R6, R13, R14.
      Done when: confirmation shows scope and estimated reclaim, execution rechecks eligibility, and failed/partial operations remain recoverable rather than reported as complete.
      Evidence: normal installed registration passed real browser preview, confirmation, execution and reinspection in an isolated workspace; two targets were deleted, the live reference stayed blocked and independent usage fell from 160 to 51 bytes. Authenticated retry completed zero and preserved the live file. VPS receipt `962434f4/REPORT.md` includes screenshots and independent hashes; 11.7 separately records the completed managed-backup acceptance checks.
- [x] 11.11 Add opt-in retained-file retention batches through existing scheduling/operations infrastructure after manual qualification. (4h)
      Components: C5, C8, C9. Requirements: R14.
      Done when: age/scope/batch limits and interruption/resume work through the same primitive, no separate deletion path exists, and expired-account purge stays disabled.
      Evidence: [x] scoped opt-in host scheduler and same audited batch primitive; [x] cursor retry/non-overlap/shutdown tests; [x] Linux physical execution with normal installed registration. Cumulative installed receipts verify 25-generation batches, seven-day eligibility, other-workspace preservation, audit and durable claim recovery (VPS reports `194935e7` and `1845f376`). Timer acceleration was limited to disposable test bundles; production defaults remain unchanged.
- [x] 11.12 Run D's full relevant provider/migration/type/build/lifecycle gate and update provider READMEs, backup/recovery docs and docmap. (4h)
      Components: C11. Requirements: R6, R12, R14, R16.
      Done when: exact installed versions pass disposable update, verified backup, rollback and restart checks; no immutable release version or production data has been used as a test.
      Evidence: exact artifact hashes, Mac type/build checks, Debian migration/registration (24 tests) and Cloud backup/restore (56 tests), and distinct compiled-image update/rollback passed. Ordinary backup/restore is canonically certified. Update safety snapshots are authenticated/checksum-verified prior-state copies, intentionally not attachment-completeness certificates; independent live-byte/refusal/accounting checks passed after both lifecycle actions. This satisfies the documented task without changing the established rollback contract. Publication and production qualification remain separate.

## 12. Accepted historical offers before price changes — E

This stage is independent of physical cleanup and may follow C. Do not expose a price editor or change a live price until it passes.

- [x] 12.1 Write historical/current/retired price, ambiguous subscription and unchanged-trial cases before changing offer matching. (3h)
      Components: C10, C11. Requirements: R15, R16.
      Done when: an existing annual subscriber stays recognized after changing the current checkout offer, and the test catches the old single-price mismatch behavior.
- [x] 12.2 Add a minimal versioned offer table seeded from the existing fixed configuration and matched-offer account field. (3h)
      Components: C3, C10. Requirements: R15.
      Done when: migration preserves all current subscribers/trials, one current checkout offer is enforced, and price IDs are unambiguous.
- [x] 12.3 Change reconciliation and invoice coverage checks to accepted historical prices while keeping new Checkout tied to the current offer. (4h)
      Components: C3, C10. Requirements: R5, R15.
      Done when: retired-for-sale offers remain recognized, ambiguous subscriptions become review cases, and no mismatch silently erases paid access.
- [x] 12.4 Apply offer storage/trial defaults at the correct boundary and retain frozen trial deadlines and explicit support adjustments. (3h)
      Components: C3, C4, C10. Requirements: R6, R7, R15.
      Done when: new trials use the new default, old trials/subscribers preserve promises, and allowance impact identifies the affected cohort.
- [x] 12.5 Add small offer-management UI with validation/impact/revision checks and audit; no automatic subscriber migration. (3h)
      Components: C1, C8, C10. Requirements: R1, R9, R13, R15.
      Done when: current/grandfathered/retired status is clear, accepted live prices cannot be accidentally dropped, and Checkout validation matches the displayed offer.
- [x] 12.6 Qualify in the disposable Stripe test environment, run billing/type/build checks and update offer documentation. (4h)
      Components: C11. Requirements: R5, R9, R15, R16.
      Done when: old/new price evidence and trial-deadline receipts pass; no live subscription, price or tax setting was changed by qualification.

## 13. Final integration and handoff for each shipped stage

- [x] 13.1 Verify optional build boundaries and supported deployment profiles in clean installed-package builds. (3h)
      Components: C1–C11. Requirements: R2, R10–R12, R16.
      Done when: hosted SQLite works, private Cloud has no payment requirement, static builds include no billing/server modules, and unsupported provider capabilities remain unavailable.
- [x] 13.2 Run the final proportionate security/schema suite, build and typechecks; collect the stage's E2E/browser/operation receipt. (4h)
      Components: C11. Requirements: R1–R16, limited to the shipped stage.
      Done when: relevant checks are green, introduced failures are fixed, external-service prerequisites are explicit, and the receipt records exact source/dependency/profile versions.
- [x] 13.3 Perform a simplification and final-diff review, update documentation links and compare implemented screens with the saved mockups. (2h)
      Components: C1–C11. Requirements: R1, R16.
      Done when: unused flags/helpers/abstractions and duplicate policy calculations are removed; no unrelated edits are staged; all new public behavior is documented.
- [x] 13.4 Prepare release/rollout notes with schema/backups, provider capability gates and staged activation; use existing release/deployment procedures only when authorized. (2h)
      Components: C7, C9, C10, C11. Requirements: R12, R14–R16.
      Done when: the stage has an explicit safe rollback/recovery path, destructive/price features are not accidentally activated, and production retains its rollback backup under the repository policy.

## Traceability Matrix

| Requirement | Design components | Primary tasks |
|---|---|---|
| R1 Familiar accessible UI | C1, C11 | 4.1–4.4, 5.5, 6.5, 8.4, 9.3, 10.4, 10.8–10.9, 13.3 |
| R2 Authorization/privacy | C2, C11 | 1.2, 2.2–2.4, 3.2, 4.4, 10.6, 13.1 |
| R3 Customer inspection | C1, C2, C11 | 2.3–2.5, 4.1–4.2, 8.5 |
| R4 Effective access/sync | C2–C5, C7, C11 | 2.2, 3.1, 4.2, 5.1–5.3, 6.1–6.4, 7.1–7.3, 8.5 |
| R5 Refresh/review | C3, C8, C11 | 1.3, 2.1, 3.1–3.3, 4.3–4.4, 12.3, 12.6 |
| R6 Storage | C1, C4, C9, C11 | 5.1–5.6, 7.5, 11.3, 11.5, 11.10, 12.4 |
| R7 Support exceptions | C3–C5, C8, C11 | 6.1–6.6, 7.5, 12.4 |
| R8 Narrow pauses | C5, C8, C11 | 7.1–7.5, 10.7 |
| R9 Billing health | C1, C3, C7, C8, C11 | 2.1, 2.5, 3.2, 8.1–8.4, 10.4, 12.5–12.6 |
| R10 Effective configuration | C6, C11 | 9.1–9.5, 10.7, 13.1 |
| R11 Resource/feature controls | C5, C6, C11 | 5.6, 7.4, 9.1, 9.4–9.5, 13.1 |
| R12 Overview/recovery | C7, C11 | 10.1–10.4, 10.9, 11.12, 13.1, 13.4 |
| R13 Administrative history | C8, C11 | 1.3, 2.1, 2.6, 3.3, 4.3, 6.2–6.5, 7.2, 8.2, 10.1, 10.5–10.8 |
| R14 Reclamation/retention | C9, C11 | 11.1–11.12, 13.4 |
| R15 Offer evolution | C10, C11 | 12.1–12.6, 13.4 |
| R16 Qualification | C11 | 1.1–1.3, 4.4, 5.1, 6.1, 7.1, 7.5, 8.1, 9.1, 9.5, 10.1, 10.9, 11.1–11.2, 11.7, 11.9, 11.12, 12.1, 12.6, 13.1–13.4 |

## Definition of Done

- The shipped stage's acceptance criteria pass; postponed D/E work remains visibly unchecked and cannot be enabled through an incomplete UI.
- A–C are not complete merely because the mockups render: actions, enforcement, privacy, conflicts, audit and failure states work end to end.
- Every requirement has a named component, task owner boundary and repeatable verification; the matrix has no gaps.
- Relevant commands from the design's Testing Strategy pass once per coherent stage, with full cross-cutting/security/schema qualification before final publication where warranted.
- Saved screenshots show implemented pages at the documented viewport/theme states; redacted traces/receipts prove meaningful actions and recovery, not just rendering.
- No first-party dependency is qualified only through a sibling source alias; use installed artifacts before release.
- Documentation/docmap and affected provider READMEs reflect actual behavior and capability limits.
- Final diff and simplification review are complete; existing unrelated work remains intact. Release and production mutation follow their separate authorization and repository gates.
