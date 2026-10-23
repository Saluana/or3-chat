# Tasks
## 1. Implementation
- [x] 1.1 Add title state, shared preparation, atomic admission and conditional completion. Requirements: R1, R2. Done when race tests pass.
- [x] 1.2 Add backend inference and administrator model configuration. Requirements: R1, R4. Done when route and settings tests pass.
- [x] 1.3 Connect chat and document triggers. Requirements: R2, R3. Done when nonblocking and duplicate tests pass.
## 2. Delivery
- [x] 2.1 Validate, document cost and limitations, review, open PR. Requirements: R4. Done when PR exists with check results.
## Traceability Matrix
| Requirement | Component | Task |
|---|---|---|
| R1 | Shared title service | 1.1,1.2 |
| R2 | Conditional writes | 1.1,1.3 |
| R3 | Feature triggers | 1.3 |
| R4 | Settings and delivery | 1.2,2.1 |
## Definition of Done
Focused coverage passes and validation outcomes and limitations are recorded in the PR.

PR: https://github.com/Saluana/or3-chat/pull/280 (open, unmerged).
Validation: 252 focused tests passed; one existing skip. Type check, focused lint, production build and diff checks passed.

Chrome UI qualification: verified immediate chat fallback, sidebar/tab title updates, main response completion while title inference remained pending, no title calls on subsequent turns, heading reuse without inference, heading-free document opening before inference completed, unchanged document content, manual document rename winning over a pending result, and title persistence after reload. Dashboard routing persisted across reload, preserved complete model identifiers, and the changed model appeared in subsequent title requests. Restored Nitro after qualification. Used controlled browser network responses in the existing journey harness; paid live OpenRouter inference and managed administrator UI were not exercised by this browser pass. Temporary screenshots: `/tmp/or3-title-chrome-qa/`.
