# OR3 Cloud — Production Readiness Tasks

> **Legend**: P0 = blocking, P1 = critical infra, P2 = security hardening, P3 = follow-up
> 
> Tasks are ordered by priority and dependency. Complete P0 before P1, P1 before P2.

---

## P0 — Production Blockers

### 1. Fix or3-provider-fs critical bugs
> Requirements: 1.1, 1.2, 8.1, 8.2, 8.3

- [ ] 1.1 Fix `resolveFsObjectPath` to accept `sha256:<hex>` format — strip prefix, validate hex-only
- [ ] 1.2 Add SHA-256 integrity verification after upload body is received (compare actual digest to claimed hash)
- [ ] 1.3 Implement real GC — walk blob directory, check hash references, delete orphans with retention window
- [ ] 1.4 Add startup config validation — fail fast if `OR3_STORAGE_FS_ROOT` or `OR3_STORAGE_FS_TOKEN_SECRET` is missing
- [ ] 1.5 Bind presigned URLs to session identity — verify user matches on upload/download, not just token signature
- [ ] 1.6 Add server-side file size enforcement in upload handler (not just client-side)
- [ ] 1.7 Fix TTL parsing — validate bounds, reject NaN/0/negative values
- [ ] 1.8 Write regression tests for hash format handling (both `sha256:<hex>` and bare hex)
- [ ] 1.9 Write integration tests for upload → integrity verify → download → GC cycle
- [ ] 1.10 Write tests for startup validation failure modes

### 2. Fix or3-provider-sqlite critical bugs
> Requirements: 1.3, 1.4, 1.5

- [ ] 2.1 Add migration `004_workspace_isolation` — composite primary key `(workspace_id, id)` on all `s_*` tables
- [ ] 2.2 Update all `s_*` queries to include `workspace_id` in WHERE clauses
- [ ] 2.3 Fix tombstone upsert — add unique index on `(workspace_id, table_name, entity_id)`, use proper ON CONFLICT
- [ ] 2.4 Fix `getOrCreateUser` — use `INSERT OR IGNORE` + SELECT pattern for concurrency safety
- [ ] 2.5 Handle duplicate `op_id` in push batch — deduplicate instead of crashing transaction
- [ ] 2.6 Fix `removeWorkspace` to update `active_workspace_id` for ALL affected members
- [ ] 2.7 Fix `setActiveWorkspace` to reject soft-deleted workspaces
- [ ] 2.8 Add warning when `OR3_SQLITE_DB_PATH` falls back to `:memory:`
- [ ] 2.9 Write regression tests for multi-workspace entity isolation
- [ ] 2.10 Write regression tests for tombstone upsert idempotency
- [ ] 2.11 Write regression tests for concurrent user creation (parallel inserts)
- [ ] 2.12 Write tests for workspace deletion cascading effects

### 3. Fix or3-provider-basic-auth critical bugs
> Requirements: 1.6, 1.7, 1.8

- [ ] 3.1 Implement token refresh flow in client auth plugin (intercept 401, use refresh token, retry)
- [ ] 3.2 Add `/api/auth/basic/refresh` server endpoint if missing
- [ ] 3.3 Add concurrent refresh deduplication (single in-flight refresh promise)
- [ ] 3.4 Handle refresh token expiry — redirect to login
- [ ] 3.5 Add `algorithms: ['HS256']` to all `jwt.verify()` calls
- [ ] 3.6 Replace unbounded `Map` rate limiter with LRU-bounded store (match core pattern)
- [ ] 3.7 Use core's `normalizeProxyTrustConfig` + request identity helpers instead of hardcoded headers
- [ ] 3.8 Skip bootstrap bcrypt hash when account already exists
- [ ] 3.9 Write tests for full auth lifecycle: login → access → token expires → refresh → re-access
- [ ] 3.10 Write tests for refresh token expiry → forced logout
- [ ] 3.11 Write tests for concurrent refresh deduplication

### 4. Implement Auth UI provider agnosticism
> Requirements: 2.1

- [ ] 4.1 Create `AuthUiAdapter` interface in `shared/auth/`
- [ ] 4.2 Create `useAuthUiAdapter` composable with registry + resolver
- [ ] 4.3 Create fallback auth UI component (simple sign-in link / username display)
- [ ] 4.4 Update `SidebarAuthButton.vue` to resolve from adapter registry (remove Clerk hardcoding)
- [ ] 4.5 Update `or3-provider-clerk` to register its auth UI adapter via client plugin
- [ ] 4.6 Update `or3-provider-basic-auth` to register its auth UI adapter via client plugin
- [ ] 4.7 Write tests for adapter registration, selection, and fallback behavior

---

## P1 — Critical Production Infrastructure

