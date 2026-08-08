# OR3 Cloud Production Readiness Release Notes

Release notes for the production-readiness tranche covering sync casing normalization, background execution hardening, and documentation completion.

> **Current code verdict: RELEASE CANDIDATE.** Production promotion still
> requires recorded staging, backup/restore, and rollback evidence from the
> [OR3 Cloud release checklist](./release-checklist).

## Highlights

- Sync ingestion now accepts both camelCase and snake_case payload inputs, normalizing to snake_case.
- Background tool/workflow execution now emits structured logs with secret redaction.
- Added end-to-end harness/spec coverage for background reattachment and detached completion notification behavior.
- Published provider and operations documentation for default-stack deployment paths.
- Managed remote Connect remains explicitly withheld until the Cloudflare/domain
  operator flow and disposable staging lifecycle are proved; local Intern is
  still supported independently.

## Included Changes

## Sync Layer

- Table payload schema preprocessing now handles camelCase input keys.
- Push ingestion normalizes validated payloads before forwarding to gateway adapters.
- Incoming payload normalization is aligned in sync payload normalizer paths.

## Background Execution

- Structured event logs for:
  - job start/failure
  - tool call receive/complete/error
  - workflow node lifecycle and HITL request points
  - notification emission failures
- Secret redaction on log payload fields and token-like strings.

## Chat Reliability

- Model-aware context budgeting reserves response capacity before requests are
  sent.
- Text, tool-call arguments, and tool-result identifiers count toward the
  request budget.
- The final budget is enforced after plugin request filters for send and
  continue flows.

## Storage and Workspace Reliability

- Recent workspace databases remain in the bounded LRU cache so in-flight
  operations are not interrupted by rapid workspace switching.
- Storage transfers interrupted by a workspace switch are requeued with their
  lease state cleared, including recovery after an underlying database is
  evicted.
- Download stream cancellation now propagates through the transfer lifecycle.
- The release gate runs deterministic auth, offline recovery, workspace race,
  and adapter fault browser harnesses.

## Deployment Reliability

- Added a provider-neutral staging canary runner with versioned JSON evidence
  for deep health, auth, sync, storage, background jobs, backup/restore,
  rollback, and rolling restarts.
- Added deterministic multi-instance tests proving that active sync and
  background work are asserted after an instance restart.
- Added fail-closed guards for memory background jobs, process-local viewer
  suppression assumptions, and undeclared SQLite/filesystem multi-instance
  topology.

## Documentation

- New provider docs:
  - `or3-provider-basic-auth`
  - `or3-provider-sqlite`
  - `or3-provider-fs`
- Added compatibility matrix, migration guide, deployment/operations guide.
- Hook catalog updated with notification hook entries.

## Known Limitations

- Multi-instance background viewer suppression remains process-local.
- E2E background harness scenarios are deterministic simulations; they do not replace full staged SSR integration tests with real provider backends.
- Migration from convex-backed canonical storage to sqlite may require explicit export/import validation depending on deployment history.

## Rollback Instructions

1. Restore previous release artifact and lockfile.
2. Revert environment to prior provider stack.
3. Redeploy and verify:
   - `GET /api/health`
   - auth session resolution
   - sync pull
   - storage read/write smoke checks
4. Restore previous provider data snapshots if necessary.

## Related

- [migration-default-stack](./migration-default-stack)
- [deployment-operations](./deployment-operations)
- [provider-compatibility-matrix](./provider-compatibility-matrix)
- [release-checklist](./release-checklist)
