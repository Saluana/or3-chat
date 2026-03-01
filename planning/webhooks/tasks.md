# OR3 Cloud Webhooks — Implementation Tasks

## Phase 1: Foundation (Store, Crypto, Config)

### 1.1 Shared Types & Event Catalog
- [ ] Create `shared/webhooks/event-types.ts`:
  - [ ] Export `WEBHOOK_EVENT_TYPES` array and `WEBHOOK_EVENT_DESCRIPTIONS` map (user scope: 10 events)
  - [ ] Export `ADMIN_WEBHOOK_EVENT_TYPES` array and `ADMIN_WEBHOOK_EVENT_DESCRIPTIONS` map (admin scope: 11 events)
  - [ ] Export `WebhookEventType` union type (user) and `AdminWebhookEventType` union type (admin)
  - [ ] Export `WebhookScope` type (`'user' | 'admin'`)
- [ ] Create `shared/webhooks/event-schemas.ts` — export payload data shape interfaces (`ThreadEventData`, `MessageEventData`, `DocumentEventData`, `NotificationEventData`, `MessageCompletedEventData`, plus admin event data types: `AdminUserEventData`, `AdminWorkspaceEventData`, `AdminPluginEventData`, `AdminErrorEventData`, `AdminJobEventData`)
- [ ] Create `shared/webhooks/payload.ts` — export `WebhookPayload` envelope interface (includes optional `scope` field)

**Requirements**: 2.1, 2.2, 9.2, 9.6

### 1.2 Cloud Config Extension
- [ ] Add `webhooks` section to `config.or3cloud.ts` with all env vars (`OR3_WEBHOOKS_ENABLED`, `OR3_WEBHOOKS_MAX_PER_USER`, `OR3_WEBHOOKS_ADMIN_MAX`, `OR3_WEBHOOKS_RATE_LIMIT_PER_MINUTE`, `OR3_WEBHOOKS_DELIVERY_TIMEOUT_MS`, `OR3_WEBHOOKS_BLOCK_PRIVATE_IPS`, `OR3_WEBHOOKS_ENCRYPTION_KEY`, `OR3_WEBHOOKS_MAX_RETRY_HOURS`, `OR3_WEBHOOKS_LOG_RETENTION_HOURS`)
- [ ] Add `webhooks` to `runtimeConfig` type declarations in `nuxt.config.ts`
- [ ] Add `webhooks.enabled` to `runtimeConfig.public` so the client knows whether to show the dashboard tile

**Requirements**: 7.1, 9.5

### 1.3 Crypto Module
- [ ] Create `server/utils/webhooks/crypto.ts` — `generateSigningSecret()`, `encryptSecret()`, `decryptSecret()`
- [ ] Write unit tests for crypto module:
  - [ ] Signing secret generation produces correct prefix (`whs_`) and sufficient entropy
  - [ ] Encrypt/decrypt round-trip preserves plaintext
  - [ ] Decrypt with wrong key throws

**Requirements**: 5.1, 5.2

### 1.4 SSRF-Safe Delivery Agent
- [ ] Create `server/utils/webhooks/ssrf-safe-agent.ts` — `createSsrfSafeAgent()` using undici `Agent` with custom `connect.lookup` callback
- [ ] Implement private IP check at DNS resolution time (blocks 10.x, 172.16-31.x, 192.168.x, 127.x, 169.254.x, ::1, fe80:, fc00:, fd00:)
- [ ] Write unit tests:
  - [ ] Public IP resolves normally
  - [ ] Private IP throws before connection is established
  - [ ] IPv6 loopback (::1) is blocked
  - [ ] Link-local addresses blocked
  - [ ] DNS rebind scenario: hostname resolves to private IP at connect time → blocked

**Requirements**: 5.3

