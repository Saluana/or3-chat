# OR3 Cloud Production Readiness Release Notes

Release notes for the production-readiness tranche covering sync casing normalization, background execution hardening, and documentation completion.

## Highlights

- Sync ingestion now accepts both camelCase and snake_case payload inputs, normalizing to snake_case.
- Background tool/workflow execution now emits structured logs with secret redaction.
- Added end-to-end harness/spec coverage for background reattachment and detached completion notification behavior.
- Published provider and operations documentation for default-stack deployment paths.

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

