# OR3 Cloud Webhooks — Requirements

## Introduction

OR3 Cloud Webhooks allow users and site administrators to subscribe to real-time events from their OR3 instance and receive HTTP POST notifications at external endpoints. This is an **OR3 Cloud exclusive** feature — it requires SSR auth to be enabled and is part of the core cloud platform (not a provider package).

The system operates at **two scopes** sharing a unified delivery engine:

1. **User Webhooks** — workspace members subscribe to curated content events (threads, messages, documents, notifications) through the user dashboard. Each webhook gets its own HMAC-SHA256 signing secret for payload verification.
2. **Admin Webhooks** — super admins subscribe to instance-level operational events (user provisioning, workspace lifecycle, plugin management, errors) through the admin panel at `/admin/webhooks`. Authenticated via admin JWT session. Supports an advanced mode for subscribing to any server-side hook name mirrored onto `nitroApp.hooks`.

The design prioritizes **simplicity, security, and developer experience** — giving users exactly the events they need without overwhelming complexity, while giving admins full power when they need it.

### Scope

- Per-webhook signing secrets with HMAC-SHA256 payload signing (both user and admin scopes)
- User webhooks authenticated via SSR session (user scope)
- Admin webhooks authenticated via admin JWT session (admin scope)
- Curated event catalogs for both scopes + advanced raw server-hook subscription for admins
- User dashboard UI for key management, webhook CRUD, test pings, and delivery logs
- Admin panel page at `/admin/webhooks` for instance-level webhook management
- Shared delivery engine: best-effort with exponential backoff (up to 1 hour), then persist-and-notify on failure
- Admin-configurable rate limits, HTTPS enforcement, and URL validation
- Optional workspace filtering for admin webhooks
- Lightweight core implementation using the existing store registry pattern

### Out of Scope

- Webhook event transformations / custom payload shaping (v2)
- Fan-out to message queues (Kafka, SQS, etc.)
- Inbound webhooks (receiving events from external systems)
- Per-event filtering / conditional rules beyond workspace filter (v2)

---

## Requirements

### 1. Webhook Signing Secrets

#### 1.1 Per-Webhook Signing Secret

**User Story**: As a developer, I want each webhook to have its own signing secret so that I can verify incoming payloads are authentic.

**Acceptance Criteria**:
- WHEN a webhook is created THEN the system SHALL generate a cryptographically random signing secret (minimum 32 bytes, hex-encoded, prefixed `whs_`).
- WHEN the webhook is created THEN the signing secret SHALL be displayed **once** in the UI with a copy button and a "Save this now — you won't see it again" warning.
- The signing secret SHALL be stored encrypted at rest (AES-256-GCM). The raw secret SHALL NOT be retrievable after creation.
- IF no encryption key is available THEN webhook creation SHALL be denied and the system SHALL log a warning.

#### 1.2 Disable All Webhooks

**User Story**: As a workspace member, I want a quick way to disable all my webhooks if I suspect a compromise.

**Acceptance Criteria**:
- The dashboard SHALL provide a "Disable All Webhooks" action that disables all webhooks for the current user + workspace pair.
- WHEN webhooks are bulk-disabled THEN any in-flight deliveries for those webhooks SHALL be cancelled on next delivery attempt.
- Disabled webhooks SHALL be preserved (not deleted) for re-enablement.

---

### 2. Webhook Event Types

#### 2.1 Curated Event Catalog

**User Story**: As a developer, I want a clear, concise list of webhook events so that I can subscribe only to what I need without wading through hundreds of internal hooks.

**Acceptance Criteria**:
- The system SHALL expose the following webhook event types (and only these):