### 1.5 Payload Signing
- [ ] Create `server/utils/webhooks/signing.ts` — `signPayload()`, `buildDeliveryHeaders()`
- [ ] Implement HMAC-SHA256 over `${timestamp}.${body}` (Stripe/Shopify pattern)
- [ ] Write unit tests:
  - [ ] Signature is deterministic for same inputs
  - [ ] Different timestamps produce different signatures
  - [ ] Signature format: `sha256={hex}` with timestamp prefix in signed content
  - [ ] Headers contain all required fields (`X-OR3-Event`, `X-OR3-Signature`, `X-OR3-Event-ID`, `X-OR3-Timestamp`, `User-Agent`)

**Requirements**: 4.1, 5.1

### 1.6 URL Validator
- [ ] Create `server/utils/webhooks/url-validator.ts` — `validateWebhookUrl()`
- [ ] Write unit tests:
  - [ ] Valid HTTPS URL passes
  - [ ] Valid HTTP URL passes when HTTPS not required
  - [ ] HTTP URL rejected when HTTPS required
  - [ ] Invalid URL rejected
  - [ ] Non-HTTP protocols rejected (ftp, ws, etc.)
  - [ ] Private IPs blocked when `blockPrivateIps` enabled (127.0.0.1, 10.x, 192.168.x, etc.)
  - [ ] Private IPs allowed when `blockPrivateIps` disabled

- [ ] Note: URL validation at CRUD time is defense-in-depth only; dispatch-time SSRF protection (§1.4) is the primary guard against DNS rebinding

**Requirements**: 3.1, 5.3

---

## Phase 2: Store Layer

### 2.1 Store Types & Registry
- [ ] Create `server/utils/webhooks/store/types.ts` — `WebhookRegistration` (with `scope`, `custom_hooks`, `signing_secret_enc` fields), `WebhookDeliveryLog`, `WebhookStore` interfaces
  - [ ] `WebhookRegistration` includes `scope: 'user' | 'admin'`, `custom_hooks: string[]`, `signing_secret_enc: string`, nullable `user_id`, `workspace_id`
  - [ ] `WebhookDeliveryLog` includes `status: 'pending' | 'in_flight' | 'success' | 'failed' | 'cancelled'`, `claimed_by: string | null`, `claimed_at: number | null`
  - [ ] `WebhookStore` includes admin-specific methods: `listAdminWebhooks()`, `listWebhooksByCustomHook()`, `listActiveCustomHookNames()`
  - [ ] `WebhookStore` includes multi-worker methods: `claimPendingDeliveries(workerId, limit)`, `resetStaleInFlightDeliveries(olderThanMs)`
  - [ ] `WebhookStore` includes bulk action: `disableAllWebhooks(userId, workspaceId)`
- [ ] Create `server/utils/webhooks/store/registry.ts` — `registerWebhookStore()`, `getWebhookStore()`, `getActiveWebhookStore()`, `listWebhookStoreIds()`

**Requirements**: 1.1, 3.1, 4.1, 4.4, 9.1, 9.3, 9.4

### 2.2 SQLite Store Implementation
- [ ] Create `server/utils/webhooks/store/sqlite-store.ts` — `createSqliteWebhookStore()`
- [ ] Implement schema creation (2 tables):
  - [ ] `webhook_registrations` — id, scope, user_id (nullable), workspace_id (nullable), url, label, events (JSON), custom_hooks (JSON), signing_secret_enc, enabled, health, created_at, updated_at
  - [ ] `webhook_delivery_logs` — id, webhook_id, event_id, event_type, attempt, status (`pending`/`in_flight`/`success`/`failed`/`cancelled`), http_status, error_message, request_payload, response_body, duration_ms, next_retry_at, claimed_by, claimed_at, created_at
