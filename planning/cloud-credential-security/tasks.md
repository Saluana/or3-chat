# Tasks

## 1. Grounding and regression contracts
- [x] 1.1 Inspect fetched defaults and trace credential/deployment boundaries. Requirements: R1–R5. Done when source SHAs and findings are recorded.
- [x] 1.2 Extend canonical tests before implementation: billing, account storage/migration, plugin activation and lifecycle failures. Requirements: R2–R4. Done when negative controls fail on baseline for intended reasons.

## 2. Server credential policy
- [x] 2.1 Implement account credential operations and one resolver; integrate chat, background, memory, catalog and plugin operations. Requirements: R2. Done when billing matrix and authenticated route cases pass.
- [x] 2.2 Move Cloud OAuth exchange behind server PKCE/account binding. Requirements: R2. Done when callback returns status only and reconnect/account-switch cases pass.

## 3. Browser and plugins
- [x] 3.1 Disable Cloud key hydration/persistence and direct fallback; add owner-safe migration and metadata status. Requirements: R3. Done when import failure retains local data, successful import cleans it, and stale-device/account races fail closed.
- [x] 3.2 Integrate existing governed AI completion and private secrets; refuse Cloud raw provider access. Requirements: R4. Done when grant/revocation/ownership/billing coverage passes.

## 4. Deployment
- [x] 4.1 Add managed single-host provisioning, supervision, readiness, token renewal and explicit configuration. Requirements: R1. Done when fresh/upgrade/restart/outage/partial-custody cases are exercised.
- [x] 4.2 Integrate encrypted vault backups and explicit recovery with existing lifecycle. Requirements: R1. Done when disposable backup checksum/recovery and app rollback preserve custody.

## 5. Qualification and delivery
- [x] 5.1 Run focused suites, broader high-risk validation, types/builds and real-service/browser smokes; record actual evidence. Requirements: R5. Done when receipt distinguishes failures/blockers.
- [x] 5.2 Review/simplify full diff, update public documentation/docmap/provider guidance and open PR. Requirements: R1–R5. Done when PR links and limitations are delivered.

## Traceability Matrix
| Requirement | Component | Task |
| --- | --- | --- |
| R1 | Provider and managed lifecycle | 1.1, 4.1, 4.2, 5.2 |
| R2 | Resolver and account/OAuth routes | 1.2, 2.1, 2.2, 5.2 |
| R3 | Browser credential composable/UI | 1.2, 3.1, 5.2 |
| R4 | Existing plugin admission/services | 1.2, 3.2, 5.2 |
| R5 | Qualification receipt | 1.1, 5.1, 5.2 |

Delivery: [draft PR #270](https://github.com/Saluana/or3-chat/pull/270). Implementation is committed; the Docker qualification limit below remains open.

## Qualification limit
The final Docker/lifecycle rerun is blocked by the local Docker Desktop engine failure. The user explicitly chose to leave Docker alone; no recovery or interrupted-fixture cleanup is being attempted. The corrected explicit-disable case and final Docker rerun remain unqualified, and fixture cleanup is unverified. This decision does not waive the remaining release or production qualification gates. See `qualification.md` for actual results.

## Definition of Done
All acceptance criteria have executable evidence or an explicitly stated environmental/production blocker; relevant checks have actual recorded outcomes; final diff is reviewed; no production mutation or publication; implementation PR is open. Unfinished work is reported, never described as complete.