| Event Name | Fires When | Source Hook(s) |
|---|---|---|
| `thread.created` | A new thread is created | `db.threads.create:action:after` |
| `thread.updated` | Thread title/metadata changes | `db.threads.update:action:after` |
| `thread.deleted` | Thread is soft-deleted | `db.threads.delete:action:soft:after` |
| `message.created` | New message is persisted | `db.messages.create:action:after` |
| `message.updated` | Message content is edited | `db.messages.update:action:after` |
| `message.completed` | AI streaming finishes for a message | Background: stream-handler completion; Foreground SSR: response stream end |
| `document.created` | New document is created | `db.documents.create:action:after` |
| `document.updated` | Document content changes | `db.documents.update:action:after` |
| `document.deleted` | Document is soft-deleted | `db.documents.delete:action:soft:after` |
| `notification.created` | A notification is pushed | `notify:action:push` |

- Each event type SHALL have a stable, documented JSON schema for its payload.
- New event types SHALL only be added through explicit code changes (not user-configurable).

#### 2.2 Event Payload Structure

**Acceptance Criteria**:
- Every webhook payload SHALL include a standard envelope:
  - `event` — the event type string (e.g., `thread.created`)
  - `event_id` — unique UUID for idempotency
  - `timestamp` — ISO 8601 UTC timestamp
  - `workspace_id` — the workspace context
  - `user_id` — the user who owns this webhook subscription
  - `data` — event-specific payload (entity snapshot or relevant fields)
- The `data` field SHALL use snake_case keys aligned with Dexie/wire schema.
- Payloads SHALL NOT include sensitive fields (API keys, passwords, tokens, signing secrets).

---

### 3. Webhook Registration

#### 3.1 Create Webhook

**User Story**: As a developer, I want to register a webhook endpoint for specific event types so that my external systems receive real-time notifications.

**Acceptance Criteria**:
- WHEN a user creates a webhook THEN they SHALL specify:
  - A target URL
  - One or more event types from the curated catalog (2.1)
  - An optional human-readable label (max 100 chars)
- WHEN created THEN the webhook SHALL default to **enabled**.
- WHEN created THEN the system SHALL generate and return a signing secret for the webhook (displayed once, see §1.1).
- The system SHALL validate the URL format (valid URL syntax).
- IF `security.forceHttps` is `true` (production mode) THEN only HTTPS URLs SHALL be accepted.
- IF `security.forceHttps` is `false` (dev mode) THEN HTTP URLs SHALL also be accepted.

#### 3.2 Update Webhook

**User Story**: As a developer, I want to update my webhook's URL, events, or label without recreating it.

**Acceptance Criteria**:
- WHEN a user updates a webhook THEN they SHALL be able to change the URL, event subscriptions, and label.
- WHEN the URL changes THEN the webhook health status SHALL reset to `unknown`.

#### 3.3 Delete Webhook

**Acceptance Criteria**:
- WHEN a user deletes a webhook THEN it SHALL be permanently removed along with its delivery history.
- In-flight retries for the deleted webhook SHALL be cancelled.

#### 3.4 Enable / Disable Webhook

**User Story**: As a developer, I want to temporarily pause a webhook without losing its configuration.

**Acceptance Criteria**:
- WHEN a webhook is disabled THEN the system SHALL stop queuing new events for it.
- WHEN a webhook is re-enabled THEN it SHALL start receiving new events (missed events during disable are NOT retroactively sent).

#### 3.5 Webhook Limits

**Acceptance Criteria**:
- Each user SHALL be limited to a configurable maximum number of webhooks per workspace (default: **20**).
- The max webhooks limit SHALL be configurable via `OR3_WEBHOOKS_MAX_PER_USER` env var.

---

### 4. Webhook Delivery

#### 4.1 Delivery Mechanism

**User Story**: As a developer, I want reliable webhook delivery so that my systems don't miss important events.

**Acceptance Criteria**:
- WHEN a subscribed event fires THEN the system SHALL HTTP POST the signed payload to the registered URL within **5 seconds** (best-effort, not guaranteed).
- The delivery SHALL include these headers:
  - `Content-Type: application/json`
  - `X-OR3-Event: <event_type>`
  - `X-OR3-Signature: sha256=<hex HMAC-SHA256 of "{timestamp}.{body}" using signing secret>`
  - `X-OR3-Event-ID: <event_id UUID>`
  - `X-OR3-Timestamp: <unix seconds>`
  - `User-Agent: OR3-Webhooks/1.0`