- [ ] Add indexes: `(scope, user_id, workspace_id)` on webhooks, `(webhook_id, created_at)` on logs, `(status, next_retry_at)` on logs for pending query, `(status, claimed_at)` on logs for stale reaper
- [ ] Implement all `WebhookStore` methods (both user and admin scope)
- [ ] Implement `claimPendingDeliveries(workerId, limit)` — a single atomic store operation (transaction / backend-native equivalent) that marks due `pending` rows as `in_flight` and returns only the rows claimed by this worker
- [ ] Implement `resetStaleInFlightDeliveries(olderThanMs)` — `UPDATE ... SET status='pending', claimed_by=NULL, claimed_at=NULL WHERE status='in_flight' AND claimed_at < ?`
- [ ] Implement `disableAllWebhooks(userId, workspaceId)` — bulk disable all user webhooks in workspace
- [ ] Write integration tests for SQLite store:
  - [ ] User webhook CRUD lifecycle (create stores encrypted signing secret, update, delete, list)
  - [ ] Admin webhook CRUD lifecycle (create with custom_hooks, update, delete, listAdminWebhooks)
  - [ ] `listWebhooksByEvent()` returns only matching webhooks for correct scope
  - [ ] `listWebhooksByCustomHook()` returns matching admin webhooks
  - [ ] `listActiveCustomHookNames()` returns distinct custom hook names
  - [ ] `disableAllWebhooks()` disables all user webhooks in workspace
  - [ ] Admin webhook with workspace_id filter: `listWebhooksByEvent()` respects filter
  - [ ] Delivery log CRUD (create, update, get by webhook)
  - [ ] `claimPendingDeliveries()` returns only pending logs with `next_retry_at <= now`, marks them `in_flight`
  - [ ] Concurrent `claimPendingDeliveries()` calls never return the same row
  - [ ] `resetStaleInFlightDeliveries()` resets stale claims to `pending`
  - [ ] `purgeExpiredLogs()` removes logs older than cutoff

**Requirements**: 1.1, 3.1, 3.3, 3.4, 4.2, 4.4, 9.1, 9.3, 9.4, 9.5

---

## Phase 3: Delivery Engine

### 3.1 Rate Limiter
- [ ] Create `server/utils/webhooks/rate-limit.ts` — `checkWebhookRateLimit()`
- [ ] Write unit tests:
  - [ ] Allows requests under limit
  - [ ] Blocks requests at limit
  - [ ] Resets after window expires

**Requirements**: 4.3

### 3.2 Payload Builder
- [ ] Create `server/utils/webhooks/payload.ts` — `buildWebhookPayload()`, per-event data extractors
- [ ] Implement data extractors for each user event type:
  - [ ] `extractThreadData()` — from thread entity
  - [ ] `extractMessageData()` — from message entity (content truncated to 4KB)
  - [ ] `extractDocumentData()` — from document entity (content length only, not content)
  - [ ] `extractNotificationData()` — from notification payload
  - [ ] `extractMessageCompletedData()` — from stream complete payload
- [ ] Implement data extractors for each admin event type:
  - [ ] `extractAdminUserData()` — from auth user action payload
  - [ ] `extractAdminWorkspaceData()` — from workspace action payload
  - [ ] `extractAdminPluginData()` — from plugin action payload
  - [ ] `extractAdminErrorData()` — from sync/storage error payload
  - [ ] `extractAdminJobData()` — from background job completion/failure
- [ ] Implement `serializeHookArgs()` — best-effort JSON serialization for custom hook payloads
- [ ] Write unit tests:
  - [ ] Envelope has all required fields
  - [ ] `event_id` is unique per call
  - [ ] Message content truncated at 4KB
  - [ ] No sensitive fields in output
  - [ ] Admin envelope includes `scope: 'admin'`
  - [ ] Custom hook serialization handles non-serializable values gracefully

**Requirements**: 2.2, 9.3, 9.6

