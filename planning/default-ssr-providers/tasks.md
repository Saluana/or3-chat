# tasks.md

artifact_id: 83624487-1502-4840-a833-22d0a3e74e0a

## 0. Preflight and Guardrails

- [ ] Confirm target defaults are `basic-auth` + `sqlite` + `fs` for SSR wizard flows
  - Requirements: 5.1
- [ ] Confirm legacy preset remains `clerk` + `convex` + `convex`
  - Requirements: 5.1, 6.1
- [ ] Add/refresh banned-import checks to ensure core hot zones stay provider-SDK free
  - Requirements: 1.1, 1.2
- [ ] Capture baseline test/type-check/build output before implementation
  - Requirements: 6.1, 8.1

## 1. Core Integration Updates

### 1.1 Provider IDs, defaults, and metadata

- [ ] Update provider defaults in shared provider constants (`basic-auth`, `sqlite`, `fs`)
  - Requirements: 1.2, 5.1
- [ ] Add new provider IDs to config metadata and docs metadata surfaces
  - Requirements: 5.2, 7.1
- [ ] Ensure strict-mode validation messages include install guidance for new provider IDs
  - Requirements: 1.1, 1.2

### 1.2 Remove auth UI hardcoding

- [ ] Introduce `AuthUiAdapter` client registry and resolver
  - Requirements: 2.2, 6.2
- [ ] Replace `SidebarAuthButtonClerk` core dependency with provider-agnostic auth-ui renderer
  - Requirements: 2.2, 6.2
- [ ] Add safe fallback/no-provider auth UI adapter
  - Requirements: 1.1, 6.2
- [ ] Add unit tests for adapter registration, selection, and fallback behavior
  - Requirements: 8.1

### 1.3 Existing provider compatibility hardening

- [ ] Patch `or3-provider-convex` store paths to avoid hardcoded `provider='clerk'` assumptions
  - Requirements: 6.1
- [ ] Patch `or3-provider-clerk` auth-ui registration to work via adapter boundary
  - Requirements: 6.1, 6.2
- [ ] Validate legacy stack e2e smoke still passes
  - Requirements: 6.1, 8.2

## 2. Build `or3-provider-basic-auth`

### 2.1 Package scaffolding

- [ ] Initialize package structure and Nuxt module entry (`or3-provider-basic-auth/nuxt`)
  - Requirements: 1.1, 2.1
- [ ] Add package scripts (`build`, `type-check`, `test`) using Bun
  - Requirements: 1.1, 8.1
- [ ] Add runtime type shims and README skeleton
  - Requirements: 7.1

### 2.2 Server auth implementation

- [ ] Implement `basic-auth` `AuthProvider.getSession(event)`
  - Requirements: 2.1, 2.4
- [ ] Implement secure JWT mint/verify helpers (access token)
  - Requirements: 2.3
- [ ] Implement refresh token issuance/rotation/revocation
  - Requirements: 2.3
- [ ] Implement cookie management helpers (set/clear with secure flags)
  - Requirements: 2.3

### 2.3 Basic auth endpoints

- [ ] Implement `sign-in` endpoint (credential verify + session issue)
  - Requirements: 2.1, 2.3
- [ ] Implement `sign-out` endpoint (session revoke + cookie clear)
  - Requirements: 2.1, 2.3
- [ ] Implement `refresh` endpoint
  - Requirements: 2.3
- [ ] Implement `change-password` endpoint (current password verify + rotate sessions)
  - Requirements: 2.2, 2.3

### 2.4 Credential/session persistence

- [ ] Implement provider-local credential DB schema and migration bootstrap
  - Requirements: 2.3
- [ ] Add account/session repositories with safe error handling and redaction
  - Requirements: 2.3, 9.2
- [ ] Add configurable DB path and secret env parsing
  - Requirements: 5.2

### 2.5 Auth token broker

- [ ] Implement `ProviderTokenBroker` for `basic-auth`
  - Requirements: 2.4
- [ ] Define behavior for provider-token requests without template support
  - Requirements: 2.4
- [ ] Add tests for broker resolution and fallback behavior
  - Requirements: 8.1

### 2.6 Basic auth UI components

