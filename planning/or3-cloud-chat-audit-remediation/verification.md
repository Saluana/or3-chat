# Remediation verification record

Date: 2026-07-19

This record is the release evidence for the combined OR3 Cloud/chat audit. A
finding is closed only when its linked task is complete and the applicable
command below is green.

## Main application

| Command | Result |
|---|---|
| `bun run test` | Passed on the final tree: 327 files, 2,341 tests; 5 files/59 tests explicitly skipped by the existing suite. |
| `bun run type-check` | Passed. |
| `bun run check-imports` | Passed; no provider imports in core hot zones. |
| `git diff --check` | Passed in the app and all six provider repositories. |
| `bun run build` | Passed; SSR client and Nitro server completed, reporting 40 MB/11.7 MB gzip. |
| `bun run generate:static` | Passed and emitted `.output/public`. External font metadata was unavailable in the restricted network, but local output and documentation assets were verified present. |

## Provider packages

| Package | Tests | Type check | Build | Notes |
|---|---:|---:|---:|---|
| `or3-provider-basic-auth` | 27 passed; 10 loopback tests environment-blocked | Passed | Passed | The remaining endpoint-flow tests cannot bind `127.0.0.1` in the workspace sandbox (`EPERM`). The required escalation was rejected because the account approval service reported its usage limit. |
| `or3-provider-clerk` | 16 passed | Passed | Passed | Standalone Vue/SFC type shims were repaired before the green rerun. |
| `or3-provider-convex` | 122 passed | Passed | Passed | `build:templates` also passed; generated pack is 42,655 bytes. |
| `or3-provider-sqlite` | 90 passed | Passed | Passed | Seven test files. Three stale GC-message assertions were updated, then the entire matrix was rerun. |
| `or3-provider-fs` | 63 passed | Passed | Passed | Seven test files. |
| `or3-provider-s3` | 38 passed | Passed | Passed | Five test files. |

Provider commands were run from each package root:

```sh
bun run test
bun run type-check
bun run build
```

## Bounded-resource gates

The final gate command passed 41/41 tests across six files:

```sh
bun run test \
  app/core/sync/__tests__/snapshot-bootstrap.integration.test.ts \
  app/core/storage/__tests__/transfer-queue.test.ts \
  app/utils/chat/useAi-internal/__tests__/foregroundStream.test.ts \
  server/api/jobs/__tests__/stream.get.test.ts \
  server/utils/background-jobs/__tests__/viewers.test.ts \
  server/utils/background-jobs/__tests__/stream-handler.tools.test.ts
```

Measured limits/results:

- Snapshot fixtures keep SQLite/Convex page sizes bounded and apply every
  boundary revision once; provider suites also cover multi-page counts and
  fixed high-watermarks under concurrent writes.
- Download streaming aborts before storing bytes beyond the configured cap and
  preserves the verified MIME type.
- Each SSE viewer is capped at 256 KiB; the first event larger than remaining
  capacity is rejected and reconnect resumes from the durable offset.
- Multiple viewers create exactly one provider reconciler/poller.
- A 500-event foreground stream performs at most 10 durable writes; a 200-event
  reasoning-only stream performs at most four.
- A 500-event background stream performs at most 10 provider writes and retains
  the complete terminal transcript.