### 3.3 Webhook Dispatcher
- [ ] Create `server/utils/webhooks/dispatcher.ts` — `createWebhookDispatcher(store, config, workerId?)`
- [ ] Implement `enqueue()` — creates delivery log entry with `status: 'pending'`, `attempt: 1`, `next_retry_at: now`
- [ ] Implement `claimAndProcess()` — call `store.claimPendingDeliveries(workerId, batchSize)`, attempt delivery for each claimed row using SSRF-safe agent
- [ ] Implement retry logic with exponential backoff schedule (0s, 30s, 2m, 10m, 30m, 60m)
- [ ] Implement `sendTestPing()` — sends `webhook.test` event and returns result (uses SSRF-safe agent)
- [ ] Implement `start()` / `stop()` — setInterval loop (5s) calling `claimAndProcess()`
- [ ] On final failure: call a helper backed by `server/utils/notifications/registry.ts` that resolves the active server notification emitter and emits a dedicated webhook-delivery-failed notification
- [ ] Use `createSsrfSafeAgent()` for all outbound webhook HTTP requests
- [ ] Write unit tests (mocked HTTP + store):
  - [ ] Successful delivery logs as `success`
  - [ ] Failed delivery schedules retry with correct delay
  - [ ] Final failure marks as `failed` and triggers notification via the server notification emitter registry helper
  - [ ] Cancelled delivery when webhook disabled mid-retry
  - [ ] Test ping returns correct result shape
  - [ ] Rate-limited events are dropped and logged
  - [ ] SSRF-safe agent blocks private IP at dispatch time
  - [ ] Concurrent dispatchers (different workerId) never process the same delivery

**Requirements**: 4.1, 4.2, 4.3, 4.4, 5.3

### 3.4 Event Bridge
- [ ] Create `server/utils/webhooks/event-bridge.ts` — `createWebhookEventBridge(store, dispatcher, nitroApp)`
- [ ] Implement user hook-to-event mapping: listen on `nitroApp.hooks` for user events using `nitroApp.hooks.hook(hookName, handler)`
- [ ] Implement admin hook-to-event mapping: listen on `nitroApp.hooks` for admin events using `nitroApp.hooks.hook(hookName, handler)`
- [ ] Implement subscription fan-out: on hook fire, query active webhooks for event type (scoped), build payload, enqueue per webhook
- [ ] Fast-path: skip entirely when zero subscriptions exist for event type
- [ ] Implement admin workspace filtering: if admin webhook has `workspace_id` set, only deliver matching events
- [ ] Implement custom hook listener management:
  - [ ] `refreshCustomHookListeners()` — diff active custom hook names vs. current bindings on `nitroApp.hooks`, add/remove listeners
  - [ ] Custom hook listener: serialize hook args, enqueue to all admin webhooks subscribing to that hook
  - [ ] Clean up bindings when webhooks are deleted/disabled
- [ ] Workspace ID extraction from hook context
- [ ] `start()` / `stop()` for listener lifecycle
- [ ] Write unit tests:
  - [ ] Correct event type mapping for all 10 user hook → event pairs
  - [ ] Correct event type mapping for all admin hook → event pairs
  - [ ] Fan-out creates one delivery per subscribed webhook
  - [ ] No delivery when no subscriptions
  - [ ] Disabled webhooks are skipped
  - [ ] Admin webhook with workspace filter only receives matching events
  - [ ] Custom hook listener fires via `nitroApp.hooks` and serializes payload correctly
  - [ ] Custom hook listener cleanup when webhook deleted
  - [ ] `refreshCustomHookListeners()` correctly diffs and updates bindings on `nitroApp.hooks`

**Requirements**: 2.1, 4.1, 8.1, 9.2, 9.3, 9.4

---

## Phase 4: API Routes

### 4.1 Disable All Webhooks Route
- [ ] Create `server/api/webhooks/disable-all.post.ts` — disable all user webhooks in current workspace
  - [ ] Call `store.disableAllWebhooks(userId, workspaceId)`
  - [ ] Return count of disabled webhooks
- [ ] Write integration tests:
  - [ ] Disables all active webhooks for user in workspace
  - [ ] Returns correct count
  - [ ] Does not affect other users' webhooks
  - [ ] Unauthenticated requests return 401

**Requirements**: 1.2, 5.4

