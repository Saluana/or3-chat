# Tasks

Work from `or3-chat/`. Each task is intended as one small implementation session (roughly 1–4 hours). Preserve unrelated working-tree changes.

## 1. Reproduce the scheduling failure

- [x] 1.1 Add real-Dexie cases to `app/core/sync/__tests__/outbox-manager.test.ts` for a continuously replenished 500-row pending window and a due retry, plus due work hidden behind future-due rows.
      Components: Regression tests and mapped docs; Eligible selector; Fair merge.
      Requirements: R1.AC1–AC3, R2.AC1.
      Done when: the tests fail on the existing implementation for the expected selection problem, use distinct record keys, and assert progress within two eligible flushes while pending stays full.

## 2. Make readiness queryable

- [x] 2.1 Add the local `readyAt` projection, the compound index, and a transactional backfill using the next unused schema version. Extend existing derived-index write hooks and their real-Dexie integration suite.
      Components: Scheduling projection.
      Requirements: R1.AC1–AC2, R4.AC1–AC2.
      Done when: new, migrated, and reopened databases expose missing-time and due rows; capture, deferral, retry, manual retry, and recovery writes keep the index current without changing operation data. Preserve the unrelated version-16 work.

## 3. Select and pack fairly

- [x] 3.1 Replace status-only reads with indexed eligible ranges. Interleave within the scan limit, run existing coalescing, then interleave winners before packing. Track the next status across actual attempts. Exclude the projection from request sizing and provider input; retain the capacity hook using indexed queue counts.
      Components: Eligible selector; Fair merge; Existing coalescer and push pipeline.
      Requirements: R1.AC1–AC3, R2.AC1–AC3, R3.AC1–AC3, R4.AC2.
      Done when: the sustained-backlog regression passes; neither group loses progress when count or bytes allow only one operation; a lone group uses full available capacity; generation/cooldown guards remain in place.

## 4. Check preservation and integration

- [x] 4.1 Add the remaining cases from the design: cross-status revision winners, due/deferred siblings, eligibility boundaries, bounded reads, and projection exclusion. Extend `sync-test-utils.ts` only as needed for existing mock-based suites; do not implement scheduling policy in the mock.
      Components: Regression tests and mapped docs; Existing coalescer and push pipeline.
      Requirements: R1.AC1–AC3, R2.AC1–AC3, R3.AC1–AC3, R4.AC1–AC3.
      Done when: tests assert actual pushed operation IDs/order and retained queue contents, and existing sync/retry/packing/recovery tests remain green.

## 5. Document and finish

- [x] 5.1 Update the mapped sync-layer and database-client documentation, refresh their `public/_documentation/docmap.json` entries, and refresh relevant provider README sync guidance per the root documentation policy. Run the final checks below, inspect the diff, and remove unnecessary abstractions.
      Components: Regression tests and mapped docs.
      Requirements: R4.AC3.
      Done when: documentation describes readiness, fairness, and the migration; verification passes or pre-existing failures are clearly separated; no unrelated changes are included.

During implementation, run only the affected test file after a coherent edit. For the final pass:

```bash
bun run test -- app/core/sync/__tests__ app/db/__tests__ shared/sync/__tests__
bun run type-check
bun run sync:outbox:benchmark
bun run check:docs
git diff --check
```

The broader database lane is warranted by the schema upgrade. Run the benchmark once; investigate any regression with a same-host baseline instead of relaxing its budget. These are implementation checks, not prerequisites for delivering this plan.

## Traceability Matrix

| Requirement | Design component | Tasks |
| --- | --- | --- |
| R1 | Scheduling projection; Eligible selector | 1.1, 2.1, 3.1, 4.1 |
| R2 | Fair merge | 1.1, 3.1, 4.1 |
| R3 | Existing coalescer and push pipeline | 3.1, 4.1 |
| R4 | Scheduling projection; Regression tests and mapped docs | 2.1, 3.1, 4.1, 5.1 |

## Definition of Done

All acceptance criteria pass, the verification commands are green, the traceability matrix has no gaps, and the final diff contains only the intended implementation and documentation. The decisive evidence is a due retry progressing while the pending window remains full; finite-queue drainage alone is insufficient.