- The delivery SHALL have a **10-second timeout** per attempt.
- A delivery SHALL be considered successful IF the target returns HTTP 2xx.

#### 4.2 Retry Strategy

**Acceptance Criteria**:
- IF the first delivery attempt fails (network error, timeout, or non-2xx response) THEN the system SHALL retry with exponential backoff:
  - Attempt 1: immediate
  - Attempt 2: 30 seconds
  - Attempt 3: 2 minutes
  - Attempt 4: 10 minutes
  - Attempt 5: 30 minutes
  - Attempt 6: 60 minutes (final)
- IF all 6 attempts fail THEN the event SHALL be marked as `failed` in the delivery log and a notification SHALL be emitted via the existing server-side notification emitter registry (`server/utils/notifications/registry.ts`), extended with a dedicated webhook-delivery-failed method.
- The system SHALL persist delivery attempts (timestamp, status code, error message) for debugging.
- IF the webhook is disabled or deleted during retries THEN remaining attempts SHALL be cancelled.

#### 4.4 Multi-Worker Safety

**Acceptance Criteria**:
- Delivery logs SHALL support an `in_flight` status in addition to `pending`, `success`, `failed`, and `cancelled`.
- WHEN a delivery worker picks up pending deliveries THEN it SHALL atomically transition them from `pending` to `in_flight` before processing. This prevents duplicate deliveries when multiple Nitro workers share the same store.
- The atomic claim SHALL be implemented as a single store operation (`claimPendingDeliveries`) that returns only the rows successfully claimed by the calling worker.
- IF a worker crashes while holding `in_flight` rows THEN a periodic reaper SHALL reset any `in_flight` rows older than **2 minutes** back to `pending` for re-processing.
- Each dispatcher instance SHALL generate a random `workerId` (UUID) at startup for diagnostics. The worker ID is stored on claimed rows for debugging but is not used for coordination.

#### 4.3 Delivery Rate Limiting

**Acceptance Criteria**:
- The system SHALL enforce a per-webhook rate limit (default: **120 events per minute**).
- IF the rate limit is exceeded THEN excess events SHALL be dropped and logged (not queued indefinitely).
- Rate limit defaults SHALL be configurable via `OR3_WEBHOOKS_RATE_LIMIT_PER_MINUTE` env var.
- The rate limit implementation SHALL use a simple fixed-window counter that is easy to swap for a sliding-window or token-bucket implementation later.

---

### 5. Security

#### 5.1 Payload Signing

**User Story**: As a developer, I want to verify that incoming webhook payloads are authentic and untampered.

**Acceptance Criteria**:
- Every delivery SHALL include an `X-OR3-Signature` header containing `sha256=<hex>` where the HMAC-SHA256 is computed over the string `{timestamp}.{body}` — the `X-OR3-Timestamp` value (unix seconds), a literal dot, and the raw JSON body — using the webhook's signing secret. This follows the Stripe/Shopify pattern and prevents replay attacks.
- The system SHALL also include `X-OR3-Timestamp` (unix seconds) so receivers can reject stale payloads (recommended: reject if >5 minutes old).
- Documentation SHALL include code examples (Node.js, Python) for signature verification.

#### 5.2 Secret Storage

**Acceptance Criteria**:
- Signing secrets SHALL be stored encrypted at rest (AES-256-GCM using a server-side encryption key derived from `OR3_WEBHOOKS_ENCRYPTION_KEY` or `OR3_ADMIN_JWT_SECRET`).
- The raw signing secret SHALL be shown once at webhook creation and never stored in plaintext.
- IF no encryption key is available THEN the system SHALL refuse to create webhooks and log a warning.

#### 5.3 URL Validation