### 4.2 Webhook CRUD Routes
- [ ] Create `server/api/webhooks/index.get.ts` — list user's webhooks in current workspace
- [ ] Create `server/api/webhooks/index.post.ts` — create webhook with validation
  - [ ] Generate per-webhook signing secret, encrypt and store on registration
  - [ ] Return signing secret once in response (raw, never retrievable again)
  - [ ] Validate URL format + HTTPS policy + private IP policy
  - [ ] Validate events array (non-empty, all valid event types)
  - [ ] Validate webhook count limit
- [ ] Create `server/api/webhooks/[id].patch.ts` — update webhook URL/label/events
  - [ ] Re-validate URL if changed
  - [ ] Reset health to `unknown` if URL changed
- [ ] Create `server/api/webhooks/[id].delete.ts` — delete webhook + delivery logs + cancel pending
- [ ] Create `server/api/webhooks/[id]/toggle.post.ts` — enable/disable webhook
- [ ] Write integration tests:
  - [ ] Full CRUD lifecycle
  - [ ] Validation errors (bad URL, no events, invalid event type, limit exceeded)
  - [ ] Cross-user access denied (403)
  - [ ] Delete also removes delivery logs

**Requirements**: 3.1, 3.2, 3.3, 3.4, 3.5, 5.3, 5.4

### 4.3 Test Ping Route
- [ ] Create `server/api/webhooks/[id]/test.post.ts` — send test ping to webhook endpoint
  - [ ] Return success/failure, status code, duration
  - [ ] Log test ping in delivery log
- [ ] Write integration tests:
  - [ ] Test ping to working endpoint returns success
  - [ ] Test ping to failing endpoint returns failure details
  - [ ] Test ping appears in delivery log

**Requirements**: 6.5

### 4.4 Delivery Log Route
- [ ] Create `server/api/webhooks/[id]/logs.get.ts` — return delivery logs for last 72h (configurable)
  - [ ] Accept optional `since` query param for custom time range
  - [ ] Return newest first, include full payload + response body
- [ ] Write integration tests:
  - [ ] Returns logs within time window
  - [ ] Excludes logs outside time window
  - [ ] Includes request payload and response body

**Requirements**: 6.4

---

## Phase 5: Server Plugin & Lifecycle

### 5.1 Nitro Plugin
- [ ] Create `server/plugins/webhooks.ts`
  - [ ] Gate on `config.webhooks.enabled`
  - [ ] Validate encryption key exists, warn and bail if not
  - [ ] Register default SQLite store if no provider has registered one
  - [ ] Generate `workerId` via `crypto.randomUUID()`
  - [ ] Create and start `WebhookDispatcher` with `createWebhookDispatcher(store, config.webhooks, workerId)`
  - [ ] Create and start `WebhookEventBridge` with `createWebhookEventBridge(store, dispatcher, nitroApp)`
  - [ ] Claim and process pending deliveries on startup (crash recovery)
  - [ ] Set up hourly log cleanup interval
  - [ ] Set up 2-minute reaper interval: `store.resetStaleInFlightDeliveries(5 * 60 * 1000)`
  - [ ] Register graceful shutdown hook (stop bridge, stop dispatcher, clear all intervals)
- [ ] Write integration test:
  - [ ] Plugin starts when enabled
  - [ ] Plugin skips when disabled
  - [ ] Plugin skips when no encryption key
  - [ ] Pending deliveries are claimed and processed on startup
  - [ ] Reaper resets stale in_flight deliveries

**Requirements**: 7.1, 8.2

### 5.2 Hook Integration
- [ ] Determine capture points for each user event type:
  - [ ] Thread events: fire via `nitroApp.hooks.callHook()` at sync gateway apply layer
  - [ ] Message events: fire via `nitroApp.hooks.callHook()` at sync gateway apply layer
  - [ ] Document events: fire via `nitroApp.hooks.callHook()` at sync gateway apply layer
  - [ ] `message.completed`: Background: capture from background streaming handler completion; Foreground SSR: capture when response stream ends in SSR handler and fire via `nitroApp.hooks.callHook('ai.chat.stream:action:complete', ...)`
  - [ ] `notification.created`: capture from the server notification emitter implementation by mirroring a server-side `notify:action:push` event onto `nitroApp.hooks`