### 5. Add health check endpoint
> Requirements: 3.1

- [ ] 5.1 Create `server/api/health.get.ts` — return `{ status, timestamp, uptime }`
- [ ] 5.2 Add optional deep mode (`?deep=true`) that checks provider connectivity
- [ ] 5.3 Ensure endpoint requires no authentication
- [ ] 5.4 Write tests for health endpoint response shape and deep mode

### 6. Implement graceful shutdown
> Requirements: 4.1

- [ ] 6.1 Create Nitro plugin `server/plugins/graceful-shutdown.ts`
- [ ] 6.2 Register SIGTERM + SIGINT handlers
- [ ] 6.3 Log active background jobs count on shutdown signal
- [ ] 6.4 Implement configurable drain timeout (default 15s)
- [ ] 6.5 Clean up admin rate limit interval (`clearInterval` / `.unref()`)
- [ ] 6.6 Test: server accepts no new connections after signal
- [ ] 6.7 Test: in-flight requests complete before exit

### 7. Add structured error handling
> Requirements: 5.1

- [ ] 7.1 Create Nitro error handler plugin (`server/plugins/error-handler.ts`)
- [ ] 7.2 Log errors as structured JSON (path, method, status, timestamp, message)
- [ ] 7.3 Exclude stack traces from HTTP responses in production
- [ ] 7.4 Remove stray `console.log` calls in server code (logout handler, admin rate limit cleanup, JWT auto-gen)
- [ ] 7.5 Test: 500 errors are logged with metadata, response is sanitized

### 8. Add Cache-Control to sensitive endpoints
> Requirements: 6.1

- [ ] 8.1 Create `setNoCacheHeaders(event)` utility in `server/utils/headers.ts`
- [ ] 8.2 Apply to sync push/pull endpoints
- [ ] 8.3 Apply to storage presign/upload/download endpoints
- [ ] 8.4 Verify auth session endpoint already has it (it does — just confirm)

---

## P2 — Security Hardening

### 9. Admin auth hardening
> Requirements: 7.1, 7.2, 7.3, 7.4

- [ ] 9.1 Refactor admin login handler — always run bcrypt (even on username miss) using dummy hash
- [ ] 9.2 Ensure login 401 response is identical for wrong username vs wrong password
- [ ] 9.3 Update `grant.post.ts` to require `superAdminOnly: true`
- [ ] 9.4 Update `revoke.post.ts` to require `superAdminOnly: true`
- [ ] 9.5 Hard-fail in production when `OR3_ADMIN_JWT_SECRET` is not set (no auto-gen)
- [ ] 9.6 Audit all admin endpoints — classify read-only vs mutation, apply super admin where needed
- [ ] 9.7 Document admin endpoint classification and role requirements
- [ ] 9.8 Write tests: constant-time login (both failure modes same timing/message)
- [ ] 9.9 Write tests: workspace admin gets 403 on grant/revoke
- [ ] 9.10 Write tests: production startup fails without JWT secret

### 10. Sync endpoint hardening
> Requirements: 9.1, 9.2

- [ ] 10.1 Change sync GC endpoints to require `workspace.admin` permission (not `workspace.write`)
- [ ] 10.2 Add rate limiting to sync GC endpoints
- [ ] 10.3 Gate `OR3_SYNC_BYPASS_RATE_LIMIT` to `NODE_ENV === 'development'` only
- [ ] 10.4 Write tests for GC authorization escalation
- [ ] 10.5 Write tests for GC rate limiting

### 11. Auth auto-provisioning control
> Requirements: 10.1

- [ ] 11.1 Add `OR3_AUTH_AUTO_PROVISION` env var (default `true`)
- [ ] 11.2 When `false`, `resolveSession` returns "unauthorized" for unknown provider users
- [ ] 11.3 Return clear "registration disabled" error message
- [ ] 11.4 Document the env var and its behavior
- [ ] 11.5 Write tests for both provisioning modes

---

## P3 — Follow-up & Polish

### 12. Quick production fixes
> Requirements: 11, 12, 20

- [ ] 12.1 Gate Nuxt DevTools on `NODE_ENV !== 'production'` in `nuxt.config.ts`
- [ ] 12.2 Add `Access-Control-Max-Age: 3600` to CORS preflight response
- [ ] 12.3 Fix password validation consistency — wizard minimum to 12 chars (match admin)
- [ ] 12.4 Remove dead code: circuit breaker unreachable `return false`, unused `trackAuthorization` call

### 13. Configurable hardcoded values
> Requirements: 15

