# OR3 Cloud Webhooks — Implementation Tasks

## Phase 1: Foundation (Store, Crypto, Config)

### 1.1 Shared Types & Event Catalog
- [x] Create `shared/webhooks/event-types.ts`:
  - [x] Export `WEBHOOK_EVENT_TYPES` array and `WEBHOOK_EVENT_DESCRIPTIONS` map (user scope: 10 events)
  - [x] Export `ADMIN_WEBHOOK_EVENT_TYPES` array and `ADMIN_WEBHOOK_EVENT_DESCRIPTIONS` map (admin scope: 11 events)
  - [x] Export `WebhookEventType` union type (user) and `AdminWebhookEventType` union type (admin)
  - [x] Export `WebhookScope` type (`'user' | 'admin'`)
- [x] Create `shared/webhooks/event-schemas.ts` — export payload data shape interfaces (`ThreadEventData`, `MessageEventData`, `DocumentEventData`, `NotificationEventData`, `MessageCompletedEventData`, plus admin event data types: `AdminUserEventData`, `AdminWorkspaceEventData`, `AdminPluginEventData`, `AdminErrorEventData`, `AdminJobEventData`)
- [x] Create `shared/webhooks/payload.ts` — export `WebhookPayload` envelope interface (includes optional `scope` field)

**Requirements**: 2.1, 2.2, 9.2, 9.6

### 1.2 Cloud Config Extension
- [x] Add `webhooks` section to `config.or3cloud.ts` with all env vars (`OR3_WEBHOOKS_ENABLED`, `OR3_WEBHOOKS_MAX_PER_USER`, `OR3_WEBHOOKS_ADMIN_MAX`, `OR3_WEBHOOKS_RATE_LIMIT_PER_MINUTE`, `OR3_WEBHOOKS_DELIVERY_TIMEOUT_MS`, `OR3_WEBHOOKS_BLOCK_PRIVATE_IPS`, `OR3_WEBHOOKS_ENCRYPTION_KEY`, `OR3_WEBHOOKS_MAX_RETRY_HOURS`, `OR3_WEBHOOKS_LOG_RETENTION_HOURS`)
- [x] Add `webhooks` to `runtimeConfig` type declarations in `nuxt.config.ts`
- [x] Add `webhooks.enabled` to `runtimeConfig.public` so the client knows whether to show the dashboard tile

**Requirements**: 7.1, 9.5

### 1.3 Crypto Module
- [x] Create `server/utils/webhooks/crypto.ts` — `generateSigningSecret()`, `encryptSecret()`, `decryptSecret()`
- [x] Write unit tests for crypto module:
  - [x] Signing secret generation produces correct prefix (`whs_`) and sufficient entropy
  - [x] Encrypt/decrypt round-trip preserves plaintext
  - [x] Decrypt with wrong key throws

**Requirements**: 5.1, 5.2

### 1.4 SSRF-Safe Delivery Agent
- [x] Create `server/utils/webhooks/ssrf-safe-agent.ts` — `createSsrfSafeAgent()` using undici `Agent` with custom `connect.lookup` callback
- [x] Implement private IP check at DNS resolution time (blocks 10.x, 172.16-31.x, 192.168.x, 127.x, 169.254.x, ::1, fe80:, fc00:, fd00:)
- [x] Write unit tests:
  - [x] Public IP resolves normally
  - [x] Private IP throws before connection is established
  - [x] IPv6 loopback (::1) is blocked
  - [x] Link-local addresses blocked
  - [x] DNS rebind scenario: hostname resolves to private IP at connect time → blocked

**Requirements**: 5.3

### 1.5 Payload Signing
- [x] Create `server/utils/webhooks/signing.ts` — `signPayload()`, `buildDeliveryHeaders()`
- [x] Implement HMAC-SHA256 over `${timestamp}.${body}` (Stripe/Shopify pattern)
- [x] Write unit tests:
  - [x] Signature is deterministic for same inputs
  - [x] Different timestamps produce different signatures
  - [x] Signature format: `sha256={hex}` with timestamp prefix in signed content
  - [x] Headers contain all required fields (`X-OR3-Event`, `X-OR3-Signature`, `X-OR3-Event-ID`, `X-OR3-Timestamp`, `User-Agent`)