- [ ] Determine capture points for each admin event type:
  - [ ] `admin.user.created`: hook on `nitroApp.hooks.hook('auth.user:action:created', ...)`
  - [ ] `admin.workspace.created/deleted`: hook on `nitroApp.hooks.hook('admin.workspace:action:created/deleted', ...)`
  - [ ] `admin.user.role_changed`: hook on `nitroApp.hooks.hook('admin.user:action:role_changed', ...)`
  - [ ] `admin.plugin.*`: hook on `nitroApp.hooks.hook('admin.plugin:action:installed/enabled/disabled', ...)`
  - [ ] `admin.sync.error`: hook on `nitroApp.hooks.hook('sync:action:error', ...)`
  - [ ] `admin.storage.error`: hook on `nitroApp.hooks.hook('storage:action:error', ...)`
  - [ ] `admin.job.completed/failed`: capture from background job provider completion/failure callbacks
- [ ] Wire event bridge listeners to all capture points via `nitroApp.hooks` (user + admin + custom)
- [ ] Verify zero-overhead when no subscriptions exist (fast Map lookup)
- [ ] Call `refreshCustomHookListeners()` on bridge start and after admin webhook mutations

**Requirements**: 2.1, 8.1, 9.2, 9.3

---

## Phase 6: Dashboard UI

### 6.1 Dashboard Plugin Registration
- [ ] Create `app/plugins/webhooks-dashboard.client.ts`
  - [ ] Gate on `runtimeConfig.public.webhooks.enabled`
  - [ ] Register dashboard plugin with id `core:webhooks`, icon `i-lucide-webhook`, order 50
  - [ ] Register single page: `webhooks-manage`

**Requirements**: 6.1

### 6.2 Webhooks List
- [ ] Create `app/components/dashboard/webhooks/WebhooksList.vue`
  - [ ] Empty state: "No webhooks yet" + CTA button
  - [ ] Webhook row: health dot, label/URL, event badges (UBadge), last delivery time, action buttons
  - [ ] Actions: Logs, Test, Edit, Delete (with confirmation), Enable/Disable toggle
  - [ ] Health dot colors: green (healthy), amber (failing), gray (disabled), neutral (unknown)
  - [ ] "New Webhook" button in section header

**Requirements**: 6.2

### 6.3 Webhook Create/Edit Form
- [ ] Create `app/components/dashboard/webhooks/WebhookForm.vue`
  - [ ] Slide-over or modal form
  - [ ] URL input with inline validation (valid URL format, HTTPS check based on config)
  - [ ] Label input (optional, max 100 chars)
  - [ ] Event type checkboxes with descriptions + "Select All" / "Deselect All"
  - [ ] Save + Cancel buttons
  - [ ] Validation: URL required, at least 1 event, client-side URL format check
  - [ ] Works for both create and edit modes
  - [ ] On successful creation: display signing secret in highlighted box with copy button and "save now" warning

**Requirements**: 3.1, 3.2, 6.3

### 6.4 Delivery Log View
- [ ] Create `app/components/dashboard/webhooks/WebhookDeliveryLog.vue`
  - [ ] Opens when "Logs" clicked on a webhook
  - [ ] Fetches logs from last 72 hours
  - [ ] Each row: event badge, timestamp (relative), HTTP status badge, duration, attempt number
  - [ ] Expandable detail: JSON viewer for request payload, truncated response body
  - [ ] Refresh button
  - [ ] Empty state: "No deliveries yet"

**Requirements**: 6.4

### 6.5 Test Ping
- [ ] Create `app/components/dashboard/webhooks/WebhookTestPing.vue`
  - [ ] Inline result component (appears after clicking "Test")
  - [ ] Shows success/failure with status code and duration
  - [ ] Auto-dismisses after 10 seconds

**Requirements**: 6.5

