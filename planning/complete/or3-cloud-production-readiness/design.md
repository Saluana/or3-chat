# OR3 Cloud — Production Readiness Design

## Overview

This design document describes the technical approach for resolving all production-blocking issues and shipping OR3 Cloud safely. It is organized by workstream, each addressing a cluster of related requirements.

The design prioritizes **minimal, targeted fixes** — not rewrites. Most infrastructure is already solid; the work is about closing gaps in the default-stack providers, adding standard production plumbing, and completing security hardening.

---

## Workstream 1: Default-Stack Provider Bug Fixes

### 1.1 FS Provider — Hash Format + Integrity

**Problem**: `resolveFsObjectPath` rejects the canonical `sha256:<hex>` format because `:` is not path-safe. Uploads are not verified against claimed hash.

**Fix**:

```typescript
// runtime/server/utils/fs-path.ts
export function resolveFsObjectPath(root: string, hash: string): string {
  // Normalize canonical format: "sha256:<hex>" → strip prefix
  const hex = hash.startsWith('sha256:') ? hash.slice(7) : hash
  
  // Validate hex-only
  if (!/^[a-f0-9]{64}$/i.test(hex)) {
    throw createError({ statusCode: 400, message: 'Invalid hash format' })
  }
  
  // 2-level directory sharding: ab/cd/abcdef...
  const dir = join(root, hex.slice(0, 2), hex.slice(2, 4))
  return join(dir, hex)
}
```

**Integrity verification** — after receiving the upload body:

```typescript
import { createHash } from 'node:crypto'

async function verifyUploadIntegrity(body: Buffer, expectedHash: string): Promise<void> {
  const hex = expectedHash.startsWith('sha256:') ? expectedHash.slice(7) : expectedHash
  const actual = createHash('sha256').update(body).digest('hex')
  if (actual !== hex) {
    throw createError({ statusCode: 422, message: 'Upload integrity check failed' })
  }
}
```

**Requirement coverage**: 1.1, 1.2 (partial — integrity)

### 1.2 FS Provider — GC Implementation

**Problem**: `gc()` is a stub returning `{ deleted_count: 0 }`.

**Fix**: Implement a walk-and-check approach:
1. Walk the blob directory tree
2. For each blob file, check if any `file_metadata` record references its hash
3. Delete unreferenced blobs
4. Apply a configurable retention window (default 30 days) — don't delete blobs newer than the window

This requires the FS provider to either accept a callback for "is hash referenced" or query the sync store directly. Since the GC endpoint already receives workspace context, pass a `isHashReferenced(hash): Promise<boolean>` from the storage gateway.

**Requirement coverage**: 1.2

### 1.3 SQLite — Workspace Isolation

**Problem**: Materialized `s_*` tables use `id` as primary key globally. Two workspaces with the same entity ID collide.

**Fix**: Make the primary key a composite of `(workspace_id, id)`:

```sql
-- Migration 004_workspace_isolation
ALTER TABLE s_threads RENAME TO s_threads_old;
CREATE TABLE s_threads (
  workspace_id TEXT NOT NULL,
  id TEXT NOT NULL,
  -- ... all existing columns ...
  PRIMARY KEY (workspace_id, id)
);
INSERT INTO s_threads SELECT workspace_id, id, ... FROM s_threads_old;
DROP TABLE s_threads_old;
-- Repeat for s_messages, s_projects, s_attachments, s_kv
```

All queries against `s_*` tables must include `workspace_id` in WHERE clauses.

**Requirement coverage**: 1.3

### 1.4 SQLite — Tombstone Upsert

**Problem**: Tombstone insert uses a random UUID as `op_id` with `ON CONFLICT(op_id)` — the conflict never triggers, causing unbounded tombstone growth.

**Fix**: Use `ON CONFLICT(workspace_id, table_name, entity_id)` with a unique index on those columns:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_tombstones_entity 
  ON sync_tombstones(workspace_id, table_name, entity_id);