**Requirements**: 4.1, 5.1

### 1.6 URL Validator
- [x] Create `server/utils/webhooks/url-validator.ts` — `validateWebhookUrl()`
- [x] Write unit tests:
  - [x] Valid HTTPS URL passes
  - [x] Valid HTTP URL passes when HTTPS not required
  - [x] HTTP URL rejected when HTTPS required
  - [x] Invalid URL rejected
  - [x] Non-HTTP protocols rejected (ftp, ws, etc.)
  - [x] Private IPs blocked when `blockPrivateIps` enabled (127.0.0.1, 10.x, 192.168.x, etc.)
  - [x] Private IPs allowed when `blockPrivateIps` disabled

- [x] Note: URL validation at CRUD time is defense-in-depth only; dispatch-time SSRF protection (§1.4) is the primary guard against DNS rebinding

**Requirements**: 3.1, 5.3

---

## Phase 2: Store Layer

### 2.1 Store Types & Registry
- [x] Create `server/utils/webhooks/store/types.ts` — `WebhookRegistration` (with `scope`, `custom_hooks`, `signing_secret_enc` fields), `WebhookDeliveryLog`, `WebhookStore` interfaces
  - [x] `WebhookRegistration` includes `scope: 'user' | 'admin'`, `custom_hooks: string[]`, `signing_secret_enc: string`, nullable `user_id`, `workspace_id`
  - [x] `WebhookDeliveryLog` includes `status: 'pending' | 'in_flight' | 'success' | 'failed' | 'cancelled'`, `claimed_by: string | null`, `claimed_at: number | null`
  - [x] `WebhookStore` includes admin-specific methods: `listAdminWebhooks()`, `listWebhooksByCustomHook()`, `listActiveCustomHookNames()`
  - [x] `WebhookStore` includes multi-worker methods: `claimPendingDeliveries(workerId, limit)`, `resetStaleInFlightDeliveries(olderThanMs)`
  - [x] `WebhookStore` includes bulk action: `disableAllWebhooks(userId, workspaceId)`
- [x] Create `server/utils/webhooks/store/registry.ts` — `registerWebhookStore()`, `getWebhookStore()`, `getActiveWebhookStore()`, `listWebhookStoreIds()`

**Requirements**: 1.1, 3.1, 4.1, 4.4, 9.1, 9.3, 9.4

### 2.2 SQLite Store Implementation
- [x] Create `server/utils/webhooks/store/sqlite-store.ts` — `createSqliteWebhookStore()`
- [x] Implement schema creation (2 tables):
  - [x] `webhook_registrations` — id, scope, user_id (nullable), workspace_id (nullable), url, label, events (JSON), custom_hooks (JSON), signing_secret_enc, enabled, health, created_at, updated_at
  - [x] `webhook_delivery_logs` — id, webhook_id, event_id, event_type, attempt, status (`pending`/`in_flight`/`success`/`failed`/`cancelled`), http_status, error_message, request_payload, response_body, duration_ms, next_retry_at, claimed_by, claimed_at, created_at
- [x] Add indexes: `(scope, user_id, workspace_id)` on webhooks, `(webhook_id, created_at)` on logs, `(status, next_retry_at)` on logs for pending query, `(status, claimed_at)` on logs for stale reaper
- [x] Implement all `WebhookStore` methods (both user and admin scope)
- [x] Implement `claimPendingDeliveries(workerId, limit)` — a single atomic store operation (transaction / backend-native equivalent) that marks due `pending` rows as `in_flight` and returns only the rows claimed by this worker
- [x] Implement `resetStaleInFlightDeliveries(olderThanMs)` — `UPDATE ... SET status='pending', claimed_by=NULL, claimed_at=NULL WHERE status='in_flight' AND claimed_at < ?`
- [x] Implement `disableAllWebhooks(userId, workspaceId)` — bulk disable all user webhooks in workspace
- [x] Write integration tests for SQLite store:
  - [x] User webhook CRUD lifecycle (create stores encrypted signing secret, update, delete, list)
  - [x] Admin webhook CRUD lifecycle (create with custom_hooks, update, delete, listAdminWebhooks)
  - [x] `listWebhooksByEvent()` returns only matching webhooks for correct scope
  - [x] `listWebhooksByCustomHook()` returns matching admin webhooks
  - [x] `listActiveCustomHookNames()` returns distinct custom hook names
  - [x] `disableAllWebhooks()` disables all user webhooks in workspace
  - [x] Admin webhook with workspace_id filter: `listWebhooksByEvent()` respects filter
  - [x] Delivery log CRUD (create, update, get by webhook)
  - [x] `claimPendingDeliveries()` returns only pending logs with `next_retry_at <= now`, marks them `in_flight`
  - [x] Concurrent `claimPendingDeliveries()` calls never return the same row
  - [x] `resetStaleInFlightDeliveries()` resets stale claims to `pending`
  - [x] `purgeExpiredLogs()` removes logs older than cutoff