**Acceptance Criteria**:
- The system SHALL validate that webhook URLs are syntactically valid.
- IF `security.forceHttps` is enabled THEN only `https://` URLs SHALL be accepted.
- Private/internal IP blocking SHALL be **disabled by default** (to support dev/internal use) but SHALL be enableable via `OR3_WEBHOOKS_BLOCK_PRIVATE_IPS=true`.
- WHEN private IP blocking is enabled THEN the system SHALL reject URLs resolving to RFC 1918, loopback, link-local, or IPv6 private ranges.
- WHEN private IP blocking is enabled THEN the system SHALL **also** validate the resolved IP at dispatch time (not only at webhook creation). This prevents DNS rebinding attacks where a hostname passes validation at creation but later resolves to a private IP. The dispatcher SHALL use a custom HTTP agent that checks the resolved IP in the connection callback before allowing the request.

#### 5.4 Access Control

**Acceptance Criteria**:
- All webhook API endpoints SHALL require a valid SSR auth session with an active workspace.
- Users SHALL only be able to manage their own webhooks (no cross-user access).
- Super admins SHALL be able to view (but not modify) any user's webhooks via admin API for diagnostics.

---

### 6. Dashboard UI

#### 6.1 Webhook Dashboard Page

**User Story**: As a user, I want a dedicated dashboard page to manage my webhooks in one place.

**Acceptance Criteria**:
- The webhook management page SHALL be registered as a dashboard plugin page under a "Webhooks" tile/icon.
- The page SHALL only be visible when OR3 Cloud (SSR auth) is enabled.
- The page SHALL have a primary section:
  1. **Webhooks** — list of registered webhooks with status badges, event counts, and action buttons.
  2. **Bulk Actions** — "Disable All Webhooks" button for emergency kill-switch.

#### 6.2 Webhook List View

**Acceptance Criteria**:
- Each webhook row SHALL display:
  - Label (or URL if no label)
  - URL (truncated with tooltip for full)
  - Subscribed event types as compact badges
  - Health status badge: `healthy` (green), `failing` (amber), `disabled` (gray), `unknown` (neutral)
  - Last delivery timestamp
  - Enable/disable toggle
  - Edit and delete action buttons
- Health status SHALL be derived from the last 3 delivery attempts:
  - All 3 succeeded → `healthy`
  - Any failed → `failing`
  - No attempts yet → `unknown`

#### 6.3 Webhook Create/Edit Form

**Acceptance Criteria**:
- The form SHALL include:
  - URL input with validation feedback
  - Label input (optional)
  - Event type checkboxes with descriptions
  - Save / Cancel buttons
- The form SHALL provide inline validation (URL format, at least one event selected).
- The form SHALL be a slide-over or modal (not a separate page) to keep navigation simple.

#### 6.4 Delivery Log

**User Story**: As a developer, I want to see recent delivery attempts so that I can debug integration issues.

**Acceptance Criteria**:
- Each webhook SHALL have a "View Logs" action that opens a delivery log view.
- The log SHALL show deliveries from the **last 72 hours**.
- Each log entry SHALL display:
  - Event type
  - Timestamp
  - HTTP status code (or error type for network failures)
  - Attempt number
  - Duration (ms)
- Users SHALL be able to expand a log entry to inspect the **full request payload** and **response body** (first 4KB, truncated with indicator).
- The log SHALL auto-refresh or have a manual refresh button.

#### 6.5 Test Ping

**User Story**: As a developer, I want to send a test ping to my webhook endpoint so that I can verify connectivity before relying on it.

**Acceptance Criteria**:
- Each webhook SHALL have a "Send Test Ping" button.
- The test ping SHALL send a payload with `event: "webhook.test"` and a sample data object.
- The result (success/failure, status code, latency) SHALL be displayed inline immediately.
- Test pings SHALL appear in the delivery log.

---

### 7. Configuration

#### 7.1 Admin Configuration

**User Story**: As a super admin, I want to configure webhook system limits and security policies via environment variables.

**Acceptance Criteria**:
- The following environment variables SHALL be supported:

| Variable | Default | Description |
|---|---|---|
| `OR3_WEBHOOKS_ENABLED` | `true` (when SSR auth enabled) | Master switch for webhook system |
| `OR3_WEBHOOKS_MAX_PER_USER` | `20` | Max webhooks per user per workspace |
| `OR3_WEBHOOKS_ADMIN_MAX` | `50` | Max admin webhooks per instance |
| `OR3_WEBHOOKS_RATE_LIMIT_PER_MINUTE` | `120` | Max events per minute per webhook |
| `OR3_WEBHOOKS_DELIVERY_TIMEOUT_MS` | `10000` | HTTP timeout per delivery attempt |
| `OR3_WEBHOOKS_BLOCK_PRIVATE_IPS` | `false` | Block private/internal IP targets |
| `OR3_WEBHOOKS_ENCRYPTION_KEY` | falls back to `OR3_ADMIN_JWT_SECRET` | Encryption key for signing secrets |
| `OR3_WEBHOOKS_MAX_RETRY_HOURS` | `1` | Max retry window before marking failed |
| `OR3_WEBHOOKS_LOG_RETENTION_HOURS` | `72` | How long to keep delivery logs |

- All variables SHALL be read through `config.or3cloud.ts` and exposed via `runtimeConfig`.

---

### 8. Non-Functional Requirements

#### 8.1 Performance

- Webhook event capture (from hook fire to queue insertion) SHALL add less than **2ms** to the hot path.
- The webhook dispatch loop SHALL run asynchronously and SHALL NOT block request handling.
- Delivery log queries SHALL be indexed by webhook ID + timestamp.

#### 8.2 Reliability

- The system SHALL survive server restarts by persisting pending deliveries to the webhook store.
- On server startup, the system SHALL resume any pending deliveries from the store.

#### 8.3 Observability

- The system SHALL log webhook delivery attempts at `debug` level and failures at `warn` level.
- Failed deliveries after exhausting retries SHALL be logged at `error` level.

---

### 9. Admin Webhooks

#### 9.1 Admin Webhook Authentication

**User Story**: As a super admin, I want to register webhooks using my admin session so that the setup is streamlined.

**Acceptance Criteria**:
- Admin webhook API endpoints SHALL be under `server/api/admin/webhooks/` and require `requireAdminApiContext()` with `superAdminOnly: true`.
- Admin webhooks SHALL NOT require any additional key — the admin JWT session is the sole authentication.
- Payload signing for admin webhooks SHALL use the same per-webhook signing secret pattern as user webhooks — generated at creation, encrypted with `OR3_WEBHOOKS_ENCRYPTION_KEY` / `OR3_ADMIN_JWT_SECRET`, displayed once, and not retrievable afterward.

#### 9.2 Curated Admin Event Catalog

**User Story**: As a super admin, I want a clear set of operational events I can subscribe to so that I can monitor my instance without guessing hook names.

**Acceptance Criteria**:
- The admin panel SHALL display the following curated events with checkboxes and descriptions:

| Event Name | Fires When | Source Hook(s) |
|---|---|---|
| `admin.user.created` | A new user is provisioned | `auth.user:action:created` |
| `admin.workspace.created` | A workspace is created | `admin.workspace:action:created` |
| `admin.workspace.deleted` | A workspace is deleted | `admin.workspace:action:deleted` |
| `admin.user.role_changed` | A user's role changes | `admin.user:action:role_changed` |
| `admin.plugin.installed` | A plugin/theme is installed | `admin.plugin:action:installed` |
| `admin.plugin.enabled` | A plugin is enabled | `admin.plugin:action:enabled` |
| `admin.plugin.disabled` | A plugin is disabled | `admin.plugin:action:disabled` |
| `admin.sync.error` | A sync error occurs | `sync:action:error` |
| `admin.storage.error` | A storage error occurs | `storage:action:error` |
| `admin.job.completed` | A background job finishes | background job completion |
| `admin.job.failed` | A background job fails | background job failure |

- Each admin event type SHALL have a stable, documented JSON schema.

#### 9.3 Advanced Custom Hook Subscription

**User Story**: As a power-user admin, I want to subscribe to any server-side hook by name so that I can capture events not in the curated list without waiting for a code change.