### 6.6 Main Page Assembly
- [ ] Create `app/components/dashboard/webhooks/WebhooksPage.vue`
  - [ ] Composes `WebhooksList` + "Disable All" bulk action button
  - [ ] Conditionally shows `WebhookForm` (slide-over) — displays signing secret on successful creation
  - [ ] Conditionally shows `WebhookDeliveryLog` (expandable)
  - [ ] Handles loading/error states
  - [ ] Uses `useFetch` for API calls with proper error handling

**Requirements**: 6.1

---

## Phase 7: Testing & Polish

### 7.1 Integration Test Suite
- [ ] Webhook delivery end-to-end: create webhook → signing secret returned → simulate hook fire → verify delivery at mock endpoint
- [ ] Retry behavior: mock failing endpoint → verify retry attempts → verify final failure notification via the server notification emitter registry helper
- [ ] Disable all webhooks flow: create webhooks → disable all → verify deliveries stop
- [ ] Rate limit enforcement: burst events → verify excess dropped
- [ ] Multi-worker safety: concurrent claimPendingDeliveries() → no duplicate processing
- [ ] Stale reaper: simulate crashed worker → verify reaper resets in_flight to pending
- [ ] Foreground SSR completion: SSR stream ends → message.completed hook fires → webhook delivered

**Requirements**: 4.1, 4.2, 4.3, 4.4

### 7.2 Security Tests
- [ ] Signature verification: take a delivered payload → verify HMAC-SHA256 over `{timestamp}.{body}` matches using per-webhook signing secret
- [ ] Cross-user access: user A cannot see/modify user B's webhooks
- [ ] Unauthenticated access: all routes return 401 without session
- [ ] Signing secret not retrievable after creation (only returned once)
- [ ] Signing secret encrypted at rest (AES-256-GCM)
- [ ] SSRF protection: dispatch-time DNS resolution blocks private IPs even when CRUD validation passes
- [ ] DNS rebind test: hostname that resolves to public IP at CRUD time but private IP at dispatch time → blocked

**Requirements**: 5.1, 5.2, 5.3, 5.4

### 7.3 Performance Validation
- [ ] Verify hook capture adds < 2ms overhead (benchmark with zero subscriptions)
- [ ] Verify delivery loop doesn't block request handling
- [ ] Verify delivery log queries are indexed (explain query plan)

**Requirements**: 8.1

### 7.4 Documentation
- [ ] Add webhook event type reference to `public/_documentation/` (both user and admin catalogs)
- [ ] Add signature verification code examples (Node.js, Python)
- [ ] Add webhook configuration reference to admin docs
- [ ] Document admin advanced mode (custom hook subscription) with examples
- [ ] Update `planning/webhooks/` docs with final implementation notes

**Requirements**: 5.1, 7.1, 9.3

---

## Phase 8: Admin Webhook Routes & UI

### 8.1 Admin Webhook API Routes
- [ ] Create `server/api/admin/webhooks/index.get.ts` — list all admin webhooks, require `requireAdminApiContext({ superAdminOnly: true })`
- [ ] Create `server/api/admin/webhooks/index.post.ts` — create admin webhook
  - [ ] Generate signing secret, encrypt and store on the registration itself
  - [ ] Return signing secret once in response
  - [ ] Accept `events` (curated) + `custom_hooks` (raw server-side hook names) + optional `workspace_id` filter
  - [ ] Validate curated events are valid admin event types
  - [ ] Validate custom hook names follow format pattern (non-empty, contains `:action:` or `:filter:`)
  - [ ] Validate webhook count limit (`adminMax`)
  - [ ] Set `scope: 'admin'`, `user_id: null`
- [ ] Create `server/api/admin/webhooks/[id].patch.ts` — update admin webhook
  - [ ] Re-validate URL if changed, reset health
  - [ ] Support updating `custom_hooks` and `workspace_id`
  - [ ] Call `bridge.refreshCustomHookListeners()` after mutation
- [ ] Create `server/api/admin/webhooks/[id].delete.ts` — delete admin webhook + logs + cancel pending
  - [ ] Call `bridge.refreshCustomHookListeners()` after deletion