**Requirements**: 1.1, 3.1, 3.3, 3.4, 4.2, 4.4, 9.1, 9.3, 9.4, 9.5

---

## Phase 3: Delivery Engine

### 3.1 Rate Limiter
- [x] Create `server/utils/webhooks/rate-limit.ts` — `checkWebhookRateLimit()`
- [x] Write unit tests:
  - [x] Allows requests under limit
  - [x] Blocks requests at limit
  - [x] Resets after window expires

**Requirements**: 4.3

### 3.2 Payload Builder
- [x] Create `server/utils/webhooks/payload.ts` — `buildWebhookPayload()`, per-event data extractors
- [x] Implement data extractors for each user event type:
  - [x] `extractThreadData()` — from thread entity
  - [x] `extractMessageData()` — from message entity (content truncated to 4KB)
  - [x] `extractDocumentData()` — from document entity (content length only, not content)
  - [x] `extractNotificationData()` — from notification payload
  - [x] `extractMessageCompletedData()` — from stream complete payload
- [x] Implement data extractors for each admin event type:
  - [x] `extractAdminUserData()` — from auth user action payload
  - [x] `extractAdminWorkspaceData()` — from workspace action payload
  - [x] `extractAdminPluginData()` — from plugin action payload
  - [x] `extractAdminErrorData()` — from sync/storage error payload
  - [x] `extractAdminJobData()` — from background job completion/failure
- [x] Implement `serializeHookArgs()` — best-effort JSON serialization for custom hook payloads
- [x] Write unit tests:
  - [x] Envelope has all required fields
  - [x] `event_id` is unique per call
  - [x] Message content truncated at 4KB
  - [x] No sensitive fields in output
  - [x] Admin envelope includes `scope: 'admin'`
  - [x] Custom hook serialization handles non-serializable values gracefully

**Requirements**: 2.2, 9.3, 9.6

### 3.3 Webhook Dispatcher
- [x] Create `server/utils/webhooks/dispatcher.ts` — `createWebhookDispatcher(store, config, workerId?)`
- [x] Implement `enqueue()` — creates delivery log entry with `status: 'pending'`, `attempt: 1`, `next_retry_at: now`
- [x] Implement `claimAndProcess()` — call `store.claimPendingDeliveries(workerId, batchSize)`, attempt delivery for each claimed row using SSRF-safe agent
- [x] Implement retry logic with exponential backoff schedule (0s, 30s, 2m, 10m, 30m, 60m)
- [x] Implement `sendTestPing()` — sends `webhook.test` event and returns result (uses SSRF-safe agent)
- [x] Implement `start()` / `stop()` — setInterval loop (5s) calling `claimAndProcess()`
- [x] On final failure: call a helper backed by `server/utils/notifications/registry.ts` that resolves the active server notification emitter and emits a dedicated webhook-delivery-failed notification
- [x] Use `createSsrfSafeAgent()` for all outbound webhook HTTP requests
- [x] Write unit tests (mocked HTTP + store):
  - [x] Successful delivery logs as `success`
  - [x] Failed delivery schedules retry with correct delay
  - [x] Final failure marks as `failed` and triggers notification via the server notification emitter registry helper
  - [x] Cancelled delivery when webhook disabled mid-retry
  - [x] Test ping returns correct result shape
  - [x] Rate-limited events are dropped and logged
  - [x] SSRF-safe agent blocks private IP at dispatch time
  - [x] Concurrent dispatchers (different workerId) never process the same delivery

**Requirements**: 4.1, 4.2, 4.3, 4.4, 5.3

