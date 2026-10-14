# Tasks

Simplified implementation checklist for [requirements.md](requirements.md) and [design.md](design.md). This replaces the original 40-task draft. R9 (general user directory) is deferred; all other requirement IDs remain active. The reduction removes scope and mechanisms, rather than merely grouping the previous work into larger tasks.

Components C1–C6 are responsibilities in existing modules, not new service classes. Estimates are roughly 1–4 hours per task. Keep tests at their primary boundary, write necessary isolated tests before owner changes, and mark tasks complete only with evidence. Provider artifact publication/deployment follows the existing maintainer workflow when separately authorized.

## 1. Failure cases and small contracts

- [x] 1.1 Write failure cases and extend the primary regression suites before implementation (3h)
      Components: C2, C3, C4, C5, C6.
      Requirements: R2.AC1–AC3, R3.AC3, R6.AC1–AC4, R7.AC1–AC3, R8.AC1–AC3, R12.AC1.
      Done when: canonical rollback/concurrency, invalid/revoked invites, same-identity retry, credential-first interrupted signup, old links and no-workspace plugin access have failing cases in existing owners; each isolated test has a distinct risk that E2E cannot reliably cover.

- [x] 1.2 Add flat optional signup-store methods and the signed token variant (3h)
      Components: C3, C4.
      Requirements: R2.AC3, R8.AC1, R10.AC1–AC2, R11.AC3.
      Done when: the existing AuthWorkspaceStore supports the five optional methods, shared types express accepted results/failures, token helpers distinguish signup purpose while retaining legacy workspace bytes, and missing-method support is explicit. No nested capability object or new registry is added.

## 2. Canonical provider support

- [x] 2.1 Add SQLite signup-invite schema and administrative methods (4h)
      Components: C3, C4.
      Requirements: R5.AC3, R10.AC1, R10.AC3, R11.AC2.
      Done when: one additive migration preserves existing rows, create/list/revoke/validate operate on real data, pagination is bounded, and terminal cleanup deletes at most 100 eligible records per call.

- [x] 2.2 Implement native SQLite atomic acceptance and replay (4h)
      Components: C4.
      Requirements: R6.AC1–AC3, R7.AC2, R10.AC2–AC3.
      Done when: real-database cases prove all-or-nothing creation, one winner for accept/revoke, same-identity result replay without writes, and no duplicate workspace for an existing canonical user. Unsupported driver modes do not advertise the new methods.

- [x] 2.3 Add Convex schema and administrative invite functions (4h)
      Components: C3, C4.
      Requirements: R2.AC3, R5.AC3, R10.AC1, R10.AC3, R11.AC2.
      Done when: additive template schema/functions implement bounded create/list/revoke/validate/cleanup with trusted server access, snake_case wire values and no changes to old workspace invite semantics.

- [x] 2.4 Implement Convex atomic acceptance and wire the adapter (4h)
      Components: C4, C5.
      Requirements: R6.AC1–AC3, R7.AC3, R10.AC2, R11.AC3.
      Done when: one internal mutation owns creation/replay, binds identity through the existing trusted bridge, and passes actual transaction conflict/rollback cases; the adapter maps types/timestamps and reports missing deployed functions explicitly.

## 3. Signup invites through existing auth

- [x] 3.1 Add the three admin signup-invite handlers (3h)
      Components: C3.
      Requirements: R2.AC1, R2.AC3, R5.AC1–AC4, R10.AC2.
      Done when: create/list/revoke work with only a super-admin session, strict schemas accept no destination workspace or role, actor attribution uses the admin principal, existing security/rate-limit patterns apply, and lists omit token material.

- [x] 3.2 Integrate signup acceptance into current registration/session resolution (4h)
      Components: C4, C5.
      Requirements: R6.AC1–AC5, R7.AC1–AC3, R8.AC1–AC3, R11.AC3.
      Done when: both invite kinds dispatch correctly, new signup uses the returned private workspace, current membership determines access on replay, existing-user/bootstrap/mode behavior works, and defaults run through the existing post-commit helper without creating another workspace or new initialization state machine.

- [x] 3.3 Preserve invite handoff when retrying through ordinary sign-in (3h)
      Components: C5.
      Requirements: R7.AC1–AC3, R8.AC2–AC3, R11.AC3.
      Done when: preflight still rejects invalid invites before Basic Auth credential creation; the existing sign-in path can finish an interrupted signup using the same account ID and valid/replacement invite; the registration UI offers Sign in without exposing whether an email exists; provider-only credentials cannot read protected OR3 data.

- [x] 3.4 Add the signup-invite page with copy/list/revoke controls (3h)
      Components: C1, C3.
      Requirements: R1.AC1, R5.AC1–AC4.
      Done when: the page needs no workspace, explains private ownership, uses existing Nuxt UI variants and link/token delivery, handles clipboard/lost-response failures, and shows bounded history with pending-only revocation. No user directory or signup repair console is introduced.

## 4. Remove the admin scope coupling

- [x] 4.1 Make the existing plugin-page API's workspace target optional (4h)
      Components: C2.
      Requirements: R1.AC1, R2.AC2, R3.AC1–AC2, R11.AC2.
      Done when: site inventory/policy loads independently; workspace grants/setup are queried only for an authorized requested target; absent workspace state is explicitly null; internal callers/types migrate together without duplicate aggregator endpoints.