**Acceptance Criteria**:
- The admin webhook form SHALL include an **"Advanced"** collapsible section below the curated checkboxes.
- The Advanced section SHALL provide a text input where the admin can type a raw server-side hook name (e.g., `db.messages.create:action:after`, `admin.workspace:action:created`).
- Multiple custom hooks SHALL be supported (add/remove rows).
- The system SHALL validate that the hook name is a non-empty string and follows the `<namespace>.<entity>.<op>:<kind>:<phase>` pattern (basic format check, not existence check — hooks may be added by plugins).
- Only hooks that are emitted on the server-side process bus (`nitroApp.hooks`) SHALL be deliverable. Client-only app hook engine events are out of scope for admin advanced mode.
- Custom hook events SHALL be delivered with `event` set to the raw hook name (e.g., `event: "db.messages.create:action:after"`).
- Custom hook payloads SHALL serialize the hook arguments as-is into `data`, with best-effort JSON serialization (non-serializable values are omitted with a warning).
- The Advanced section SHALL display a disclaimer: *"Advanced: Subscribe to any server-side hook mirrored onto the process bus. Payloads are not schema-guaranteed and may change between versions."*

#### 9.4 Workspace Filtering

**User Story**: As a super admin, I want to optionally scope an admin webhook to a specific workspace so that I only receive events relevant to that workspace.

**Acceptance Criteria**:
- Each admin webhook registration SHALL have an optional `workspace_id` filter field.
- IF `workspace_id` is set THEN only events originating from that workspace SHALL be delivered.
- IF `workspace_id` is null/empty THEN events from ALL workspaces SHALL be delivered.
- The admin webhook form SHALL include an optional workspace selector (dropdown of known workspaces).
- The webhook payload SHALL always include `workspace_id` when available, regardless of filter.

#### 9.5 Admin Webhook Management

**User Story**: As a super admin, I want to manage webhooks through the admin panel at `/admin/webhooks`.

**Acceptance Criteria**:
- The admin panel SHALL have a "Webhooks" page accessible from the admin navigation.
- The page SHALL list all admin-registered webhooks with the same health/status/log UX as user webhooks.
- Admin webhooks SHALL support the same operations as user webhooks: create, update, delete, enable/disable, test ping, and delivery logs.
- Admin webhooks SHALL share the same delivery engine, retry logic, rate limiting, and store as user webhooks.
- Admin webhook limits SHALL be configurable via `OR3_WEBHOOKS_ADMIN_MAX` env var (default: **50**).

#### 9.6 Admin Webhook Payload Envelope

**Acceptance Criteria**:
- Admin webhook payloads SHALL use the same envelope structure as user webhooks (`event`, `event_id`, `timestamp`, `data`).
- Admin payloads SHALL include `workspace_id` when the event is workspace-scoped (many admin events include this naturally).
- Admin payloads SHALL include `scope: "admin"` to distinguish from user webhook deliveries.
- Admin payloads SHALL NOT include `user_id` (admin webhooks are not user-scoped).

---

### 10. Shared System Architecture

#### 10.1 Unified Delivery Engine

**Acceptance Criteria**:
- User and admin webhooks SHALL share the same `WebhookDispatcher`, `WebhookStore`, retry logic, and rate limiting.
- The `WebhookRegistration` record SHALL include a `scope` field (`'user' | 'admin'`) to distinguish the two types.
- The `WebhookEventBridge` SHALL handle both user event mapping and admin event mapping (curated + custom hooks) in a single bridge instance.
- Store queries SHALL scope correctly — user API routes only see `scope: 'user'` records, admin API routes only see `scope: 'admin'` records.

#### 10.2 Process-Wide Event Bus

**Acceptance Criteria**:
- The webhook event bridge SHALL use Nitro's process-wide `nitroApp.hooks` as the event bus — NOT the per-request admin hook engine (which is request-scoped and invisible to long-lived listeners).
- Server-side event sources (sync-apply layer, notification emitter, background job handler) SHALL fire webhook events via `nitroApp.hooks.callHook()` so the bridge observes them.
- The bridge SHALL register its listeners on `nitroApp.hooks` during plugin initialization and unregister on shutdown.