- [ ] Implement sign-in modal component using Nuxt UI primitives
  - Requirements: 2.2
- [ ] Implement signed-in account button/popover with logout
  - Requirements: 2.2
- [ ] Implement change-password modal
  - Requirements: 2.2
- [ ] Register provider auth-ui adapter from client plugin
  - Requirements: 2.2, 6.2
- [ ] Add component-level tests for visible states and action flows
  - Requirements: 8.1

### 2.7 Basic auth tests

- [ ] Unit tests: password hashing, JWT verification, expiry, refresh rotation, revoke
  - Requirements: 2.3, 8.1
- [ ] Integration tests: `/api/auth/session` with basic-auth + sync store registration
  - Requirements: 2.4, 8.2
- [ ] Security tests: invalid signature, expired token, replayed refresh token
  - Requirements: 2.3, 8.1

## 3. Build `or3-provider-sqlite`

### 3.1 Package scaffolding and DB runtime

- [x] Initialize package structure and Nuxt module entry (`or3-provider-sqlite/nuxt`)
  - Requirements: 1.1, 3.1
- [x] Add Kysely runtime with SQLite dialect and connection lifecycle management
  - Requirements: 3.1
- [x] Add migration runner and versioned migrations
  - Requirements: 3.1

### 3.2 Schema and indexes

- [x] Create auth/workspace tables (`users`, `auth_accounts`, `workspaces`, `workspace_members`)
  - Requirements: 3.1
- [x] Create sync infra tables (`server_version_counter`, `change_log`, `device_cursors`, `tombstones`)
  - Requirements: 3.2, 3.3
- [x] Create synced data tables aligned to wire schema naming
  - Requirements: 3.2
- [x] Add required indexes for pull windows, op idempotency, and workspace membership lookups
  - Requirements: 3.2, 9.1

### 3.3 AuthWorkspaceStore implementation

- [x] Implement `getOrCreateUser` with provider identity mapping
  - Requirements: 3.1
- [x] Implement `getOrCreateDefaultWorkspace`
  - Requirements: 3.1
- [x] Implement `getWorkspaceRole`
  - Requirements: 3.1
- [x] Implement workspace CRUD methods used by `/api/workspaces/*`
  - Requirements: 3.1

### 3.4 SyncGatewayAdapter implementation

- [x] Implement `push` with op validation, idempotency, contiguous `server_version` allocation, and LWW
  - Requirements: 3.2
- [x] Implement `pull` with cursor + limit + table filter support
  - Requirements: 3.2
- [x] Implement `updateCursor`
  - Requirements: 3.3
- [x] Implement `gcTombstones` and `gcChangeLog`
  - Requirements: 3.3
- [x] Register adapter/store in Nitro plugin
  - Requirements: 3.1

### 3.5 Optional admin adapters

- [ ] Implement sync health/GC admin adapter capabilities
  - Requirements: 9.2
- [ ] Register admin adapter conditionally when admin module enabled
  - Requirements: 9.2

### 3.6 SQLite tests

- [x] Unit tests: server_version allocation under concurrent push calls
  - Requirements: 3.2, 8.1
- [x] Unit tests: op_id idempotency and duplicate push replay
  - Requirements: 3.2, 8.1
- [x] Unit tests: LWW + HLC tie-break behavior
  - Requirements: 3.2, 8.1
- [x] Unit tests: GC eligibility with min device cursor and retention windows
  - Requirements: 3.3, 8.1
- [ ] Integration tests: gateway sync endpoints end-to-end with sqlite adapter
  - Requirements: 3.2, 8.2
- [ ] Integration tests: workspace CRUD endpoints with sqlite store
  - Requirements: 3.1, 8.2

## 4. Build `or3-provider-fs`

### 4.1 Package scaffolding

- [ ] Initialize package structure and Nuxt module entry (`or3-provider-fs/nuxt`)
  - Requirements: 1.1, 4.1
- [ ] Add provider README and env contract
  - Requirements: 7.1

### 4.2 Storage adapter implementation

- [ ] Implement `presignUpload` returning short-lived signed internal URL
  - Requirements: 4.1, 4.2
- [ ] Implement `presignDownload` returning short-lived signed internal URL
  - Requirements: 4.1, 4.2
