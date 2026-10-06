# Tasks

Follow dependency order. Checkboxes target 1–4 hours; split larger discoveries. Phase 1 ends at section 5; Phase 2 follows qualification.

## 1. Project Store and ownership

- [x] 1.1 Define Project Store schemas/bounds. **R2, R3, R7.** Done: validation, hidden records, and failure cases specified.
- [x] 1.2 Unify chat ownership/moves. **R4.** Done: legacy owners reconciled, conflicts surfaced, extension entries preserved.
- [x] 1.3 Implement Project Store transactions. **R3, R7.** Done: stale edits refuse; project deletion preserves underlying work.
- [x] 1.4 Extend reference/backup handling. **R2, R7.** Done: original/extraction revisions survive replacement and restore.

## 2. Source Intake

- [x] 2.1 Implement Source Intake bindings/modes/replacement. **R2.** Done: failed replacement preserves current revision; history opens.
- [x] 2.2 Add bounded PDF worker. **R2.** Done: normal/scanned/malformed/oversized fixtures report accurate coverage.
- [x] 2.3 Add bounded DOCX worker/extraction storage. **R2.** Done: locations, cancellation/retry, and disabled external access verified.
- [x] 2.4 Connect previews/images/attachment destination. **R2.** Done: chat attachments create no knowledge binding; vision receives images.

## 3. Project Context Builder and Tool Policy

- [x] 3.1 Implement captured Context Builder. **R4.** Done: owner/revisions/context resolve independently of focused pane.
- [x] 3.2 Integrate send/retry/regeneration/continuation. **R4.** Done: oversized required context refuses while drafts survive.
- [x] 3.3 Enforce Project Tool Policy. **R5.** Done: forbidden IDs/resources and missing approvals refuse, including legacy reads.
- [x] 3.4 Integrate background admission/recovery. **R4, R5.** Done: scope persists and revocation blocks execution.
- [x] 3.5 Adapt workflow/plugin inference bridges. **R4, R5.** Done: project calls use the shared boundary or refuse.
- [x] 3.6 Persist Context Receipts. **R4.** Done: every provider iteration distinguishes retrieval/submission after reload.

## 4. Project Home

- [x] 4.1 Register Projects/Home with profiles/tabs. **R1.** Done: search/pin/recent/create/open work on keyboard/mobile.
- [x] 4.2 Compose Project Home/Knowledge. **R1, R2.** Done: mixed chat/document activity, Home Projects link, entry-aware single back navigation, and compact source intake/history/modes.
- [x] 4.3 Add Memory/Settings/Remember actions. **R1, R3, R5.** Done: readable brief/fact/decision cards, a project-only message toolbar action, searchable model/tool settings using registered UI metadata, conditional repository controls, compact chat management, and visible save/discard controls.
- [x] 4.4 Add Context Receipt inspector. **R4.** Done: available/retrieved/included context and omissions are distinguishable.

## 5. Phase 1 qualification

- [x] 5.1 Qualify providers/backups. **R7.** Done: SQLite/Convex round trips preserve project state/references; unsupported providers cannot silently discard them.
- [x] 5.2 Qualify context/security journeys. **R4, R5.** Done: A streams while B opens; alternate execution paths remain isolated.
- [x] 5.3 Qualify source/lifecycle journeys. **R1–R3, R7.** Done: failure/retry, Trash/restore, replacement, shared bytes, memory deletion, and reload pass.
- [x] 5.4 Simplify/document/verify. **R1–R5, R7.** Done: public docs/docmap/provider READMEs updated; relevant tests, typecheck, and builds pass.

## 6. Phase 2 continuity

- [x] 6.1 Add Continuity retrieval/exclusions. **R6.** Done: excluded/moved chats invalidate derived summaries and disappear from retrieval.
- [x] 6.2 Add reviewed brief/memory suggestions. **R3, R6.** Done: evidence linked; contradictions/rejections cannot silently change decisions.
- [x] 6.3 Expose existing compaction as Continue. **R6.** Done: same-project handoff links evidence without copying full history.
- [x] 6.4 Qualify/document Continuity. **R6, R7.** Done: repeated handoffs, stale summaries, exclusions, and generation failure preserve work.

## Review qualification

Phases 1–2 are implemented in the isolated review branches. See [validation](validation.md) for exact checks, artifacts, and execution limitations. Worker cancellation was inspected and revoked writes are covered at the store boundary; the browser journey covers failed-source retry. Phase 3's new sharing, connections, larger retrieval, and project bundles remain separately scoped in [permission and preservation contracts](phase-3-contracts.md).

## Traceability Matrix

| Requirement | Design component | Tasks |
| --- | --- | --- |
| R1 | Project Home | 4.1–4.3, 5.3–5.4 |
| R2 | Source Intake, Project Store | 1.1, 1.4, 2.1–2.4, 4.2, 5.3–5.4 |
| R3 | Project Store | 1.1, 1.3, 4.3, 5.3–5.4, 6.2 |
| R4 | Context Builder, Context Receipt | 1.2, 3.1–3.2, 3.4–3.6, 4.4, 5.2, 5.4 |
| R5 | Project Tool Policy | 3.3–3.5, 4.3, 5.2, 5.4 |
| R6 | Project Continuity | 6.1–6.4 |
| R7 | Project Store | 1.1, 1.3–1.4, 5.1, 5.3–5.4, 6.4; Phase 3 separately scoped |

## Definition of Done

Phase criteria pass without traceability gaps. Run named `test:e2e:context`, `test:e2e:storage`, `test:e2e:workspace-cloud`, and `test:e2e:journeys` harnesses as applicable; retain traces/request-receipt artifacts. Run relevant runtime/provider suites, `bun x nuxi typecheck`, and local/static plus fixed-profile cloud builds; review the diff. Phase 3 requires separate permission-aware design before implementation.
