# Tasks

Planning only. All items below are future implementation work; none are marked complete by creation of this plan. Each task is intended to fit approximately 1-4 focused engineering hours; split a task further if implementation exposes a larger change.

Delivery order: **A. Client clarity and recovery -> B. Real local candidate testing -> C. Connected publisher flow -> D. Authorized end-to-end qualification.** Each phase must pass its gate before depending on it in the next phase. Repository-relative paths below refer to the repository named in the task.

## 1. Client Contracts

- [x] 1.1 Define the lifecycle projection over existing status and runtime contracts (2-3h)
      Component: Lifecycle View, Runtime Confirmation, Diagnostic Projection. Repository: `or3-chat`.
      Requirements: R1.AC1-R1.AC4, R9.AC1-R9.AC2.
      Done when: available, selected, and observed identities have documented authoritative sources; disabled, not-observed, starting, failed, and development provenance are representable without exposing activation handles or making browser-wide claims.

- [x] 1.2 Expose missing selected-package facts through existing read APIs (2-4h)
      Component: Acquisition Service. Repository: `or3-chat`.
      Requirements: R1.AC1, R1.AC3, R2.AC1-R2.AC2.
      Done when: authorized status/detail responses provide the exact selected identity needed by the projection, old operation records still load, and route tests enforce existing owner/workspace access without new acquisition stages or persistence.

## 2. Runtime Confirmation

- [x] 2.1 Report exact activation and contribution readiness (3-4h)
      Component: Runtime Confirmation. Repository: `or3-chat`.
      Requirements: R1.AC2-R1.AC3, R4.AC1, R4.AC4.
      Done when: readiness follows bootstrap and applicable real sidebar/pane/tool registration; optional discovery errors remain visible, required registration failures prevent full readiness, and generation-bound tests reject stale notifications.

- [x] 2.2 Join completed acquisition to bounded activation observation (2-4h)
      Component: Lifecycle View, Runtime Confirmation. Repository: `or3-chat`.
      Requirements: R1.AC3, R2.AC2, R4.AC1-R4.AC2.
      Done when: completion requests reconciliation, waits up to 30 seconds for the exact package, preserves server success on timeout, detaches observers on workspace/navigation changes, and accepts a later matching observation without starting another acquisition.

- [x] 2.3 Verify replacement cleanup and preserve data safeguards (2-4h)
      Component: Runtime Confirmation, Acquisition Service. Repository: `or3-chat`.
      Requirements: R4.AC3-R4.AC6.
      Done when: replacement tests prove old registrations are disposed, late callbacks cannot restore them, storage is not cleared, and pending-action/pane-close safeguards are preserved; unsupported data rollback is not offered.

## 3. Client Experience and Phase A Gate

- [x] 3.1 Build the single status and next-action view (3-4h)
      Component: Lifecycle View. Repository: `or3-chat`.
      Requirements: R1.AC1-R1.AC4, R2.AC1, R2.AC3, R9.AC1.
      Done when: existing installed/updates/detail views share consistent status meanings and actions, show installed versus running separately, and do not claim full success from acquisition completion alone.

- [x] 3.2 Connect consent, setup, session return, retry, and cancellation (3-4h)
      Component: Lifecycle View, Acquisition Service. Repository: `or3-chat`.
      Requirements: R2.AC2-R2.AC4, R3.AC1-R3.AC4.
      Done when: refresh/session recovery resumes the same operation, return destinations are validated, incompatible hosts are blocked, new authority is explicit, and stale enabled-workspace evidence or post-promotion cancellation is accurately displayed.

- [x] 3.3 Add bounded diagnostic copying and conditional recovery actions (2-3h)
      Component: Diagnostic Projection, Lifecycle View. Repository: `or3-chat`.
      Requirements: R4.AC2-R4.AC3, R4.AC5, R9.AC1-R9.AC2.
      Done when: copied output passes allowlist/redaction tests, includes useful identities and stage/error codes, and never offers an unverified previous package or claims rollback occurred without authoritative evidence.

- [x] 3.4 Polish accessible mobile and desktop states (2-3h)
      Component: Lifecycle View. Repository: `or3-chat`.
      Requirements: R9.AC3-R9.AC4.
      Done when: keyboard focus survives state refresh/dialog return, repeated polling does not repeat announcements, and 375px/1440px light/dark views have no horizontal page overflow using existing themed components.

- [x] 3.5 Qualify and document Phase A (3-4h)
      Component: Lifecycle View, Acquisition Service, Runtime Confirmation, Diagnostic Projection. Repository: `or3-chat`.
      Requirements: R1-R4, R9.
      Done when: affected client/acquisition/runtime tests and one typecheck pass; Chrome verifies actual-plugin update, reload/resume, workspace switch, exact running identity, and recoverable failure; public documentation/docmap explain installed versus running and recovery limits. Record evidence and unresolved pre-existing failures separately.