- [x] 4.2 Split existing Plugins UI into Instance and Workspace tabs (3h)
      Components: C1, C2.
      Requirements: R1.AC1–AC3, R3.AC1–AC2, R4.AC1–AC2.
      Done when: site controls load without a selector, workspace selection lives in its tab/operation dialogs, URL targets and displayed names agree, old plugin/rollout parameters survive, and stale requests cannot render another workspace's state.

- [x] 4.3 Remove the unused initiating workspace from shared rollback/uninstall (4h)
      Components: C2.
      Requirements: R2.AC1, R3.AC3, R11.AC3.
      Done when: existing all-workspace rollback preflight and uninstall lifecycle run without an unrelated workspace, snapshot callbacks remain required only where actually used, global effects are stated in confirmation, zero-workspace inventory works, and affected hook payloads no longer require fabricated attribution. Existing locks/digest/consent/canary protections are retained.

- [x] 4.4 Update navigation and keep workspace actions explicitly targeted (2h)
      Components: C1, C2.
      Requirements: R1.AC2–AC3, R2.AC2, R4.AC1–AC3.
      Done when: Signup invites and existing Administrators are direct instance links, workspace details link to their Plugin tab, restricted workspace-admin routing preserves its authorized target, member-removal copy is accurate, and a Chat workspace switch cannot retarget an admin action. No route-scope registry or nested workspace-page migration is needed.

## 5. Focused qualification and documentation

- [x] 5.1 Rebuild and qualify the provider artifacts actually consumed by OR3 (4h)
      Components: C4, C5, C6.
      Requirements: R6.AC1–AC3, R7.AC1–AC3, R10.AC1–AC3, R12.AC3.
      Done when: native SQLite and Convex transaction/migration cases pass, the Basic Auth flow uses rebuilt artifacts, and host contracts agree with deployed disposable Convex functions. Missing proof or unsupported modes are recorded explicitly; node_modules patches do not count as provider implementation.

- [x] 5.2 Run the changed browser journeys and retain redacted evidence (4h)
      Components: C1, C2, C3, C5, C6.
      Requirements: R1.AC1–AC3, R2.AC1–AC3, R3.AC1–AC3, R4.AC1–AC3, R5.AC1–AC4, R6.AC4–AC5, R7.AC1–AC3, R8.AC1–AC3, R12.AC2.
      Done when: named sign-in/admin/relevant plugin harnesses prove private desktop/mobile signup, interrupted sign-in retry, real sync/storage isolation, reload, legacy team invites, no-workspace instance controls, and accurate global plugin scope; a short repeatable JSON/screenshot artifact contains no tokens or credentials. Use the sync-enabled sign-in profile for actual provider proof.

- [x] 5.3 Run narrow type/build/boundary checks (3h)
      Components: C2, C4, C5, C6.
      Requirements: R10.AC2–AC3, R11.AC1–AC3, R12.AC3.
      Done when: affected tests or test:changed, type-check, relevant provider-host checks, and isolated SSR/static builds pass; pagination/cleanup cases are bounded. Broaden testing only for the final cross-cutting auth gate or an unresolved failure.

- [x] 5.4 Update affected documentation and mark verified tasks (2h)
      Components: C6.
      Requirements: R8.AC1–AC3, R11.AC3, R12.AC3.
      Done when: current account/setup/provider/plugin docs and affected docmap/hook entries describe both invite types and the scope split; check:docs passes; this checklist links to actual evidence. Record resolved architectural findings in the existing planning locations without claiming deferred R9 was delivered.

## Traceability Matrix

| Requirement | Components | Tasks |
| --- | --- | --- |
| R1 | C1, C2, C6 | 3.4, 4.1–4.2, 4.4, 5.2 |
| R2 | C1, C2, C3, C6 | 1.1–1.2, 2.3, 3.1, 4.1, 4.3–4.4, 5.2 |
| R3 | C1, C2, C6 | 1.1, 4.1–4.3, 5.2 |
| R4 | C1, C2, C6 | 4.2, 4.4, 5.2 |
| R5 | C1, C3, C4, C6 | 2.1, 2.3, 3.1, 3.4, 5.2 |
| R6 | C4, C5, C6 | 1.1, 2.2, 2.4, 3.2, 5.1–5.2 |
| R7 | C4, C5, C6 | 1.1, 2.2, 2.4, 3.2–3.3, 5.1–5.2 |
| R8 | C3, C5, C6 | 1.1–1.2, 3.2–3.3, 5.2, 5.4 |
| R9 | Deferred; no new user directory | None |
| R10 | C3, C4, C6 | 1.2, 2.1–2.4, 3.1, 5.1, 5.3 |
| R11 | C1, C2, C4, C5, C6 | 1.2, 2.1, 2.3–2.4, 3.2–3.3, 4.1, 4.3, 5.3–5.4 |
| R12 | C6 and existing boundary owners | 1.1, 5.1–5.4 |

## Completion evidence

All 18 implementation tasks are verified in [verification.md](verification.md). Provider publication/deployment remains separate, as specified above; R9 remains deferred.

## Definition of Done

- Instance controls and signup invitations work with no selected workspace; actual workspace operations retain explicit targets and authorization.
- A signup invitation yields exactly one private owner workspace; canonical failures leave no partial records, retry works through existing sign-in, and old team invites retain their behavior.
- Native SQLite and Convex support are backed by actual provider evidence. Unsupported drivers fail explicitly.
- All active acceptance criteria are covered by passing checks and redacted repeatable artifacts; unavailable checks remain unchecked.
- R9 stays deferred. The implementation adds no credential state machine, recovery worker, user-directory backend, duplicate plugin APIs, or replacement plugin lifecycle framework.
