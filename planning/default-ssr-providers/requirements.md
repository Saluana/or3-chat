# requirements.md

artifact_id: 9ee13096-b206-4b52-a2a8-8f20d2c7a3b1

## Overview

Create three new provider packages that can replace Clerk + Convex as the default SSR stack while preserving current OR3 Cloud behavior and extension patterns:

1. `or3-provider-basic-auth` (JWT auth + basic account UI)
2. `or3-provider-fs` (filesystem-backed storage gateway)
3. `or3-provider-sqlite` (SQLite-backed sync + canonical workspace store using Kysely)

The implementation must keep existing Clerk/Convex support working, keep static builds unchanged, and keep core provider-agnostic.

## Roles

- Instance Operator: installs providers and configures SSR deployment.
- End User: signs in, manages account, syncs chats/files across devices.
- OR3 Maintainer: develops and ships new providers without patching core hot zones.

## Requirements

### 1. Provider Packaging and Discovery

1.1 As an Instance Operator, I want provider packages to be installable independently, so that OR3 compiles with zero Clerk/Convex dependencies.

- WHEN no cloud providers are installed THEN core SHALL still type-check and build in local-only mode.
- WHEN a provider is selected in cloud config THEN Nuxt SHALL load `or3-provider-<id>/nuxt` only if installed.
- WHEN a configured provider package is missing THEN startup SHALL fail in strict mode with install guidance.

1.2 As an OR3 Maintainer, I want config-driven provider loading, so that core stays free of hardcoded provider modules.

- WHEN `auth.provider`, `sync.provider`, or `storage.provider` changes THEN module resolution SHALL derive from provider IDs.
- WHEN providers are changed via wizard THEN only generated provider module config SHALL need regeneration.
- Core SHALL not import provider SDKs in `app/pages/**`, `app/plugins/**`, `server/api/**`, `server/middleware/**`, or `server/plugins/**`.

### 2. Basic Auth Provider (`or3-provider-basic-auth`)

2.1 As an End User, I want password-based sign-in/sign-out, so that I can use SSR auth without Clerk.

- WHEN valid credentials are submitted THEN the provider SHALL create a secure authenticated session.
- WHEN credentials are invalid THEN the provider SHALL reject with a safe error and no secret leakage.
- WHEN user signs out THEN session cookies and refresh state SHALL be invalidated.

2.2 As an End User, I want account self-service UI comparable to current Clerk usage, so that no auth UX regresses.

- Provider SHALL expose UI components that satisfy current usage patterns: signed-in state, signed-out state, sign-in modal trigger, user popover/menu, and change-password modal.
- WHEN auth provider is not Basic Auth THEN these components SHALL not break rendering or hydration.
- WHEN auth is disabled THEN auth UI SHALL gracefully no-op.

2.3 As a Security Reviewer, I want secure JWT and password handling, so that Basic Auth is production-safe.

- Access tokens SHALL be short-lived and validated server-side.
- Refresh/session revocation SHALL be supported.
- Passwords SHALL be stored as strong hashes (never plaintext) with constant-time comparison.
- Cookies SHALL use secure flags appropriate for environment (HttpOnly, SameSite, Secure in production).

2.4 As a Systems Engineer, I want Basic Auth to integrate with existing SSR auth boundaries, so that authorization and session semantics are unchanged.

- `can()` SHALL remain the only authorization gate for SSR endpoints.
- `resolveSessionContext()` SHALL work via registered `AuthProvider` and selected `AuthWorkspaceStore`.
- Provider SHALL register a `ProviderTokenBroker` implementation (or explicit null-token behavior) without hardcoded Clerk calls in core.

### 3. SQLite Sync Provider (`or3-provider-sqlite`)

3.1 As an Instance Operator, I want a lightweight sync backend, so that OR3 can run self-hosted without Convex.

- Provider SHALL implement `SyncGatewayAdapter` and `AuthWorkspaceStore` using SQLite.
- Provider SHALL use Kysely as the query builder.
- Provider SHALL support workspace CRUD paths currently served through `/api/workspaces/*`.

3.2 As a Multi-Device User, I want sync semantics to match existing behavior, so that no data ordering/regression occurs.

- Sync wire schema SHALL remain snake_case aligned with Dexie payloads.
- `server_version` SHALL be a single monotonic cursor per workspace.
- Message ordering SHALL preserve `index` + `order_key` semantics.
- Outbox idempotency SHALL be preserved via `op_id` handling.

3.3 As an Operator, I want retention and GC behavior equivalent to current cloud sync, so that storage does not grow unbounded.