Phase A exit: a user can tell what is installed, what this browser is running, why an update stopped, and which supported action comes next. This phase is useful without development admission or marketplace schema changes.

## 4. Immutable Candidate Files

- [x] 4.1 Define bounded candidate and verification receipt validation (2-3h)
      Component: Candidate Builder, Verification Receipt. Repository: `or3-chat` SDK.
      Requirements: R5.AC1, R7.AC1.
      Done when: receipts have versioned schemas, canonical digest rules, artifact identities, provenance inputs, and explicit verification scope; validation rejects unknown/malformed identity fields and oversized input without recording secrets.

- [x] 4.2 Implement source snapshot and actual build-input capture (3-4h)
      Component: Candidate Builder. Repository: `or3-chat` SDK.
      Requirements: R5.AC1, R5.AC3-R5.AC4.
      Done when: receipts distinguish clean commits from dirty snapshots, source archives include the candidate's relevant changed files without secrets, and SDK artifact/lockfile hashes identify actual inputs rather than package version strings alone.

- [x] 4.3 Add the candidate orchestration command (3-4h)
      Component: Candidate Builder. Repository: `or3-chat` SDK.
      Requirements: R5.AC1-R5.AC3.
      Done when: the command composes existing validation/build/pack/inspect helpers, creates sibling package/source/receipt outputs, refuses to overwrite a frozen candidate, and verifies existing files without implicit rebuilding.

- [x] 4.4 Add clean qualification comparison and SDK documentation (3-4h)
      Component: Candidate Builder. Repository: `or3-chat` SDK.
      Requirements: R5.AC2-R5.AC5, R9.AC5.
      Done when: a clean, release-policy-compliant rebuild is compared to frozen output and mismatches fail; targeted SDK tests/build/typecheck pass; authoring docs cover matching vendored SDK artifacts and immutable version rules. No npm publication is performed by this task.

## 5. Dedicated Local Admission

- [x] 5.1 Implement the isolated development instance profile (3-4h)
      Component: Local Admission. Repository: `or3-chat`.
      Requirements: R6.AC1-R6.AC2, R6.AC6.
      Done when: opt-in startup uses explicit separate application/extension roots and loopback binding, ordinary settings are not borrowed implicitly, and production builds cannot enable the capability through the flag.

- [x] 5.2 Add the restricted owner admission boundary (3-4h)
      Component: Local Admission. Repository: `or3-chat`.
      Requirements: R6.AC2-R6.AC3.
      Done when: the entry point independently enforces build/profile/network/auth/origin eligibility, validates candidate receipt and bytes through existing archive protections, and creates explicit local provenance without fabricating a signed release or altering normal raw-upload policy.

- [x] 5.3 Integrate existing candidate checks and managed promotion (3-4h)
      Component: Local Admission, Acquisition Service. Repository: `or3-chat`.
      Requirements: R3.AC1-R3.AC4, R6.AC3-R6.AC5.
      Done when: a valid local candidate passes existing feature/authority/setup/canary checks before managed selection, denied grants block it, and interruption recovers existing candidate state rather than creating a second install engine.

- [x] 5.4 Add candidate selection, activation, and open controls (3-4h)
      Component: Local Admission, Lifecycle View. Repository: `or3-chat`.
      Requirements: R1.AC4, R6.AC4-R6.AC6, R9.AC3-R9.AC4.
      Done when: an eligible owner can select package/source/receipt files through the real admin UI, inspect identity/access, activate, and open the actual plugin; ineligible hosts show the requirement instead of an actionable bypass.

- [x] 5.5 Record scoped verification and support explicit candidate replacement (2-4h)
      Component: Verification Receipt, Local Admission, Runtime Confirmation. Repository: `or3-chat`.
      Requirements: R5.AC2-R5.AC3, R6.AC5, R7.AC1, R7.AC4.
      Done when: a canary produces only canary evidence, interaction verification is separately labeled, the exported receipt binds the candidate/host, and replacing same-version/different-digest local candidates preserves storage and cleans up registrations.

## 6. Development Workflow Gate

- [x] 6.1 Add the admission security and isolation regression matrix (3-4h)
      Component: Local Admission. Repository: `or3-chat`.
      Requirements: R3, R6.AC1-R6.AC3, R6.AC6.
      Done when: negative tests cover each build/flag/profile/network/auth/origin restriction, archive abuse, invalid receipt, denied authority, and unchanged ordinary raw upload restrictions; none can be bypassed by supplied headers or configuration alone.