### 3.4 Event Bridge
- [x] Create `server/utils/webhooks/event-bridge.ts` — `createWebhookEventBridge(store, dispatcher, nitroApp)`
- [x] Implement user hook-to-event mapping: listen on `nitroApp.hooks` for user events using `nitroApp.hooks.hook(hookName, handler)`
- [x] Implement admin hook-to-event mapping: listen on `nitroApp.hooks` for admin events using `nitroApp.hooks.hook(hookName, handler)`
- [x] Implement subscription fan-out: on hook fire, query active webhooks for event type (scoped), build payload, enqueue per webhook
- [x] Fast-path: skip entirely when zero subscriptions exist for event type
- [x] Implement admin workspace filtering: if admin webhook has `workspace_id` set, only deliver matching events
- [x] Implement custom hook listener management:
  - [x] `refreshCustomHookListeners()` — diff active custom hook names vs. current bindings on `nitroApp.hooks`, add/remove listeners
  - [x] Custom hook listener: serialize hook args, enqueue to all admin webhooks subscribing to that hook
  - [x] Clean up bindings when webhooks are deleted/disabled
- [x] Workspace ID extraction from hook context
- [x] `start()` / `stop()` for listener lifecycle
- [x] Write unit tests:
  - [x] Correct event type mapping for all 10 user hook → event pairs
  - [x] Correct event type mapping for all admin hook → event pairs
  - [x] Fan-out creates one delivery per subscribed webhook
  - [x] No delivery when no subscriptions
  - [x] Disabled webhooks are skipped
  - [x] Admin webhook with workspace filter only receives matching events
  - [x] Custom hook listener fires via `nitroApp.hooks` and serializes payload correctly
  - [x] Custom hook listener cleanup when webhook deleted
  - [x] `refreshCustomHookListeners()` correctly diffs and updates bindings on `nitroApp.hooks`

**Requirements**: 2.1, 4.1, 8.1, 9.2, 9.3, 9.4

---

## Phase 4: API Routes

### 4.1 Disable All Webhooks Route
- [x] Create `server/api/webhooks/disable-all.post.ts` — disable all user webhooks in current workspace
  - [x] Call `store.disableAllWebhooks(userId, workspaceId)`
  - [x] Return count of disabled webhooks
- [x] Write integration tests:
  - [x] Disables all active webhooks for user in workspace
  - [x] Returns correct count
  - [x] Does not affect other users' webhooks
  - [x] Unauthenticated requests return 401

**Requirements**: 1.2, 5.4

### 4.2 Webhook CRUD Routes
- [x] Create `server/api/webhooks/index.get.ts` — list user's webhooks in current workspace
- [x] Create `server/api/webhooks/index.post.ts` — create webhook with validation
  - [x] Generate per-webhook signing secret, encrypt and store on registration
  - [x] Return signing secret once in response (raw, never retrievable again)
  - [x] Validate URL format + HTTPS policy + private IP policy
  - [x] Validate events array (non-empty, all valid event types)
  - [x] Validate webhook count limit
- [x] Create `server/api/webhooks/[id].patch.ts` — update webhook URL/label/events
  - [x] Re-validate URL if changed
  - [x] Reset health to `unknown` if URL changed
- [x] Create `server/api/webhooks/[id].delete.ts` — delete webhook + delivery logs + cancel pending
- [x] Create `server/api/webhooks/[id]/toggle.post.ts` — enable/disable webhook
- [x] Write integration tests:
  - [x] Full CRUD lifecycle
  - [x] Validation errors (bad URL, no events, invalid event type, limit exceeded)
  - [x] Cross-user access denied (403)
  - [x] Delete also removes delivery logs

**Requirements**: 3.1, 3.2, 3.3, 3.4, 3.5, 5.3, 5.4

### 4.3 Test Ping Route
- [x] Create `server/api/webhooks/[id]/test.post.ts` — send test ping to webhook endpoint
  - [x] Return success/failure, status code, duration
  - [x] Log test ping in delivery log
- [x] Write integration tests:
  - [x] Test ping to working endpoint returns success
  - [x] Test ping to failing endpoint returns failure details
  - [x] Test ping appears in delivery log

**Requirements**: 6.5