- [ ] Implement optional `commit` behavior aligned with current metadata flow
  - Requirements: 4.1
- [ ] Implement `gc` behavior for stale/orphaned files
  - Requirements: 4.3
- [ ] Register storage adapter in Nitro plugin
  - Requirements: 4.1

### 4.3 Upload/download endpoint implementation

- [ ] Implement upload endpoint with token verification, authz checks, MIME/size checks, atomic write
  - Requirements: 4.2
- [ ] Implement download endpoint with token verification, authz checks, stream response
  - Requirements: 4.2
- [ ] Implement path normalization and traversal protections
  - Requirements: 4.2

### 4.4 FS tests

- [ ] Unit tests: token sign/verify, expiry, tamper detection
  - Requirements: 4.2, 8.1
- [ ] Unit tests: path traversal rejection
  - Requirements: 4.2, 8.1
- [ ] Integration tests: presign -> upload -> commit -> presign-download -> download
  - Requirements: 4.1, 8.2
- [ ] Integration tests: GC logic vs retention and references
  - Requirements: 4.3, 8.2

## 5. Wizard and Setup Defaults

### 5.1 Update wizard provider catalog and defaults

- [ ] Update wizard design/implementation defaults to `basic-auth` + `sqlite` + `fs`
  - Requirements: 5.1
- [ ] Keep legacy Clerk+Convex preset as selectable option
  - Requirements: 5.1, 6.1
- [ ] Ensure generated provider module file includes selected provider module IDs only
  - Requirements: 1.2, 5.1

### 5.2 Setup/env validation updates

- [ ] Add env metadata/validation for basic-auth, sqlite, and fs provider keys
  - Requirements: 5.2
- [ ] Ensure strict-mode startup errors are actionable for new providers
  - Requirements: 1.1, 5.2

## 6. Documentation

- [ ] Add dedicated docs page for `or3-provider-basic-auth`
  - Requirements: 7.1
- [ ] Add dedicated docs page for `or3-provider-sqlite`
  - Requirements: 7.1
- [ ] Add dedicated docs page for `or3-provider-fs`
  - Requirements: 7.1
- [ ] Update provider overview docs with compatibility/default matrix
  - Requirements: 7.1, 6.1
- [ ] Add provider-authoring doc updates for new auth-ui adapter boundary and required registries
  - Requirements: 7.2
- [ ] Update `public/_documentation/docmap.json` references for all new docs
  - Requirements: 7.1

## 7. Compatibility and Regression Verification

### 7.1 Build matrix

- [ ] Verify `bun run type-check` and `bun run build` with zero providers installed (local-only mode)
  - Requirements: 1.1, 8.2
- [ ] Verify build/type-check with new default stack installed
  - Requirements: 1.1, 8.2
- [ ] Verify build/type-check with legacy Clerk+Convex stack installed
  - Requirements: 6.1, 8.2

### 7.2 Runtime matrix

- [ ] Basic-auth + sqlite + fs full smoke (auth/session/workspaces/sync/storage)
  - Requirements: 2.1, 3.1, 4.1, 8.2
- [ ] Clerk + convex + convex full smoke
  - Requirements: 6.1, 8.2
- [ ] Mixed stack smoke: basic-auth + convex + convex
  - Requirements: 6.1, 8.2
- [ ] Mixed stack smoke: clerk + sqlite + fs
  - Requirements: 6.1, 8.2

## 8. Hardening and Performance

- [ ] Add load test script for SQLite push/pull throughput and cursor progression
  - Requirements: 9.1
- [ ] Add large-file upload/download stress test for fs provider
  - Requirements: 9.1
- [ ] Validate no hot-path token/session secret logs
  - Requirements: 2.3, 9.2
- [ ] Validate admin operations/reporting surfaces for sqlite/fs providers
  - Requirements: 9.2

## 9. Final Cutover and Release Notes

- [ ] Switch wizard-recommended preset to new default stack in release branch
  - Requirements: 5.1
- [ ] Publish migration guide from Clerk+Convex defaults to BasicAuth+SQLite+FS defaults
  - Requirements: 6.1, 7.1
- [ ] Add release notes section with known limitations, required env vars, and rollback path
  - Requirements: 6.1, 7.1