- [ ] 6.2 Run real-plugin replacement and persistence acceptance in Chrome (2-4h)
      Component: Local Admission, Runtime Confirmation, Verification Receipt. Repository: `or3-chat`.
      Requirements: R1.AC4, R4.AC4-R4.AC6, R6.AC4-R6.AC5, R7.AC1.
      Done when: the dedicated instance runs a candidate through real sidebar/pane/tool/storage integration, reload retains a designated fixture, a second digest replaces it, the old activation is cleaned up, and the normal instance remains unchanged. Use only isolated fixture data.

- [x] 6.3 Qualify and document Phase B (2-4h)
      Component: Candidate Builder, Local Admission, Verification Receipt. Repository: `or3-chat`.
      Requirements: R5-R7, R9.AC5.
      Done when: affected SDK/runtime/admin/security suites, appropriate compatibility tests, build checks, and typecheck pass; documentation/docmap and SDK README describe dedicated-instance setup, the trust boundary, replacement, and limitations; no preview page is required.

Phase B exit: a developer can build a frozen candidate, open it as a real plugin locally, replace it without publishing, and export exactly scoped verification evidence. Production builds and ordinary instances still reject this admission path.

## 7. Submission Receipt Binding

- [x] 7.1 Add bounded revision-specific receipt storage (2-4h)
      Component: Submission Flow. Repository: `or3-marketplace`.
      Requirements: R7.AC2-R7.AC4, R8.AC1.
      Done when: an additive migration adds nullable receipt fields, combined input is limited to 64 KiB, freezing rules protect submitted revisions, existing submissions remain readable, and migration/immutability tests pass without replacing existing evidence tables.

- [x] 7.2 Validate receipt-to-upload correspondence in the submission service (3-4h)
      Component: Submission Flow. Repository: `or3-marketplace`.
      Requirements: R5.AC2-R5.AC5, R7.AC2-R7.AC3, R8.AC1.
      Done when: authenticated owned drafts accept matching existing artifacts/receipts, mismatched package/source/provenance identity blocks submission, and replacement uses a new revision without overwriting published bytes.

- [x] 7.3 Keep trusted runner evidence distinct from developer metadata (2-4h)
      Component: Submission Flow, Verification Receipt. Repository: `or3-marketplace`.
      Requirements: R7.AC2-R7.AC4.
      Done when: trusted evidence binds independently inspected source/provenance, developer reports cannot set approval-required checks, and stale/mismatched receipts are visibly inapplicable with regression coverage.

## 8. Publisher and Signer Journey

- [x] 8.1 Connect candidate upload and next-action presentation (3-4h)
      Component: Submission Flow. Repository: `or3-marketplace`.
      Requirements: R7.AC4, R8.AC1, R9.AC1, R9.AC3-R9.AC4.
      Done when: existing developer submission pages accept the frozen files and receipts, show artifact identities and verification scope, and identify the next required stage/actor without introducing another wizard state machine.

- [x] 8.2 Preserve context across role and authentication gates (2-4h)
      Component: Submission Flow, Publication Flow. Repository: `or3-marketplace`.
      Requirements: R8.AC2-R8.AC3.
      Done when: submission and publication-intent context survives sign-in/recent-factor interruption via validated same-origin return paths; reviewer/signer authorization is rechecked and no credentials are transferred between host and marketplace.

- [x] 8.3 Present resumable publication and its final receipt (2-4h)
      Component: Publication Flow, Diagnostic Projection. Repository: `or3-marketplace`.
      Requirements: R5.AC5, R8.AC3-R8.AC4, R9.AC1-R9.AC2.
      Done when: retries reconcile the existing intent, UI distinguishes review/auth/signing/publication blockers, and success displays release/source/digest facts from committed records rather than inferred client state.

## 9. Marketplace Gate

- [x] 9.1 Extend integrity, authorization, and retry regressions (3-4h)
      Component: Submission Flow, Publication Flow. Repository: `or3-marketplace`.
      Requirements: R5.AC5, R7, R8.
      Done when: tests cover malformed/oversized receipts, metadata freezing, source mismatch, changed review evidence, unauthorized actors, expired sessions, repeated publish, and interruption around signing/commit; old signed releases remain unchanged.

- [x] 9.2 Qualify and document Phase C (2-4h)
      Component: Submission Flow, Publication Flow. Repository: `or3-marketplace`; cross-links in `or3-chat` docs.
      Requirements: R8, R9.AC3-R9.AC5.
      Done when: `bun run check` is green, relevant READMEs and public workflow documentation match actual behavior, and responsive/keyboard checks cover new publisher/admin states. Do not migrate or deploy staging until separately authorized and environment-checked.

Phase C exit: tested files can enter the existing review/signing flow unchanged, every receipt is tied to a revision, and authentication or retry does not lose the user's place or weaken approval.

## 10. Authorized End-to-End Qualification