### 4.4 Delivery Log Route
- [x] Create `server/api/webhooks/[id]/logs.get.ts` — return delivery logs for last 72h (configurable)
  - [x] Accept optional `since` query param for custom time range
  - [x] Return newest first, include full payload + response body
- [x] Write integration tests:
  - [x] Returns logs within time window
  - [x] Excludes logs outside time window
  - [x] Includes request payload and response body

**Requirements**: 6.4

---

## Phase 5: Server Plugin & Lifecycle

### 5.1 Nitro Plugin
- [x] Create `server/plugins/webhooks.ts`
  - [x] Gate on `config.webhooks.enabled`
  - [x] Validate encryption key exists, warn and bail if not
  - [x] Register default SQLite store if no provider has registered one
  - [x] Generate `workerId` via `crypto.randomUUID()`
  - [x] Create and start `WebhookDispatcher` with `createWebhookDispatcher(store, config.webhooks, workerId)`
  - [x] Create and start `WebhookEventBridge` with `createWebhookEventBridge(store, dispatcher, nitroApp)`
  - [x] Claim and process pending deliveries on startup (crash recovery)
  - [x] Set up hourly log cleanup interval
  - [x] Set up 2-minute reaper interval: `store.resetStaleInFlightDeliveries(5 * 60 * 1000)`
  - [x] Register graceful shutdown hook (stop bridge, stop dispatcher, clear all intervals)
- [x] Write integration test:
  - [x] Plugin starts when enabled
  - [x] Plugin skips when disabled
  - [x] Plugin skips when no encryption key
  - [x] Pending deliveries are claimed and processed on startup
  - [x] Reaper resets stale in_flight deliveries

**Requirements**: 7.1, 8.2

### 5.2 Hook Integration
- [x] Determine capture points for each user event type:
  - [x] Thread events: fire via `nitroApp.hooks.callHook()` at sync gateway apply layer
  - [x] Message events: fire via `nitroApp.hooks.callHook()` at sync gateway apply layer
  - [x] Document events: fire via `nitroApp.hooks.callHook()` at sync gateway apply layer
  - [x] `message.completed`: Background: capture from background streaming handler completion; Foreground SSR: capture when response stream ends in SSR handler and fire via `nitroApp.hooks.callHook('ai.chat.stream:action:complete', ...)`
  - [x] `notification.created`: capture from the server notification emitter implementation by mirroring a server-side `notify:action:push` event onto `nitroApp.hooks`
- [x] Determine capture points for each admin event type:
  - [x] `admin.user.created`: hook on `nitroApp.hooks.hook('auth.user:action:created', ...)`
  - [x] `admin.workspace.created/deleted`: hook on `nitroApp.hooks.hook('admin.workspace:action:created/deleted', ...)`
  - [x] `admin.user.role_changed`: hook on `nitroApp.hooks.hook('admin.user:action:role_changed', ...)`
  - [x] `admin.plugin.*`: hook on `nitroApp.hooks.hook('admin.plugin:action:installed/enabled/disabled', ...)`
  - [x] `admin.sync.error`: hook on `nitroApp.hooks.hook('sync:action:error', ...)`
  - [x] `admin.storage.error`: hook on `nitroApp.hooks.hook('storage:action:error', ...)`
  - [x] `admin.job.completed/failed`: capture from background job provider completion/failure callbacks
- [x] Wire event bridge listeners to all capture points via `nitroApp.hooks` (user + admin + custom)
- [x] Verify zero-overhead when no subscriptions exist (fast Map lookup)
- [x] Call `refreshCustomHookListeners()` on bridge start and after admin webhook mutations

**Requirements**: 2.1, 8.1, 9.2, 9.3

---

## Phase 6: Dashboard UI

### 6.1 Dashboard Plugin Registration
- [x] Create `app/plugins/webhooks-dashboard.client.ts`
  - [x] Gate on `runtimeConfig.public.webhooks.enabled`
  - [x] Register dashboard plugin with id `core:webhooks`, icon `i-lucide-webhook`, order 50
  - [x] Register single page: `webhooks-manage`

**Requirements**: 6.1