- [ ] 13.1 Make MIME type allowlist configurable via runtime config
- [ ] 13.2 Make rate limit thresholds overridable via runtime config
- [ ] 13.3 Make GC retention period configurable via runtime config
- [ ] 13.4 Make OpenRouter URL configurable for proxy setups
- [ ] 13.5 Make background job timeout configurable
- [ ] 13.6 Document all new config options

### 14. Per-user resource limits
> Requirements: 13

- [ ] 14.1 Add per-user background job concurrency limit (configurable, default 5)
- [ ] 14.2 Add per-workspace storage quota enforcement (configurable, optional)
- [ ] 14.3 Write tests for per-user job limiting
- [ ] 14.4 Write tests for storage quota rejection

### 15. Wire schema casing normalization
> Requirements: 14

- [ ] 15.1 Update sync schema validation to accept both camelCase and snake_case
- [ ] 15.2 Normalize to snake_case on ingestion
- [ ] 15.3 Write tests for both input shapes

### 16. Complete background jobs execution plan
> Requirements: from background-jobs-execution/tasks.md

- [ ] 16.1 Add structured logging for background tool/workflow execution with secret redaction
- [ ] 16.2 Add E2E tests for reattachment flow and notification emission

### 17. Documentation
> Requirements: 16

- [ ] 17.1 Write provider docs: or3-provider-basic-auth
- [ ] 17.2 Write provider docs: or3-provider-sqlite
- [ ] 17.3 Write provider docs: or3-provider-fs
- [ ] 17.4 Create provider compatibility matrix
- [ ] 17.5 Write migration guide (Clerk+Convex → default stack)
- [ ] 17.6 Write deployment/operations guide (env vars, scaling, monitoring, health checks)
- [ ] 17.7 Add notification hooks to hook catalog
- [ ] 17.8 Update `docmap.json` with new pages
- [ ] 17.9 Write release notes with limitations and rollback instructions

### 18. Notification center verification
> Requirements: 17

- [ ] 18.1 Manual test: bell badge shows correct unread count
- [ ] 18.2 Manual test: click notification marks as read
- [ ] 18.3 Manual test: "Mark all as read" and "Clear all" work
- [ ] 18.4 Manual test: background streaming completion → notification
- [ ] 18.5 Manual test: sync conflict → notification
- [ ] 18.6 Manual test: system warning → notification
- [ ] 18.7 Multi-tab sync of notification state (if sync enabled)

### 19. Default SSR provider core integration
> Requirements: from default-ssr-providers/tasks.md

- [ ] 19.1 Update wizard defaults to basic-auth + sqlite + fs
- [ ] 19.2 Keep legacy preset (clerk + convex) selectable in wizard
- [ ] 19.3 Validate generated provider module file includes selected IDs only
- [ ] 19.4 Build matrix verification: zero providers, default stack, legacy stack
- [ ] 19.5 Runtime matrix verification: basic-auth+sqlite+fs, clerk+convex
- [ ] 19.6 Switch wizard-recommended preset to default stack
- [ ] 19.7 Publish migration guide

### 20. Sidebar & completed plan cleanup
> Requirements: from sidebar-homepage and other completed plans

- [ ] 20.1 Delete `SidebarVirtualList.vue` and remove virtua import
- [ ] 20.2 Update `SideNavContent.test.ts` for new components
- [ ] 20.3 Accessibility pass on sidebar (ARIA labels, keyboard navigation)
- [ ] 20.4 Performance profile with 500+ items

### 21. Load testing
> Requirements: from default-ssr-providers hardening tasks

- [ ] 21.1 Create load test script for SQLite push/pull under concurrent workspace load
- [ ] 21.2 Create large-file upload/download stress test for FS provider
- [ ] 21.3 Verify background job concurrency under sustained load
- [ ] 21.4 Profile memory usage under extended operation (rate limiter, caches, tombstones)

---

## Summary

| Priority | Tasks | Estimated Effort |
|----------|-------|-----------------|
| **P0 — Blockers** | 42 tasks across 4 sections | ~3–4 days |
| **P1 — Infra** | 18 tasks across 4 sections | ~1–2 days |
| **P2 — Security** | 16 tasks across 3 sections | ~1–2 days |
| **P3 — Follow-up** | 51 tasks across 10 sections | ~3–5 days |
| **Total** | **127 tasks** | **~8–13 days** |

### Recommended execution order

1. **P0.1–P0.3** (provider bugs) — unblocks default-stack deployments
2. **P0.4** (auth UI) — unblocks non-Clerk deployments
3. **P1.5–P1.8** (health, shutdown, errors, cache) — production plumbing
4. **P2.9–P2.11** (admin + sync hardening) — security posture
5. **P3.12** (quick fixes) — low-hanging fruit, can interleave
6. **P3.13–P3.21** (config, docs, testing) — post-launch hardening