- [ ] 10.1 Prepare a clean staging candidate and evidence (2-4h)
      Component: Candidate Builder, Verification Receipt. Repositories: `or3-chat` and designated plugin.
      Requirements: R5, R7.AC1.
      Done when: a clean isolated worktree identifies the exact source commit, version availability is checked, dependency inputs satisfy release policy, frozen artifacts pass qualification, and actual-plugin verification covers their exact digests. Leave dirty user checkouts untouched.

- [ ] 10.2 Exercise authorized staging submission and publication (2-4h active work; human approval wait excluded)
      Component: Submission Flow, Publication Flow. Repository: `or3-marketplace`.
      Requirements: R7.AC2-R7.AC4, R8.AC1-R8.AC4.
      Done when: explicit staging authorization and environment checks precede mutation, the normal validation/review/signer flow publishes the exact candidate, and the resulting immutable release receipt matches package/source provenance. No production deployment or manual pointer/signature edit occurs.

- [ ] 10.3 Verify the signed update in actual OR3 Chat using Chrome (3-4h)
      Component: Lifecycle View, Acquisition Service, Runtime Confirmation. Repository: `or3-chat`.
      Requirements: R1-R4, R8.AC4, R9.AC1-R9.AC4.
      Done when: the normal marketplace update installs that signed release, any additional grants receive explicit authorized approval, selected/running digests match, fixture data survives reload, session interruption resumes correctly, and mobile/desktop status and diagnostics are verified without a demo page.

- [ ] 10.4 Inspect final diffs and write the delivery receipt (1-2h)
      Component: All named components. Repositories: `or3-chat`, `or3-marketplace`, designated plugin only if changed.
      Requirements: R1-R9.
      Done when: unrelated changes remain untouched; temporary scaffolding and unnecessary abstractions introduced by this work are removed; all changed behavior is documented; verification results, exact published/installed/running identities, limitations, and environment are recorded. No check is represented as passed if it was not run.

## Traceability Matrix

| Requirement | Design Components | Tasks |
| --- | --- | --- |
| R1: Truthful package status | Lifecycle View, Runtime Confirmation | 1.1-1.2, 2.1-2.2, 3.1, 3.5, 5.4, 6.2, 10.3-10.4 |
| R2: Resumable update journey | Lifecycle View, Acquisition Service | 1.2, 2.2, 3.1-3.2, 3.5, 10.3-10.4 |
| R3: Compatibility and consent | Acquisition Service, Local Admission | 3.2, 3.5, 5.3, 6.1, 10.3-10.4 |
| R4: Activation and recovery | Runtime Confirmation, Acquisition Service, Diagnostic Projection | 2.1-2.3, 3.3, 3.5, 6.2, 10.3-10.4 |
| R5: Candidate identity | Candidate Builder, Verification Receipt, Submission Flow | 4.1-4.4, 5.5, 6.3, 7.2, 8.3, 9.1, 10.1, 10.4 |
| R6: Real local testing | Local Admission | 5.1-5.5, 6.1-6.3, 10.4 |
| R7: Bound evidence | Verification Receipt, Submission Flow, Publication Flow | 4.1, 5.5, 6.2-6.3, 7.1-7.3, 8.1, 9.1, 10.1-10.2, 10.4 |
| R8: Connected publication | Submission Flow, Publication Flow | 7.1-7.2, 8.1-8.3, 9.1-9.2, 10.2-10.4 |
| R9: Status, diagnostics, documentation | Lifecycle View, Diagnostic Projection; each component's documentation | 1.1, 3.1, 3.3-3.5, 4.4, 5.4, 6.3, 8.1, 8.3, 9.2, 10.3-10.4 |

## Definition of Done

- All applicable requirement acceptance criteria pass and the traceability matrix has no unmapped requirement or implementation task.
- Phase gates have recorded evidence. Tests/typechecks/builds use the correct Bun lanes and are green; unrelated pre-existing failures, if any, are explicitly separated and not waived for changed behavior.
- Chrome acceptance uses a real installed plugin, including the dedicated local candidate path and the normal signed staging path. A preview render, server canary, or successful install alone is not completion.
- The release receipt proves the tested, reviewed, published, and installed package identities match; the current browser's running identity is independently confirmed.
- Normal signature verification, authority review, workspace isolation, immutable publication, and blocked raw-upload policy remain intact. Production cannot enable development admission.
- Existing plugin data survives supported update/replacement/reload checks. No speculative automatic data rollback or silent storage reset is introduced.
- Host public documentation/docmap, SDK instructions, and relevant marketplace READMEs describe the shipped workflow and limitations.
- Final diffs contain only intended work. The delivery report explicitly states what was implemented, verified, published, installed, and not performed. Approval of this plan is not itself production deployment authorization.