- Device cursor tracking SHALL gate change-log GC eligibility.
- Tombstone and change-log retention SHALL use a configurable retention window.
- Remote-applied writes SHALL not be re-enqueued by client capture hooks.

### 4. FS Storage Provider (`or3-provider-fs`)

4.1 As an End User, I want uploads/downloads to remain local-first and queued, so that file UX matches current storage behavior.

- Provider SHALL implement `StorageGatewayAdapter` compatible with existing transfer queue.
- Presign responses SHALL be short-lived and authorized.
- Transfer state SHALL remain local-only in `file_transfers`.

4.2 As a Security Reviewer, I want filesystem storage endpoints to be safe, so that uploaded files cannot be abused.

- Upload/download access SHALL require valid signed tokens and `can()` authorization.
- Tokens SHALL encode workspace scope and expiry.
- Path traversal and MIME/size bypasses SHALL be rejected.

4.3 As an Operator, I want GC and retention for orphaned blobs, so that disk usage remains bounded.

- Provider SHALL support `gc` behavior for deleted/unreferenced files under retention policy.
- `ref_count` SHALL remain derived behavior and not become LWW-synced state.

### 5. Wizard Defaults and Configuration

5.1 As an Instance Operator, I want setup defaults to use the new provider trio, so that first-run SSR setup avoids Convex/Clerk.

- Wizard default SSR selection SHALL become:
  - `AUTH_PROVIDER=basic-auth`
  - `OR3_SYNC_PROVIDER=sqlite`
  - `NUXT_PUBLIC_STORAGE_PROVIDER=fs`
- Generated provider module list SHALL include the matching provider modules.
- Existing Clerk+Convex presets SHALL remain available as non-default options.

5.2 As an Operator, I want predictable env/config keys, so that migration is low-risk.

- New providers SHALL define explicit env variable contracts.
- Admin config metadata SHALL include labels/descriptions for new provider env keys.
- Existing env keys for Clerk/Convex SHALL remain valid.

### 6. Backward Compatibility and Non-Breaking Behavior

6.1 As an OR3 Maintainer, I want zero regression for existing deployments, so that upgrades are safe.

- Clerk+Convex deployments SHALL continue working without behavior regressions.
- BYOK/OpenRouter flow SHALL remain unchanged.
- Static mode behavior SHALL remain unchanged (SSR auth gated off).

6.2 As a Developer, I want provider-specific UI/runtime warnings to disappear when provider is not selected, so that runtime logs stay clean.

- Core SHALL not render provider-only components unless the active auth provider supplies them.
- Missing provider packages SHALL produce clear boot-time diagnostics rather than runtime component resolution warnings.

### 7. Documentation

7.1 As an Instance Operator, I want dedicated setup docs for each new provider, so that install and troubleshooting are straightforward.

- Docs SHALL include install, env vars, runtime registrations, common errors, and migration notes for:
  - `or3-provider-basic-auth`
  - `or3-provider-sqlite`
  - `or3-provider-fs`
- Cloud provider overview docs SHALL list supported combinations and default wizard stack.

7.2 As an Integrator, I want provider-authoring guidance, so that future providers follow the same contract.

- Docs SHALL cover required registries, adapter interfaces, and testing expectations.

### 8. Testing and Verification

8.1 As a Maintainer, I want comprehensive automated coverage, so that provider rollout is safe.

- Unit tests SHALL cover JWT/session edge cases, password rotation, token expiry, and auth UI visibility logic.
- Unit tests SHALL cover SQLite sync invariants: idempotency, order_key ordering, single cursor behavior, GC eligibility.
- Unit tests SHALL cover FS token validation, path safety, and presign expiry.

8.2 As a Maintainer, I want integration and E2E verification, so that real workflows are validated.

- Integration tests SHALL validate full push/pull cycles, workspace CRUD, file upload/download/commit/GC.
- E2E matrix SHALL include multi-device sync, offline recovery, auth gating, and provider combinations.
- Build/type-check matrix SHALL include zero-provider mode and non-Convex/non-Clerk SSR mode.

### 9. Performance and Operational Requirements

9.1 As an Operator, I want lightweight defaults, so that self-hosted deployments run efficiently.

- SQLite provider SHALL avoid unbounded in-memory buffering and use indexed queries for cursor windows.
- FS provider SHALL stream file IO and avoid loading large blobs into memory on server paths.
- Basic Auth SHALL avoid hot-path database round trips where token validation can be local and safe.

9.2 As a Maintainer, I want observability and operability, so that incidents are diagnosable.

- Providers SHALL emit structured logs with safe redaction.
- Admin adapters/capabilities SHALL be defined for SQLite sync and FS storage where applicable.