- [ ] Create `server/api/admin/webhooks/[id]/toggle.post.ts` — enable/disable admin webhook
  - [ ] Call `bridge.refreshCustomHookListeners()` after toggle
- [ ] Create `server/api/admin/webhooks/[id]/test.post.ts` — send test ping
- [ ] Create `server/api/admin/webhooks/[id]/logs.get.ts` — delivery logs (last 72h)
- [ ] Write integration tests:
  - [ ] Full admin webhook CRUD lifecycle
  - [ ] Curated + custom hook creation
  - [ ] Signing secret returned once at creation
  - [ ] Non-admin access denied (403)
  - [ ] Workspace filter applied to event fan-out
  - [ ] Custom hook format validation
  - [ ] Admin webhook limit enforced

**Requirements**: 9.1, 9.2, 9.3, 9.4, 9.5

### 8.2 Admin Panel Webhook Page
- [ ] Create admin panel page at `/admin/webhooks`
  - [ ] List all admin webhooks with health badges, event counts, workspace scope indicator
  - [ ] Show "+ N custom hooks" indicator when custom_hooks is non-empty
  - [ ] Actions: Logs, Test, Edit, Delete (with confirmation), Enable/Disable toggle
- [ ] Create admin webhook create/edit form:
  - [ ] URL input with validation
  - [ ] Label input
  - [ ] Curated admin event checkboxes with descriptions
  - [ ] **Advanced section** (collapsible, closed by default):
    - [ ] Header: "Subscribe to any server-side hook"
    - [ ] Disclaimer text about unstable schemas
    - [ ] Dynamic rows: text input for hook name + remove button
    - [ ] "Add custom hook" button
    - [ ] Basic format validation on hook names
  - [ ] Optional workspace selector (dropdown of workspaces, "All workspaces" default)
  - [ ] Save / Cancel buttons
- [ ] Show signing secret once at creation (highlighted box, copy button, "save now" warning — same pattern as user webhook creation)
- [ ] Delivery log view (same UX as user dashboard)
- [ ] Test ping (same UX as user dashboard)

**Requirements**: 9.1, 9.2, 9.3, 9.4, 9.5

### 8.3 Admin Webhook Integration Tests
- [ ] Admin full flow: create admin webhook (curated + custom) → trigger admin hook → verify delivery at mock endpoint
- [ ] Custom hook delivery: register custom hook `db.messages.create:action:after` → trigger that hook → verify serialized payload delivered
- [ ] Workspace filter: create admin webhook with workspace_id → trigger event from matching workspace → delivery sent; trigger from different workspace → no delivery
- [ ] Admin webhook limit enforcement
- [ ] Signing secret verification on admin webhook deliveries

**Requirements**: 9.1, 9.2, 9.3, 9.4, 9.5, 10.1

---

## Phase Summary

| Phase | Files | Depends On | Requirements Covered |
|---|---|---|---|
| 1 — Foundation | 6 files + tests | None | 2.1, 2.2, 5.1, 5.2, 5.3, 7.1, 9.2, 9.6 |
| 2 — Store | 3 files + tests | Phase 1 | 1.1, 3.1, 3.3, 3.4, 4.2, 4.4, 9.1, 9.3, 9.4 |
| 3 — Delivery | 4 files + tests | Phase 1, 2 | 2.1, 4.1–4.4, 8.1, 9.3 |
| 4 — User API Routes | 8 files + tests | Phase 1, 2, 3 | 1.1, 3.1–3.5, 5.3, 5.4, 6.4, 6.5 |
| 5 — Plugin | 1 file + tests | Phase 2, 3, 4 | 7.1, 8.2, 9.2, 10.2 |
| 6 — User Dashboard UI | 6 files | Phase 4 | 6.1–6.5 |
| 7 — Testing & Polish | Tests + docs | All | All (validation) |
| 8 — Admin Webhooks | 7 routes + admin UI | Phase 1, 2, 3, 5 | 9.1–9.6, 10.1 |