```

Then the upsert becomes:

```typescript
db.prepare(`
  INSERT INTO sync_tombstones (op_id, workspace_id, table_name, entity_id, deleted_at, server_version)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(workspace_id, table_name, entity_id) DO UPDATE SET
    deleted_at = excluded.deleted_at,
    server_version = excluded.server_version,
    op_id = excluded.op_id
`).run(opId, workspaceId, tableName, entityId, deletedAt, serverVersion)
```

**Requirement coverage**: 1.4

### 1.5 SQLite — Concurrent User Creation

**Problem**: Read-then-insert race in `getOrCreateUser`.

**Fix**: Use `INSERT ... ON CONFLICT DO NOTHING` followed by a SELECT:

```typescript
async getOrCreateUser(providerUserId: string, email: string) {
  return db.transaction(() => {
    db.prepare(`
      INSERT OR IGNORE INTO users (id, provider_user_id, email, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(newId(), providerUserId, email, now(), now())
    
    return db.prepare(`SELECT * FROM users WHERE provider_user_id = ?`).get(providerUserId)
  })()
}
```

**Requirement coverage**: 1.5

### 1.6 Basic-Auth — Refresh Flow

**Problem**: The client plugin never attempts token refresh. Users are silently logged out after access TTL (15min).

**Fix**: Add a refresh interceptor in the client auth plugin:

```typescript
// Pseudo-code for the refresh flow
let refreshPromise: Promise<void> | null = null

async function ensureValidToken(): Promise<string | null> {
  const token = getStoredAccessToken()
  if (token && !isExpiringSoon(token, 60_000)) return token
  
  // Deduplicate concurrent refresh attempts
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => { refreshPromise = null })
  }
  await refreshPromise
  return getStoredAccessToken()
}

async function doRefresh(): Promise<void> {
  const refreshToken = getStoredRefreshToken()
  if (!refreshToken) { logout(); return }
  
  const res = await $fetch('/api/auth/basic/refresh', {
    method: 'POST',
    body: { refresh_token: refreshToken }
  })
  storeTokens(res.access_token, res.refresh_token)
}
```

Also add a `/api/auth/basic/refresh` server endpoint if it doesn't exist.

**Requirement coverage**: 1.6

### 1.7 Basic-Auth — JWT Algorithm + Rate Limiter

- **JWT**: Add `algorithms: ['HS256']` to all `jwt.verify()` calls.
- **Rate limiter**: Replace the bare `Map` with an LRU-bounded map (reuse the `LRUMap` pattern from core's rate limiter).

**Requirement coverage**: 1.7, 1.8

---

## Workstream 2: Auth UI Provider Agnosticism

### Design

Create an `AuthUiAdapter` client-side registry following the same pattern as server-side registries:

```typescript
// shared/auth/auth-ui-adapter.ts
export interface AuthUiAdapter {
  /** Component to render in the sidebar for auth */
  component: Component
  /** Display name for the auth provider */
  displayName: string
}

// app/composables/useAuthUiAdapter.ts
const registry = shallowRef<AuthUiAdapter | null>(null)

export function registerAuthUiAdapter(adapter: AuthUiAdapter) {
  registry.value = adapter
}

export function useAuthUiAdapter(): Ref<AuthUiAdapter | null> {
  return registry
}
```

Update `SidebarAuthButton.vue` to resolve from registry:

```vue
<template>
  <component :is="adapter?.component ?? FallbackAuthButton" />
</template>
```

Each provider registers its adapter via a client plugin:
- `or3-provider-clerk`: registers `SidebarAuthButtonClerk`
- `or3-provider-basic-auth`: registers `BasicAuthLoginButton`
- Fallback: renders a simple "Sign in" link or username display

**Requirement coverage**: 2.1

---

## Workstream 3: Production Infrastructure

### 3.1 Health Check Endpoint

```typescript
// server/api/health.get.ts
export default defineEventHandler(async (event) => {
  const deep = getQuery(event).deep === 'true'
  
  const result: Record<string, unknown> = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  }
  
  if (deep) {
    result.providers = await checkProviderHealth()
  }
  
  return result
})
```

No auth required. Returns 200 when process is alive. Deep mode checks provider connectivity (sync store ping, storage provider ping).

**Requirement coverage**: 3.1

### 3.2 Graceful Shutdown

Add a Nitro plugin that registers shutdown handlers:

```typescript
// server/plugins/graceful-shutdown.ts
export default defineNitroPlugin((nitro) => {
  const shutdownTimeout = 15_000 // 15 seconds
  let isShuttingDown = false
  
  async function shutdown(signal: string) {
    if (isShuttingDown) return
    isShuttingDown = true
    console.info(`[shutdown] Received ${signal}, draining...`)
    
    // Log active background jobs
    const activeJobs = getActiveJobCount()
    if (activeJobs > 0) {
      console.warn(`[shutdown] ${activeJobs} background jobs in-flight`)
    }
    
    // Wait for drain or timeout
    await Promise.race([
      drainConnections(),
      new Promise(r => setTimeout(r, shutdownTimeout))
    ])
    
    process.exit(0)
  }
  
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
})
```

**Requirement coverage**: 4.1

### 3.3 Structured Error Handling

Add a Nitro error handler:

```typescript
// server/plugins/error-handler.ts
export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('error', (error, { event }) => {
    if (!event) return
    
    const path = getRequestURL(event).pathname
    const method = getMethod(event)
    const status = (error as any).statusCode || 500
    
    // Structured log
    console.error(JSON.stringify({
      level: 'error',
      message: error.message,
      status,
      method,
      path,
      timestamp: new Date().toISOString(),
      // Only include stack in non-production
      ...(process.env.NODE_ENV !== 'production' && { stack: error.stack })
    }))
  })
})
```

**Requirement coverage**: 5.1

### 3.4 Cache-Control on Sensitive Endpoints

Add a shared utility and apply to sync + storage routes:

```typescript
// server/utils/headers.ts
export function setNoCacheHeaders(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store, no-cache, must-revalidate')
  setHeader(event, 'Pragma', 'no-cache')
}
```

Apply in sync push/pull handlers and storage presign endpoints.

**Requirement coverage**: 6.1

---

## Workstream 4: Admin Auth Hardening

### 4.1 Login Timing

Refactor the login handler to always compute bcrypt, even on username miss:

```typescript
async function handleLogin(username: string, password: string) {
  const user = await findAdminUser(username)
  
  // Always run bcrypt — even with a dummy hash for non-existent users
  const hash = user?.passwordHash ?? DUMMY_BCRYPT_HASH
  const valid = await bcrypt.compare(password, hash)
  
  if (!user || !valid) {
    throw createError({ statusCode: 401, message: 'Invalid credentials' })
  }
  
  return generateAdminJwt(user)
}
```

### 4.2 Grant/Revoke Authorization

Add `superAdminOnly: true` to the `requireAdminApiContext` call in grant and revoke endpoints.

### 4.3 Admin JWT in Production

```typescript
if (process.env.NODE_ENV === 'production' && !process.env.OR3_ADMIN_JWT_SECRET) {
  throw new Error(
    '[or3] OR3_ADMIN_JWT_SECRET is required in production. ' +
    'Generate one with: openssl rand -base64 32'
  )
}
```

### 4.4 Endpoint Audit

Classify all admin endpoints and ensure mutations require super admin. Document the classification.

**Requirement coverage**: 7.1–7.4

---

## Workstream 5: Sync + Storage Hardening

### 5.1 GC Authorization Escalation

Change sync GC endpoints from `workspace.write` to `workspace.admin`.

### 5.2 GC Rate Limiting

Add rate limit calls to the GC endpoints using existing rate limiter infrastructure.

### 5.3 Auto-Provisioning Control

Add `OR3_AUTH_AUTO_PROVISION` env var (default `true` for backward compat). When `false`, `resolveSession` returns an "unauthorized" session context for unknown provider users instead of creating them.

**Requirement coverage**: 9.1, 9.2, 10.1

---

## Workstream 6: Quick Wins

These are small, isolated fixes:

| Fix | Effort | Requirement |
|-----|--------|-------------|
| Gate DevTools on `NODE_ENV !== 'production'` in nuxt.config.ts | 1 line | 11 |
| Add `Access-Control-Max-Age: 3600` to CORS preflight | 1 line | 12 |
| Remove `console.log` in logout handler | 1 line | 5.1 |
| Password min length consistency (wizard → 12 chars) | 1 line | 20 |

---

## Testing Strategy

### Unit Tests
- Provider bug fixes: each fix gets regression tests (hash format, workspace isolation, tombstone upsert, concurrent user creation, refresh flow, JWT algorithm)
- Health check: response shape, deep mode
- Error handler: sanitization in prod vs dev
- Admin login timing: constant-time verification

### Integration Tests
- FS provider: full upload → download → GC cycle with real file I/O
- SQLite provider: multi-workspace push/pull, concurrent user creation under load
- Basic-auth: full login → access → refresh → re-access cycle
- Auth UI adapter: registration, fallback rendering

### E2E Tests
- Default stack deployment: basic-auth + sqlite + fs end-to-end
- Graceful shutdown: start server, send requests, SIGTERM, verify drain
- Health check behind proxy

### Load/Stress Tests
- SQLite push/pull under concurrent workspace load
- FS upload/download with large files
- Background job concurrency limits

---

## Deployment Checklist (Operator)

The following must be verified before any production deployment:

1. `OR3_ADMIN_JWT_SECRET` is set (≥32 chars, random)
2. `OR3_STORAGE_FS_ROOT` points to a persistent volume
3. `OR3_STORAGE_FS_TOKEN_SECRET` is set
4. `OR3_SQLITE_DB_PATH` points to a persistent volume (not `:memory:`)
5. `OR3_BASIC_AUTH_JWT_SECRET` is set (≥32 chars, random)
6. `OR3_BASIC_AUTH_BOOTSTRAP_EMAIL` and `OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD` are set for initial admin
7. `OR3_SECURITY_ALLOWED_ORIGINS` is configured (not wildcard)
8. Health check endpoint (`/api/health`) responds 200
9. SIGTERM produces a clean shutdown log
10. Background job concurrency limit is appropriate for the instance size
