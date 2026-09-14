# Tasks

## 1. Native session lookup

- [ ] 1.1 Expose `sessions.list` through the OpenClaw control adapter in `packages/openclaw-or3/index.js`.
      Requirements: R1.AC1
      Done when: the bridge can request native session rows with `operator.read` scope.

- [ ] 1.2 Add an async bridge resolver that looks up the exact deterministic session key and hydrates `updatedAt` from `lastActivityAt ?? updatedAt`.
      Requirements: R1.AC1, R1.AC2, R1.AC3
      Done when: an empty bridge restores an existing old session without reading the current clock, and missing rows do not mutate the session map.

## 2. Read-path integration

- [ ] 2.1 Change `GET /api/sessions/:id` and history access to use the resolver; keep `ensureSession()` only on explicit creation/run paths.
      Requirements: R1.AC3, R3.AC1, R3.AC2
      Done when: reads cannot manufacture current timestamps and new work still initializes and advances timestamps normally.

- [ ] 2.2 Centralize parsing for epoch seconds, epoch milliseconds, and ISO timestamps; use resolved session activity for undated historical messages.
      Requirements: R2.AC1, R2.AC2
      Done when: all supported formats preserve the same instant and no historical normalization branch falls back to `Date.now()`.

## 3. Regression coverage and review

- [ ] 3.1 Add focused cases to `packages/openclaw-or3/test/bridge.test.js` for restoration, fallback precedence, missing rows, and timestamp formats.
      Requirements: R1.AC1-R1.AC3, R2.AC1-R2.AC2, R3.AC1-R3.AC2
      Done when: each failure path is asserted and the existing new-run behavior remains covered.

- [ ] 3.2 Inspect the final diff and run only the targeted OpenClaw bridge tests.
      Requirements: R3.AC3
      Done when: changes are confined to the plugin and its focused tests, with no sidebar, controller, schema, dependency, or unrelated edits.

## Traceability Matrix

| Requirement | Design component | Tasks |
|---|---|---|
| R1 | Gateway control adapter; Bridge session resolver; HTTP session handler | 1.1, 1.2, 2.1, 3.1 |
| R2 | Timestamp normalizer | 2.2, 3.1 |
| R3 | Bridge session resolver; HTTP session handler | 2.1, 3.1, 3.2 |

## Definition of Done

- All acceptance criteria pass.
- Restoring months-old sessions never stamps them with reconnect time.
- New session/run timestamps still advance normally.
- Targeted verification is green and the final diff contains only the scoped plugin/test changes.
- The traceability matrix has no gaps.