### 6.2 Webhooks List
- [x] Create `app/components/dashboard/webhooks/WebhooksList.vue`
  - [x] Empty state: "No webhooks yet" + CTA button
  - [x] Webhook row: health dot, label/URL, event badges (UBadge), last delivery time, action buttons
  - [x] Actions: Logs, Test, Edit, Delete (with confirmation), Enable/Disable toggle
  - [x] Health dot colors: green (healthy), amber (failing), gray (disabled), neutral (unknown)
  - [x] "New Webhook" button in section header

**Requirements**: 6.2

### 6.3 Webhook Create/Edit Form
- [x] Create `app/components/dashboard/webhooks/WebhookForm.vue`
  - [x] Slide-over or modal form
  - [x] URL input with inline validation (valid URL format, HTTPS check based on config)
  - [x] Label input (optional, max 100 chars)
  - [x] Event type checkboxes with descriptions + "Select All" / "Deselect All"
  - [x] Save + Cancel buttons
  - [x] Validation: URL required, at least 1 event, client-side URL format check
  - [x] Works for both create and edit modes
  - [x] On successful creation: display signing secret in highlighted box with copy button and "save now" warning

**Requirements**: 3.1, 3.2, 6.3

### 6.4 Delivery Log View
- [x] Create `app/components/dashboard/webhooks/WebhookDeliveryLog.vue`
  - [x] Opens when "Logs" clicked on a webhook
  - [x] Fetches logs from last 72 hours
  - [x] Each row: event badge, timestamp (relative), HTTP status badge, duration, attempt number
  - [x] Expandable detail: JSON viewer for request payload, truncated response body
  - [x] Refresh button
  - [x] Empty state: "No deliveries yet"

**Requirements**: 6.4

### 6.5 Test Ping
- [x] Create `app/components/dashboard/webhooks/WebhookTestPing.vue`
  - [x] Inline result component (appears after clicking "Test")
  - [x] Shows success/failure with status code and duration
  - [x] Auto-dismisses after 10 seconds

**Requirements**: 6.5

### 6.6 Main Page Assembly
- [x] Create `app/components/dashboard/webhooks/WebhooksPage.vue`
  - [x] Composes `WebhooksList` + "Disable All" bulk action button
  - [x] Conditionally shows `WebhookForm` (slide-over) — displays signing secret on successful creation
  - [x] Conditionally shows `WebhookDeliveryLog` (expandable)
  - [x] Handles loading/error states
  - [x] Uses `useFetch` for API calls with proper error handling

**Requirements**: 6.1

---

## Phase 7: Testing & Polish

### 7.1 Integration Test Suite
- [x] Webhook delivery end-to-end: create webhook → signing secret returned → simulate hook fire → verify delivery at mock endpoint
- [x] Retry behavior: mock failing endpoint → verify retry attempts → verify final failure notification via the server notification emitter registry helper
- [x] Disable all webhooks flow: create webhooks → disable all → verify deliveries stop
- [x] Rate limit enforcement: burst events → verify excess dropped
- [x] Multi-worker safety: concurrent claimPendingDeliveries() → no duplicate processing
- [x] Stale reaper: simulate crashed worker → verify reaper resets in_flight to pending
- [x] Foreground SSR completion: SSR stream ends → message.completed hook fires → webhook delivered

**Requirements**: 4.1, 4.2, 4.3, 4.4

### 7.2 Security Tests
- [x] Signature verification: take a delivered payload → verify HMAC-SHA256 over `{timestamp}.{body}` matches using per-webhook signing secret
- [x] Cross-user access: user A cannot see/modify user B's webhooks
- [x] Unauthenticated access: all routes return 401 without session
- [x] Signing secret not retrievable after creation (only returned once)
- [x] Signing secret encrypted at rest (AES-256-GCM)
- [x] SSRF protection: dispatch-time DNS resolution blocks private IPs even when CRUD validation passes
- [x] DNS rebind test: hostname that resolves to public IP at CRUD time but private IP at dispatch time → blocked

**Requirements**: 5.1, 5.2, 5.3, 5.4

### 7.3 Performance Validation
- [x] Verify hook capture adds < 2ms overhead (benchmark with zero subscriptions)
- [x] Verify delivery loop doesn't block request handling
- [x] Verify delivery log queries are indexed (explain query plan)

**Requirements**: 8.1

### 7.4 Documentation
- [x] Add webhook event type reference to `public/_documentation/` (both user and admin catalogs)
- [x] Add signature verification code examples (Node.js, Python)
- [x] Add webhook configuration reference to admin docs
- [x] Document admin advanced mode (custom hook subscription) with examples
- [x] Update `planning/webhooks/` docs with final implementation notes

**Requirements**: 5.1, 7.1, 9.3

---

## Phase 8: Admin Webhook Routes & UI

### 8.1 Admin Webhook API Routes
- [x] Create `server/api/admin/webhooks/index.get.ts` — list all admin webhooks, require `requireAdminApiContext({ superAdminOnly: true })`
- [x] Create `server/api/admin/webhooks/index.post.ts` — create admin webhook
  - [x] Generate signing secret, encrypt and store on the registration itself
  - [x] Return signing secret once in response
  - [x] Accept `events` (curated) + `custom_hooks` (raw server-side hook names) + optional `workspace_id` filter
  - [x] Validate curated events are valid admin event types
  - [x] Validate custom hook names follow format pattern (non-empty, contains `:action:` or `:filter:`)
  - [x] Validate webhook count limit (`adminMax`)
  - [x] Set `scope: 'admin'`, `user_id: null`
- [x] Create `server/api/admin/webhooks/[id].patch.ts` — update admin webhook
  - [x] Re-validate URL if changed, reset health
  - [x] Support updating `custom_hooks` and `workspace_id`
  - [x] Call `bridge.refreshCustomHookListeners()` after mutation
- [x] Create `server/api/admin/webhooks/[id].delete.ts` — delete admin webhook + logs + cancel pending
  - [x] Call `bridge.refreshCustomHookListeners()` after deletion
- [x] Create `server/api/admin/webhooks/[id]/toggle.post.ts` — enable/disable admin webhook
  - [x] Call `bridge.refreshCustomHookListeners()` after toggle
- [x] Create `server/api/admin/webhooks/[id]/test.post.ts` — send test ping
- [x] Create `server/api/admin/webhooks/[id]/logs.get.ts` — delivery logs (last 72h)
- [x] Write integration tests:
  - [x] Full admin webhook CRUD lifecycle
  - [x] Curated + custom hook creation
  - [x] Signing secret returned once at creation
  - [x] Non-admin access denied (403)
  - [x] Workspace filter applied to event fan-out
  - [x] Custom hook format validation
  - [x] Admin webhook limit enforced

**Requirements**: 9.1, 9.2, 9.3, 9.4, 9.5

### 8.2 Admin Panel Webhook Page
- [x] Create admin panel page at `/admin/webhooks`
  - [x] List all admin webhooks with health badges, event counts, workspace scope indicator
  - [x] Show "+ N custom hooks" indicator when custom_hooks is non-empty
  - [x] Actions: Logs, Test, Edit, Delete (with confirmation), Enable/Disable toggle
- [x] Create admin webhook create/edit form:
  - [x] URL input with validation
  - [x] Label input
  - [x] Curated admin event checkboxes with descriptions
  - [x] **Advanced section** (collapsible, closed by default):
    - [x] Header: "Subscribe to any server-side hook"
    - [x] Disclaimer text about unstable schemas
    - [x] Dynamic rows: text input for hook name + remove button
    - [x] "Add custom hook" button
    - [x] Basic format validation on hook names
  - [x] Optional workspace selector (dropdown of workspaces, "All workspaces" default)
  - [x] Save / Cancel buttons
- [x] Show signing secret once at creation (highlighted box, copy button, "save now" warning — same pattern as user webhook creation)
- [x] Delivery log view (same UX as user dashboard)
- [x] Test ping (same UX as user dashboard)

**Requirements**: 9.1, 9.2, 9.3, 9.4, 9.5

### 8.3 Admin Webhook Integration Tests
- [x] Admin full flow: create admin webhook (curated + custom) → trigger admin hook → verify delivery at mock endpoint
- [x] Custom hook delivery: register custom hook `db.messages.create:action:after` → trigger that hook → verify serialized payload delivered
- [x] Workspace filter: create admin webhook with workspace_id → trigger event from matching workspace → delivery sent; trigger from different workspace → no delivery
- [x] Admin webhook limit enforcement
- [x] Signing secret verification on admin webhook deliveries

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
