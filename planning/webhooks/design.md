# OR3 Cloud Webhooks — Technical Design

## Overview

The webhook system bridges OR3's internal hook engine to outbound HTTP deliveries. When a subscribed server-side hook fires, the webhook dispatcher captures the event, enqueues a delivery job, and processes it asynchronously with retries.

The system operates at **two scopes** on a shared delivery engine:

1. **User Webhooks** — workspace members manage webhook subscriptions through the user dashboard. 10 curated content events (threads, messages, documents, notifications). Each webhook gets its own signing secret.
2. **Admin Webhooks** — super admins manage webhooks through `/admin/webhooks`. 11 curated operational events + advanced mode for subscribing to any server-side hook name mirrored onto `nitroApp.hooks`. Authenticated via admin JWT session. Optional workspace filtering.

The system follows OR3's established patterns:
- **Store registry** for persistence (works with SQLite, Convex, or any future backend)
- **`nitroApp.hooks`** as the process-wide event bus (not the per-request admin hook engine)
- **Dashboard plugin** for user UI registration
- **Admin panel page** for admin webhook management
- **Cloud config** for admin-tunable settings

---

## Architecture

### System Flow

```mermaid
flowchart TD
    subgraph "Server — Hook Layer"
        A[Hook fires<br/>e.g. db.threads.create:action:after] --> B[WebhookEventBridge]
        B --> C{Any active subscriptions<br/>for this event?}
        C -- No --> D[Skip — zero cost]
        C -- Yes --> E[Build WebhookDeliveryJob]
        B2[Admin/custom hook fires<br/>e.g. admin.workspace:action:created] --> B
    end

    subgraph "Server — Delivery Layer"
        E --> G[WebhookDispatcher]
        G --> H[Sign payload<br/>HMAC-SHA256]
        H --> I[HTTP POST to target URL]
        I --> J{2xx?}
        J -- Yes --> K[Log success]
        J -- No --> L{Retries left<br/>within 1hr?}
        L -- Yes --> M[Backoff + re-enqueue]
        L -- No --> N[Mark failed<br/>+ push notification]
    end

    subgraph "Server — Storage Layer"
        G <--> O[(WebhookStore<br/>registry-backed<br/>scope: user | admin)]
        K --> O
        N --> O
    end

    subgraph "Client — User Dashboard"
        P[Dashboard Page] --> R[Webhooks List]
        R --> S[Create/Edit Modal]
        R --> T[Delivery Log View]
        R --> U[Test Ping]
    end

    subgraph "Admin Panel — /admin/webhooks"
        AA[Admin Webhooks Page] --> AB[Webhooks List]
        AB --> AC[Create/Edit Form<br/>curated + advanced]
        AB --> AD[Delivery Log View]
        AB --> AE[Test Ping]
    end

    P <--> V["/api/webhooks/*" endpoints]
    V <--> O
    AA <--> W["/api/admin/webhooks/*" endpoints]
    W <--> O
```

### Core Components

| Component | Location | Responsibility |
|---|---|---|
| `WebhookEventBridge` | `server/utils/webhooks/event-bridge.ts` | Listens to hooks (user + admin + custom), maps to webhook event types, fans out to subscribed webhooks |
| `WebhookDispatcher` | `server/utils/webhooks/dispatcher.ts` | Signs and delivers payloads, manages retry scheduling (shared by both scopes) |
| `WebhookStore` | `server/utils/webhooks/store/` | Registry-based persistence for registrations + delivery logs; the pending log rows are the durable queue |
| `WebhookApiRoutes (user)` | `server/api/webhooks/` | REST endpoints for user CRUD, test ping, delivery logs |
| `WebhookApiRoutes (admin)` | `server/api/admin/webhooks/` | REST endpoints for admin webhook CRUD, test ping, delivery logs |
| `WebhooksDashboard (user)` | `app/components/dashboard/webhooks/` | Vue dashboard page for user webhook management |
| `WebhooksAdminPage` | Admin panel SPA (existing admin UI) | Admin panel page for admin webhook management |
| `WebhookConfig` | `config.or3cloud.ts` section | Admin-tunable settings via env vars |

---

## Component Design

### 1. WebhookStore Interface

Follows the same registry pattern as `AuthWorkspaceStore`, `SyncGatewayAdapter`, etc.

```typescript
// server/utils/webhooks/store/types.ts

/** Webhook registration record (unified for both user and admin scopes) */
export interface WebhookRegistration {
  id: string;                    // UUID
  scope: 'user' | 'admin';      // Which system owns this webhook
  user_id: string | null;        // Owner (null for admin scope)
  workspace_id: string | null;   // Workspace scope (user: required, admin: optional filter)
  url: string;                   // Target endpoint
  label: string;                 // Human-readable label (can be empty)
  events: string[];              // Curated event type strings
  custom_hooks: string[];        // Raw hook names (admin advanced mode only, empty for user)
  signing_secret_enc: string;    // AES-256-GCM encrypted signing secret (per-webhook)
  enabled: boolean;              // Active flag
  health: 'healthy' | 'failing' | 'unknown'; // Derived from recent deliveries
  created_at: number;            // Unix ms
  updated_at: number;            // Unix ms
}

/** Delivery log entry */
export interface WebhookDeliveryLog {
  id: string;                    // UUID
  webhook_id: string;            // FK to WebhookRegistration
  event_id: string;              // Unique event UUID (for idempotency)
  event_type: string;            // e.g. "thread.created"
  attempt: number;               // 1-based attempt number
  status: 'pending' | 'in_flight' | 'success' | 'failed' | 'cancelled';
  claimed_by: string | null;     // Worker UUID that claimed this delivery (diagnostics)
  claimed_at: number | null;     // When the worker claimed it (for reaper)
  http_status: number | null;    // Response status code
  error_message: string | null;  // Error description
  request_payload: string;       // JSON string of sent payload
  response_body: string | null;  // First 4KB of response
  duration_ms: number | null;    // Request duration
  next_retry_at: number | null;  // Unix ms, null if terminal
  created_at: number;            // Unix ms
}

/** The store interface that backends implement */
export interface WebhookStore {
  // Webhooks (unified — scope is on the record)
  createWebhook(webhook: Omit<WebhookRegistration, 'id' | 'health' | 'created_at' | 'updated_at'>): Promise<WebhookRegistration>;
  updateWebhook(webhookId: string, patch: Partial<Pick<WebhookRegistration, 'url' | 'label' | 'events' | 'custom_hooks' | 'enabled' | 'workspace_id'>>): Promise<WebhookRegistration>;
  deleteWebhook(webhookId: string): Promise<void>;
  getWebhook(webhookId: string): Promise<WebhookRegistration | null>;
  listWebhooks(userId: string, workspaceId: string): Promise<WebhookRegistration[]>; // user scope
  listAdminWebhooks(): Promise<WebhookRegistration[]>; // admin scope
  listWebhooksByEvent(eventType: string, scope: 'user' | 'admin', workspaceId?: string): Promise<WebhookRegistration[]>;
  listWebhooksByCustomHook(hookName: string): Promise<WebhookRegistration[]>; // admin custom hooks
  listActiveCustomHookNames(): Promise<string[]>; // distinct custom_hooks across enabled admin webhooks
  updateWebhookHealth(webhookId: string, health: WebhookRegistration['health']): Promise<void>;
  disableAllWebhooks(userId: string, workspaceId: string): Promise<number>; // bulk disable for user

  // Delivery Logs
  createDeliveryLog(log: Omit<WebhookDeliveryLog, 'id'>): Promise<WebhookDeliveryLog>;
  updateDeliveryLog(logId: string, patch: Partial<Pick<WebhookDeliveryLog, 'status' | 'http_status' | 'error_message' | 'response_body' | 'duration_ms' | 'next_retry_at' | 'attempt'>>): Promise<void>;
  getDeliveryLogs(webhookId: string, since: number): Promise<WebhookDeliveryLog[]>;

  // Atomic claim for multi-worker safety (Fix #1)
  claimPendingDeliveries(workerId: string, limit: number): Promise<WebhookDeliveryLog[]>;
  resetStaleInFlightDeliveries(olderThanMs: number): Promise<number>;

  cancelDeliveriesByWebhook(webhookId: string): Promise<number>;
  deleteDeliveryLogsByWebhook(webhookId: string): Promise<number>;
  purgeExpiredLogs(beforeTimestamp: number): Promise<number>;
}
```

### Store Registry

```typescript
// server/utils/webhooks/store/registry.ts

export interface WebhookStoreRegistryItem {
  id: string;
  order?: number;
  create: () => WebhookStore;
}

const registry = new Map<string, WebhookStoreRegistryItem>();

export function registerWebhookStore(item: WebhookStoreRegistryItem): void;
export function getWebhookStore(id: string): WebhookStore | null;
export function getActiveWebhookStore(): WebhookStore | null; // reads runtimeConfig
export function listWebhookStoreIds(): string[];
```

### Default SQLite Implementation

The default store uses SQLite (same as `or3-provider-sqlite`). Providers can register alternatives.

```typescript
// server/utils/webhooks/store/sqlite-store.ts

export function createSqliteWebhookStore(): WebhookStore {
  // Uses better-sqlite3 with the same DB connection pattern as or3-provider-sqlite
  // Tables: webhook_registrations, webhook_delivery_logs
  // Indexes: (scope, user_id, workspace_id), (webhook_id, created_at), (status, next_retry_at)
  // claimPendingDeliveries uses a single atomic transaction (or backend-native equivalent)
  // that selects due pending rows, marks them in_flight, and returns only the claimed rows
  // resetStaleInFlightDeliveries uses a single store operation that clears stale claims
}
```

---

### 2. WebhookEventBridge

Maps internal hook names to webhook event types and fans out to subscribed webhooks.

```typescript
// server/utils/webhooks/event-bridge.ts

/** Mapping from internal hook names to webhook event types */
const HOOK_TO_EVENT_MAP: Record<string, string> = {
  'db.threads.create:action:after':        'thread.created',
  'db.threads.update:action:after':        'thread.updated',
  'db.threads.delete:action:soft:after':   'thread.deleted',
  'db.messages.create:action:after':       'message.created',
  'db.messages.update:action:after':       'message.updated',
  'ai.chat.stream:action:complete':        'message.completed',
  'db.documents.create:action:after':      'document.created',
  'db.documents.update:action:after':      'document.updated',
  'db.documents.delete:action:soft:after': 'document.deleted',
  'notify:action:push':                    'notification.created',
};

export const WEBHOOK_EVENT_TYPES = Object.values(HOOK_TO_EVENT_MAP);

/** Human-readable descriptions for the user dashboard UI */
export const WEBHOOK_EVENT_DESCRIPTIONS: Record<string, string> = {
  'thread.created':        'A new conversation thread is created',
  'thread.updated':        'A thread title or metadata changes',
  'thread.deleted':        'A thread is deleted',
  'message.created':       'A new message is sent in a thread',
  'message.updated':       'A message is edited',
  'message.completed':     'AI finishes generating a response',
  'document.created':      'A new document is created',
  'document.updated':      'A document is edited',
  'document.deleted':      'A document is deleted',
  'notification.created':  'A notification is triggered',
};

// ── Admin Event Catalog ──

/** Mapping from admin hook names to admin webhook event types */
const ADMIN_HOOK_TO_EVENT_MAP: Record<string, string> = {
  'auth.user:action:created':            'admin.user.created',
  'admin.workspace:action:created':      'admin.workspace.created',
  'admin.workspace:action:deleted':      'admin.workspace.deleted',
  'admin.user:action:role_changed':      'admin.user.role_changed',
  'admin.plugin:action:installed':       'admin.plugin.installed',
  'admin.plugin:action:enabled':         'admin.plugin.enabled',
  'admin.plugin:action:disabled':        'admin.plugin.disabled',
  'sync:action:error':                   'admin.sync.error',
  'storage:action:error':                'admin.storage.error',
  // Background job events are captured from the job provider, not hook names
};

export const ADMIN_WEBHOOK_EVENT_TYPES = [
  ...Object.values(ADMIN_HOOK_TO_EVENT_MAP),
  'admin.job.completed',
  'admin.job.failed',
];

/** Human-readable descriptions for the admin panel UI */
export const ADMIN_WEBHOOK_EVENT_DESCRIPTIONS: Record<string, string> = {
  'admin.user.created':       'A new user is provisioned in the system',
  'admin.workspace.created':  'A new workspace is created',
  'admin.workspace.deleted':  'A workspace is deleted',
  'admin.user.role_changed':  'A user\'s role changes within a workspace',
  'admin.plugin.installed':   'A plugin or theme is installed',
  'admin.plugin.enabled':     'A plugin is enabled for a workspace',
  'admin.plugin.disabled':    'A plugin is disabled for a workspace',
  'admin.sync.error':         'A sync operation error occurs',
  'admin.storage.error':      'A storage operation error occurs',
  'admin.job.completed':      'A background streaming job completes',
  'admin.job.failed':         'A background streaming job fails',
};

export interface WebhookEventBridge {
  /** Start listening to hooks and dispatching webhook events */
  start(): void;
  /** Stop listening (for graceful shutdown) */
  stop(): void;
  /** Re-scan active admin webhooks to update custom hook listeners */
  refreshCustomHookListeners(): Promise<void>;
}

export function createWebhookEventBridge(
  store: WebhookStore,
  dispatcher: WebhookDispatcher,
  nitroApp: NitroApp
): WebhookEventBridge;
```

**Key design decisions**:
- The bridge registers listeners on **`nitroApp.hooks`** (process-wide), NOT the per-request `TypedAdminHookEngine` (which is request-scoped and invisible to long-lived listeners).
- Server-side event sources mirror webhook-relevant events onto `nitroApp.hooks` using the actual hook name (for example `nitroApp.hooks.callHook('db.threads.create:action:after', payload)`) at their capture points (sync-apply layer, notification emitter, background job handler).
- The bridge does a **fast lookup** of active subscriptions per event type. If zero subscriptions exist for an event, cost is a single Map lookup (~0 overhead).
- Custom admin hooks also register on `nitroApp.hooks` via the same pattern.

#### Custom Hook Pass-Through (Admin Advanced Mode)

Admin webhooks can subscribe to arbitrary server-side hook names exposed on `nitroApp.hooks` via `custom_hooks[]`. The event bridge handles these differently from curated events:

```typescript
// Custom hook listener management
interface CustomHookBinding {
  hookName: string;
  webhookIds: Set<string>;
  unsubscribe: () => void;
}

// The bridge maintains a map of active custom hook listeners
const customBindings = new Map<string, CustomHookBinding>();

// When an admin webhook is created/updated with custom_hooks:
// 1. For each hook name not already bound, register a listener on nitroApp.hooks
// 2. The listener serializes hook arguments to JSON and enqueues delivery
// 3. When a webhook is deleted/disabled, remove its ID from the binding
// 4. When a binding has zero webhook IDs, unsubscribe the listener from nitroApp.hooks

// Custom hook payload serialization:
function serializeHookArgs(args: unknown[]): Record<string, unknown> {
  try {
    // Best-effort JSON round-trip to strip non-serializable values
    return JSON.parse(JSON.stringify({ args }));
  } catch {
    return { args: [], _serialization_error: true };
  }
}
```

**Refresh strategy**: `refreshCustomHookListeners()` is called on bridge startup and whenever an admin webhook is created, updated, or deleted. It diffs the current set of custom hook names against active bindings and adds/removes listeners as needed. This is a cold path (admin webhook changes are rare) so simplicity over performance.

#### Hook Integration Strategy

Some webhook event sources (like `db.*.action:after` and `ai.chat.stream:action:complete`) currently fire on the **client** hook engine, not the server. For webhook delivery, we need server-side capture. Two approaches:

**Approach A (Recommended): Sync-layer capture + nitroApp.hooks bus**
- DB mutations that go through sync already hit the server via push ops. The sync-apply layer mirrors the canonical hook name onto `nitroApp.hooks` (for example `nitroApp.hooks.callHook('db.threads.create:action:after', payload)`) where the entity is already available.
- `message.completed` is captured from **two** server-side sources:
  - **Background streams**: the `stream-handler.ts` fires a completion event when the background job finishes.
  - **Foreground SSR streams**: the `/api/openrouter/stream.post.ts` handler fires a lightweight completion event when the SSE response stream ends. The payload includes `{ thread_id, message_id, model_id }` from the request body (less detail than background, but reliable).

**Approach B: Dedicated server hooks**
- Extend `AdminHookPayloadMap` with new server-side hooks that mirror the client DB hooks.
- Fire them from the sync gateway adapter's apply path.

**We use Approach A** — it’s simpler, already has the data, uses the process-wide `nitroApp.hooks` bus, and captures completions from both streaming modes.

---

### 3. WebhookDispatcher

Handles signing, delivery, and retry logic.

```typescript
// server/utils/webhooks/dispatcher.ts

export interface WebhookDispatcher {
  /** Enqueue a delivery for a specific webhook */
  enqueue(job: WebhookDeliveryJob): Promise<void>;

  /** Claim and process pending deliveries (called by the delivery loop) */
  claimAndProcess(): Promise<void>;

  /** Send a test ping to a webhook */
  sendTestPing(webhook: WebhookRegistration, signingSecret: string): Promise<TestPingResult>;

  /** Start the background delivery loop + stale claim reaper */
  start(): void;

  /** Stop the delivery loop (graceful shutdown) */
  stop(): void;
}

export function createWebhookDispatcher(
  store: WebhookStore,
  config: WebhookConfig,
  workerId?: string // defaults to crypto.randomUUID()
): WebhookDispatcher;

export interface WebhookDeliveryJob {
  webhookId: string;
  eventType: string;
  eventId: string;
  payload: Record<string, unknown>;
  signingSecret: string;       // Decrypted for this delivery batch
  targetUrl: string;
  attempt: number;
}

export interface TestPingResult {
  success: boolean;
  statusCode: number | null;
  durationMs: number;
  error: string | null;
}

/** Retry schedule: delays in milliseconds */
const RETRY_DELAYS = [
  0,          // Attempt 1: immediate
  30_000,     // Attempt 2: 30s
  120_000,    // Attempt 3: 2min
  600_000,    // Attempt 4: 10min
  1_800_000,  // Attempt 5: 30min
  3_600_000,  // Attempt 6: 60min
];
const MAX_ATTEMPTS = RETRY_DELAYS.length; // 6
```

#### Payload Signing

```typescript
// server/utils/webhooks/signing.ts

import { createHmac } from 'node:crypto';

export function signPayload(body: string, secret: string, timestamp: number): string {
  const message = `${timestamp}.${body}`;
  return createHmac('sha256', secret).update(message).digest('hex');
}

export function buildDeliveryHeaders(
  eventType: string,
  eventId: string,
  signature: string,
  timestamp: number
): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-OR3-Event': eventType,
    'X-OR3-Event-ID': eventId,
    'X-OR3-Signature': `sha256=${signature}`,
    'X-OR3-Timestamp': String(timestamp),
    'User-Agent': 'OR3-Webhooks/1.0',
  };
}
```

This follows the same pattern used by Stripe and Shopify — timestamp is included in the signed message to prevent replay attacks.

#### Delivery Loop

The dispatcher runs a background `setInterval` (every 5 seconds) that:

1. Atomically claims pending deliveries via `store.claimPendingDeliveries(workerId, batchSize)` — transitions `pending → in_flight` in a single store operation.
2. For each claimed job, decrypts the signing secret from the webhook, signs the payload, sends the HTTP request using an SSRF-safe fetch agent.
3. On success: updates log to `success`, recalculates webhook health.
4. On failure: if attempts < MAX_ATTEMPTS and within retry window, transitions back to `pending` with next retry; otherwise marks `failed` and emits notification.
5. A separate reaper interval (every 60 seconds) calls `store.resetStaleInFlightDeliveries(2 * 60 * 1000)` to recover any rows claimed by a crashed worker.

```typescript
// Delivery loop (simplified)
async function deliveryLoop(): Promise<void> {
  // Atomic claim — only this worker gets these rows
  const claimed = await store.claimPendingDeliveries(workerId, BATCH_SIZE);

  for (const log of claimed) {
    const webhook = await store.getWebhook(log.webhook_id);
    if (!webhook || !webhook.enabled) {
      await store.updateDeliveryLog(log.id, { status: 'cancelled' });
      continue;
    }

    const signingSecret = decryptSecret(webhook.signing_secret_enc, encryptionKey);
    const result = await attemptDelivery(
      webhook.url, log.request_payload, signingSecret,
      log.event_type, log.event_id,
      { blockPrivateIps } // passed to SSRF-safe fetch agent
    );

    if (result.success) {
      await store.updateDeliveryLog(log.id, {
        status: 'success',
        http_status: result.statusCode,
        duration_ms: result.durationMs,
        response_body: result.responseBody,
      });
      await recalculateHealth(webhook.id);
    } else {
      const nextAttempt = log.attempt + 1;
      if (nextAttempt <= MAX_ATTEMPTS) {
        const delay = RETRY_DELAYS[nextAttempt - 1] ?? RETRY_DELAYS[RETRY_DELAYS.length - 1];
        await store.updateDeliveryLog(log.id, {
          status: 'pending', // back to pending for next claim cycle
          attempt: nextAttempt,
          http_status: result.statusCode,
          error_message: result.error,
          response_body: result.responseBody,
          duration_ms: result.durationMs,
          next_retry_at: Date.now() + delay,
        });
      } else {
        await store.updateDeliveryLog(log.id, {
          status: 'failed',
          http_status: result.statusCode,
          error_message: result.error,
          response_body: result.responseBody,
          duration_ms: result.durationMs,
          next_retry_at: null,
        });
        await recalculateHealth(webhook.id);
        // Emit failure notification via a helper backed by the existing
        // server notification emitter registry (NOT notify:action:push)
        if (webhook.user_id && webhook.workspace_id) {
          await emitWebhookFailureNotification(webhook, log);
        }
      }
    }
  }
}

// Stale claim reaper (runs every 60s)
async function reaperLoop(): Promise<void> {
  const resetCount = await store.resetStaleInFlightDeliveries(2 * 60 * 1000);
  if (resetCount > 0) {
    console.warn(`[webhooks] Reaper reset ${resetCount} stale in_flight deliveries`);
  }
}
```

---

### 3a. SSRF-Safe Delivery Agent

When `blockPrivateIps` is enabled, the dispatcher uses a custom undici agent that validates the resolved IP in the connection callback — preventing DNS rebinding attacks (TOCTOU between CRUD-time validation and dispatch-time fetch).

```typescript
// server/utils/webhooks/ssrf-safe-agent.ts

import { Agent } from 'undici';

const PRIVATE_RANGES = [
  /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./,
  /^127\./, /^169\.254\./, /^0\./, /^::1$/, /^fe80:/i, /^fc00:/i, /^fd00:/i,
];

export function createSsrfSafeAgent(): Agent {
  return new Agent({
    connect: {
      lookup: (hostname, options, callback) => {
        import('node:dns').then(dns => {
          dns.lookup(hostname, options, (err, address, family) => {
            if (err) return callback(err, address, family);
            if (PRIVATE_RANGES.some(r => r.test(address))) {
              return callback(
                new Error(`DNS resolved to private IP: ${address}`),
                address, family
              );
            }
            callback(null, address, family);
          });
        });
      },
    },
  });
}
```

The dispatcher creates the agent once at startup and passes it to `fetch()` via the `dispatcher` option. This is atomic — there's no gap between DNS resolution and connection.

---

### 4. Secret Management

```typescript
// server/utils/webhooks/crypto.ts

import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

/** Derive encryption key from the configured secret */
function deriveKey(masterSecret: string): Buffer {
  return scryptSync(masterSecret, 'or3-webhooks-salt', KEY_LENGTH);
}

/** Generate a signing secret (returned to user once at webhook creation) */
export function generateSigningSecret(): string {
  return `whs_${randomBytes(32).toString('hex')}`;
}

/** Encrypt a signing secret for storage */
export function encryptSecret(plaintext: string, masterSecret: string): string {
  const key = deriveKey(masterSecret);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: iv:tag:ciphertext (all hex)
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/** Decrypt a signing secret from storage */
export function decryptSecret(encrypted: string, masterSecret: string): string {
  const key = deriveKey(masterSecret);
  const [ivHex, tagHex, cipherHex] = encrypted.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const ciphertext = Buffer.from(cipherHex, 'hex');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext).toString('utf8') + decipher.final('utf8');
}
```

---

### 5. Webhook Payload Envelope

```typescript
// server/utils/webhooks/payload.ts (shared types also in shared/webhooks/)

/** Standard webhook envelope — every delivery uses this shape */
export interface WebhookPayload {
  event: string;                // e.g. "thread.created"
  event_id: string;             // UUID for idempotency
  timestamp: string;            // ISO 8601 UTC
  scope: 'user' | 'admin';
  workspace_id: string | null;
  user_id?: string;             // Present for user-scope deliveries only
  data: Record<string, unknown>; // Event-specific payload
}

/** Build a webhook payload from a hook event */
export function buildWebhookPayload(
  input: {
    scope: 'user' | 'admin';
    eventType: string;
    workspaceId: string | null;
    userId?: string;
    data: Record<string, unknown>;
  }
): WebhookPayload {
  return {
    event: input.eventType,
    event_id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    scope: input.scope,
    workspace_id: input.workspaceId,
    ...(input.scope === 'user' && input.userId ? { user_id: input.userId } : {}),
    data: input.data,
  };
}
```

#### Event-Specific Data Shapes

```typescript
// shared/webhooks/event-schemas.ts

/** thread.created / thread.updated */
export interface ThreadEventData {
  id: string;
  title: string | null;
  project_id: string | null;
  model_id: string | null;
  message_count?: number;
  created_at: number;
  updated_at: number;
}

/** thread.deleted */
export interface ThreadDeletedEventData {
  id: string;
  deleted_at: number;
}

/** message.created / message.updated */
export interface MessageEventData {
  id: string;
  thread_id: string;
  role: string;
  content: string;              // Truncated to 4KB for safety
  content_length: number;       // Full length
  model_id: string | null;
  created_at: number;
  updated_at: number;
}

/** message.completed */
export interface MessageCompletedEventData {
  thread_id: string | undefined;
  assistant_id: string;
  stream_id: string;
  total_length: number;
  reasoning_length: number | undefined;
}

/** document.created / document.updated */
export interface DocumentEventData {
  id: string;
  title: string | null;
  content_length: number;       // We don't send full content
  created_at: number;
  updated_at: number;
}

/** document.deleted */
export interface DocumentDeletedEventData {
  id: string;
  deleted_at: number;
}

/** notification.created */
export interface NotificationEventData {
  type: string;
  title: string;
  body: string | undefined;
  thread_id: string | undefined;
  document_id: string | undefined;
}
```

---

### 6. API Routes

#### 6a. User Webhook Routes

All routes under `server/api/webhooks/` require SSR auth session.

```
server/api/webhooks/
├── index.get.ts              # List user's webhooks
├── index.post.ts             # Create webhook (returns signing secret once)
├── [id].patch.ts             # Update webhook
├── [id].delete.ts            # Delete webhook
├── disable-all.post.ts       # Disable all user webhooks (bulk kill-switch)
└── [id]/
    ├── toggle.post.ts        # Enable/disable webhook
    ├── test.post.ts          # Send test ping
    └── logs.get.ts           # Get delivery logs (last 72h)
```

#### 6b. Admin Webhook Routes

All routes under `server/api/admin/webhooks/` require `requireAdminApiContext({ superAdminOnly: true })`.

```
server/api/admin/webhooks/
├── index.get.ts              # List all admin webhooks
├── index.post.ts             # Create admin webhook (returns signing secret once)
├── [id].patch.ts             # Update admin webhook
├── [id].delete.ts            # Delete admin webhook
├── [id]/
│   ├── toggle.post.ts        # Enable/disable admin webhook
│   ├── test.post.ts          # Send test ping
│   └── logs.get.ts           # Get delivery logs (last 72h)
```

**Admin route differences from user routes:**
- No user scoping — all admin webhooks are instance-level
- Supports `custom_hooks` array in create/update
- Supports optional `workspace_id` filter in create/update

#### Route Authorization Pattern

Every route follows the same guard pattern:

```typescript
// Example: server/api/webhooks/index.get.ts
export default defineEventHandler(async (event) => {
  // 1. Require SSR auth + active workspace
  const session = await resolveSessionContext(event);
  if (!session.authenticated || !session.user || !session.workspace) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
  }
  requireCan(session, 'workspace.read', {
    kind: 'workspace',
    id: session.workspace.id,
  });

  // 2. Check webhooks are enabled
  const config = useRuntimeConfig();
  if (!config.webhooks?.enabled) {
    throw createError({ statusCode: 404, statusMessage: 'Webhooks are not enabled' });
  }

  // 3. Business logic
  const store = getActiveWebhookStore();
  if (!store) {
    throw createError({ statusCode: 503, statusMessage: 'Webhook store not available' });
  }

  return store.listWebhooks(session.user.id, session.workspace.id);
});
```

---

### 7. Cloud Config Extension

Added to `config.or3cloud.ts`:

```typescript
// Addition to or3CloudConfig
webhooks: {
  enabled: authEnabled && envFirst('OR3_WEBHOOKS_ENABLED') !== 'false',
  maxPerUser: process.env.OR3_WEBHOOKS_MAX_PER_USER
    ? Number(process.env.OR3_WEBHOOKS_MAX_PER_USER) : 20,
  adminMax: process.env.OR3_WEBHOOKS_ADMIN_MAX
    ? Number(process.env.OR3_WEBHOOKS_ADMIN_MAX) : 50,
  rateLimitPerMinute: process.env.OR3_WEBHOOKS_RATE_LIMIT_PER_MINUTE
    ? Number(process.env.OR3_WEBHOOKS_RATE_LIMIT_PER_MINUTE) : 120,
  deliveryTimeoutMs: process.env.OR3_WEBHOOKS_DELIVERY_TIMEOUT_MS
    ? Number(process.env.OR3_WEBHOOKS_DELIVERY_TIMEOUT_MS) : 10_000,
  blockPrivateIps: process.env.OR3_WEBHOOKS_BLOCK_PRIVATE_IPS === 'true',
  encryptionKey: envFirst('OR3_WEBHOOKS_ENCRYPTION_KEY', 'OR3_ADMIN_JWT_SECRET') ?? '',
  maxRetryHours: process.env.OR3_WEBHOOKS_MAX_RETRY_HOURS
    ? Number(process.env.OR3_WEBHOOKS_MAX_RETRY_HOURS) : 1,
  logRetentionHours: process.env.OR3_WEBHOOKS_LOG_RETENTION_HOURS
    ? Number(process.env.OR3_WEBHOOKS_LOG_RETENTION_HOURS) : 72,
  // Storage provider follows sync provider by default
  storageProvider: envFirst('OR3_WEBHOOKS_STORAGE_PROVIDER', 'OR3_SYNC_PROVIDER') ?? 'sqlite',
},
```

---

### 8. Dashboard UI Design

#### Page Registration

The webhook page is registered as a dashboard plugin from a client plugin (only when cloud is enabled):

```typescript
// app/plugins/webhooks-dashboard.client.ts
export default defineNuxtPlugin(() => {
  const { ssrAuthEnabled } = useRuntimeConfig().public;
  if (!ssrAuthEnabled) return;

  registerDashboardPlugin({
    id: 'core:webhooks',
    icon: 'i-lucide-webhook',
    label: 'Webhooks',
    order: 50,
    access: { authRequired: true },
    pages: [
      {
        id: 'webhooks-manage',
        title: 'Webhooks',
        component: () => import('~/components/dashboard/webhooks/WebhooksPage.vue'),
      },
    ],
  });
});
```

#### Component Structure

```
app/components/dashboard/webhooks/
├── WebhooksPage.vue           # Main page with webhooks list + bulk actions
├── WebhooksList.vue           # List of registered webhooks
├── WebhookForm.vue            # Create/edit slide-over form
├── WebhookDeliveryLog.vue     # Delivery log for a specific webhook
└── WebhookTestPing.vue        # Inline test ping result display
```

#### UI Layout (WebhooksPage.vue)

```
┌─────────────────────────────────────────────────────┐
│  📡 Webhooks              [Disable All]     [+ New] │
│  ┌─────────────────────────────────────────────┐    │
│  │ 🟢 My Slack Bot                             │    │
│  │    https://hooks.slack.com/...              │    │
│  │    thread.created  message.completed        │    │
│  │    Last: 2m ago                             │    │
│  │    [Logs] [Test] [Edit] [🗑️]  [⏸️]          │    │
│  ├─────────────────────────────────────────────┤    │
│  │ 🟡 Analytics Pipeline                       │    │
│  │    https://analytics.example.com/wh         │    │
│  │    message.created  message.updated         │    │
│  │    Last: failing (3 errors)                 │    │
│  │    [Logs] [Test] [Edit] [🗑️]  [▶️]          │    │
│  └─────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

---

### 16. Final Implementation Notes

The shipped implementation keeps the design intact with a few practical adjustments:

- The long-lived Nitro runtime lives in `server/plugins/20.webhooks.ts` so it participates in the existing ordered plugin convention.
- The request-scoped admin hook engine in `server/plugins/admin-hooks.ts` mirrors every emitted admin action onto `nitroApp.hooks`, which lets the process-wide webhook bridge observe admin mutations without replacing the local per-request admin hook API.
- Server-side user content hooks are emitted at the actual persistence/execution boundaries:
  - SQLite sync apply emits `db.*:action:after` hooks after committed writes.
  - Background chat completion emits both `background.job:*` and `ai.chat.stream:action:complete`.
  - Foreground SSR streaming uses a tee’d stream monitor so `message.completed` is emitted only after the proxied SSE stream ends normally.
  - Provider-backed notification writes mirror `notify:action:push` after the notification record is created.
- Admin webhook custom-hook listeners are refreshed through the active runtime registry after admin webhook create/update/delete/toggle mutations.
- The event bridge fast-path cache is keyed by `scope + event + workspace` instead of only `scope + event`, which avoids false negatives for workspace-scoped subscriptions.

#### Component Details

**WebhooksList.vue**:
- Empty state: friendly illustration + "Create your first webhook" CTA
- Each row is a compact card with health indicator dot, label, URL, event badges, and action buttons
- Health colors: green (`healthy`), amber (`failing`), gray (`disabled`), neutral (`unknown`)
- Uses `UBadge` for event type chips, `UButton` for actions, `UToggle` for enable/disable

**WebhookForm.vue**:
- Slide-over panel (using `USlideover` or scoped modal)
- URL input with real-time validation
- Label input (optional, placeholder: "My webhook")
- Event checkboxes: grouped list with descriptions, "Select All" / "Deselect All" helpers
- Validation: URL required + valid format, at least 1 event selected
- On successful creation: displays signing secret in a highlighted box with copy button and warning ("Save this now — you won't see it again")

**WebhookDeliveryLog.vue**:
- Opens as an expanded section or sub-panel when "Logs" is clicked
- Shows deliveries from last 72 hours, newest first
- Each entry: event badge, timestamp, status badge (green/red/yellow), HTTP code, duration, attempt #
- Expandable detail view: full request payload (JSON viewer) + response body (truncated)
- Refresh button at top

**WebhookTestPing.vue**:
- Inline result that appears below the webhook row after clicking "Test"
- Shows: ✅ 200 OK (142ms) or ❌ Connection refused
- Auto-dismisses after 10 seconds or on next action

---

### 9. URL Validation

```typescript
// server/utils/webhooks/url-validator.ts

import { URL } from 'node:url';
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

const PRIVATE_RANGES = [
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^127\./,
  /^169\.254\./,
  /^0\./,
  /^::1$/,
  /^fe80:/i,
  /^fc00:/i,
  /^fd00:/i,
];

export interface UrlValidationResult {
  valid: boolean;
  error?: string;
}

export async function validateWebhookUrl(
  url: string,
  options: { requireHttps: boolean; blockPrivateIps: boolean }
): Promise<UrlValidationResult> {
  // 1. Parse URL
  let parsed: URL;
  try { parsed = new URL(url); }
  catch { return { valid: false, error: 'Invalid URL format' }; }

  // 2. Protocol check
  if (options.requireHttps && parsed.protocol !== 'https:') {
    return { valid: false, error: 'HTTPS is required in production mode' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, error: 'Only HTTP and HTTPS URLs are supported' };
  }

  // 3. Private IP check (only if enabled)
  if (options.blockPrivateIps) {
    const hostname = parsed.hostname;
    let ip = hostname;
    if (!isIP(hostname)) {
      try {
        const result = await lookup(hostname);
        ip = result.address;
      } catch {
        return { valid: false, error: 'Could not resolve hostname' };
      }
    }
    if (PRIVATE_RANGES.some(r => r.test(ip))) {
      return { valid: false, error: 'Private/internal IP addresses are not allowed' };
    }
  }

  return { valid: true };
}
```

---

### 10. Rate Limiting

Webhook delivery rate limiting uses the same simple fixed-window pattern as `server/utils/rate-limit.ts`, but scoped per-webhook:

```typescript
// server/utils/webhooks/rate-limit.ts

const webhookCounters = new Map<string, { count: number; resetAt: number }>();

export function checkWebhookRateLimit(
  webhookId: string,
  maxPerMinute: number
): boolean {
  const now = Date.now();
  const entry = webhookCounters.get(webhookId);

  if (!entry || now > entry.resetAt) {
    webhookCounters.set(webhookId, { count: 1, resetAt: now + 60_000 });
    return true;
  }

  if (entry.count >= maxPerMinute) return false;
  entry.count++;
  return true;
}
```

The `maxPerMinute` value comes from `runtimeConfig.webhooks.rateLimitPerMinute`. This is intentionally a simple counter — it can be swapped for sliding-window or token-bucket later without changing the call site, since the interface is just `(webhookId, limit) => boolean`.

---

### 11. Nitro Plugin Initialization

```typescript
// server/plugins/webhooks.ts

export default defineNitroPlugin(async (nitroApp) => {
  const config = useRuntimeConfig();

  // Gate: only start if webhooks are enabled
  if (!config.webhooks?.enabled) return;

  // Verify encryption key exists
  if (!config.webhooks.encryptionKey) {
    console.warn('[webhooks] No encryption key configured — webhook system disabled');
    return;
  }

  // Register default SQLite store if no provider has registered one
  const existing = getActiveWebhookStore();
  if (!existing) {
    registerWebhookStore({
      id: 'sqlite',
      order: 999, // low priority — providers override
      create: () => createSqliteWebhookStore(),
    });
  }

  // Start the event bridge + dispatcher
  const store = getActiveWebhookStore()!;
  const workerId = crypto.randomUUID();
  const dispatcher = createWebhookDispatcher(store, config.webhooks, workerId);
  const bridge = createWebhookEventBridge(store, dispatcher, nitroApp);

  bridge.start();
  dispatcher.start();

  // Claim any unclaimed deliveries on startup (crash recovery)
  await dispatcher.claimAndProcess();

  // Cleanup loop: purge expired logs every hour
  const cleanupInterval = setInterval(async () => {
    const cutoff = Date.now() - (config.webhooks.logRetentionHours * 60 * 60 * 1000);
    await store.purgeExpiredLogs(cutoff);
  }, 60 * 60 * 1000);

  // Reaper loop: reset stale in_flight deliveries every 2 minutes
  const reaperInterval = setInterval(async () => {
    await store.resetStaleInFlightDeliveries(5 * 60 * 1000); // 5 min stale threshold
  }, 2 * 60 * 1000);

  // Graceful shutdown
  nitroApp.hooks.hook('close', () => {
    bridge.stop();
    dispatcher.stop();
    clearInterval(cleanupInterval);
    clearInterval(reaperInterval);
  });
});
```

---

### 12. Error Handling

All API routes and internal operations use the existing `createError` pattern:

| Scenario | HTTP Status | Error Message |
|---|---|---|
| Webhooks disabled | 404 | Webhooks are not enabled |
| No auth session | 401 | Authentication required |
| No active workspace | 403 | Active workspace required |
| Webhook limit reached | 429 | Maximum webhooks limit reached (N) |
| Webhook not found | 404 | Webhook not found |
| Webhook not owned by user | 403 | Access denied |
| Invalid URL | 422 | Invalid webhook URL: {reason} |
| SSRF blocked at dispatch | N/A | DNS resolved to private IP: {ip} (logged, delivery fails) |
| No events selected | 422 | At least one event type must be selected |
| Invalid custom hook format | 422 | Invalid hook name format: {name} |
| Admin webhook limit reached | 429 | Maximum admin webhooks limit reached (N) |
| Not a super admin | 403 | Super admin access required |
| Store unavailable | 503 | Webhook store not available |
| No encryption key | 503 | Webhook encryption not configured |

---

### 13. Testing Strategy

#### Unit Tests
- `crypto.ts` — signing secret generation, encrypt/decrypt round-trip
- `signing.ts` — HMAC signature generation (timestamp.body format), header construction
- `url-validator.ts` — valid URLs, invalid URLs, HTTPS enforcement, private IP blocking
- `ssrf-safe-agent.ts` — custom undici agent blocks private IPs at connect time
- `rate-limit.ts` — counter behavior, window reset
- `event-bridge.ts` — hook-to-event mapping (user + admin), custom hook listener management, subscription lookup, nitroApp.hooks integration
- `payload.ts` — envelope construction, data sanitization (no sensitive fields), custom hook arg serialization

#### Integration Tests
- User API routes — CRUD lifecycle (create webhook → signing secret returned once → update → delete)
- Admin API routes — CRUD lifecycle (create admin webhook with curated + custom hooks → update → delete)
- Authorization — cross-user access denied, no-session denied, non-admin denied on admin routes
- Delivery — mock HTTP targets, verify signing, retry behavior, failure notification via the server notification emitter registry helper
- Multi-worker safety — concurrent `claimPendingDeliveries()` calls never return the same row; stale reaper resets crashed claims
- SSRF protection — dispatch-time DNS resolution blocks private IPs even after CRUD validation passes
- Custom hook delivery — register custom hook → fire that hook → verify delivery with serialized args
- Workspace filtering — admin webhook with workspace_id filter only receives matching events
- Store — SQLite implementation CRUD operations (both scopes)

#### End-to-End Tests
- User full flow: create webhook → trigger event → verify delivery at mock endpoint (signing secret from creation)
- Admin full flow: create admin webhook (curated + custom) → trigger events → verify delivery
- Disable all webhooks → verify deliveries stop
- Rate limit enforcement
- Test ping (both user and admin)
- Foreground SSR stream completion → message.completed webhook fires

---

### 14. File Manifest

```
server/
├── api/webhooks/                     # User webhook routes
│   ├── index.get.ts
│   ├── index.post.ts                 # Returns signing secret on creation
│   ├── [id].patch.ts
│   ├── [id].delete.ts
│   ├── disable-all.post.ts           # Bulk disable all user webhooks
│   └── [id]/
│       ├── toggle.post.ts
│       ├── test.post.ts
│       └── logs.get.ts
├── api/admin/webhooks/               # Admin webhook routes
│   ├── index.get.ts
│   ├── index.post.ts
│   ├── [id].patch.ts
│   ├── [id].delete.ts
│   └── [id]/
│       ├── toggle.post.ts
│       ├── test.post.ts
│       └── logs.get.ts
├── plugins/
│   └── webhooks.ts
└── utils/webhooks/
    ├── crypto.ts
    ├── dispatcher.ts
    ├── event-bridge.ts
    ├── payload.ts
    ├── rate-limit.ts
    ├── signing.ts
    ├── ssrf-safe-agent.ts            # Custom undici Agent — dispatch-time SSRF protection
    ├── url-validator.ts
    └── store/
        ├── types.ts
        ├── registry.ts
        └── sqlite-store.ts

shared/webhooks/
├── event-types.ts              # Event type constants + descriptions (user + admin)
└── event-schemas.ts            # Payload data shapes (used by server + docs)

app/
├── components/dashboard/webhooks/    # User dashboard UI
│   ├── WebhooksPage.vue
│   ├── WebhooksList.vue
│   ├── WebhookForm.vue
│   ├── WebhookDeliveryLog.vue
│   └── WebhookTestPing.vue
└── plugins/
    └── webhooks-dashboard.client.ts

# Admin panel page is served through the existing admin SPA
# at /admin/webhooks — see admin panel integration below
```

---

### 15. Admin Panel Integration

The admin webhook page lives inside the existing admin panel SPA. The admin panel already has its own navigation, auth (admin JWT cookie), and API patterns.

#### Admin Webhook Page

The page at `/admin/webhooks` provides:

1. **Webhook List** — all admin-registered webhooks with health badges, event counts, workspace filter indicator, and action buttons.

2. **Create/Edit Form** — similar to user form but with additions:
   - Curated admin event checkboxes (with descriptions)
   - **Advanced section** (collapsible, closed by default):
     - "Subscribe to any server-side hook" header + disclaimer text
     - Dynamic rows: text input for hook name + remove button
     - "Add custom hook" button to add rows
     - Basic format validation on the hook name (non-empty, contains `:action:` or `:filter:`)
   - Optional workspace selector dropdown ("All workspaces" default, or pick a specific one)

3. **Delivery Logs + Test Ping** — identical UX to user webhooks

4. **Signing Secret Display** — shown once at webhook creation in a highlighted box with copy button and "save now" warning. Same pattern as user webhook creation.

```
┌─────────────────────────────────────────────────────┐
│  Admin Webhooks                             [+ New] │
│  ┌─────────────────────────────────────────────┐    │
│  │ 🟢 DevOps Alerts                            │    │
│  │    https://ops.example.com/or3              │    │
│  │    admin.workspace.created  admin.sync.error│    │
│  │    Scope: All workspaces                    │    │
│  │    Last: 5m ago                             │    │
│  │    [Logs] [Test] [Edit] [🗑️]  [⏸️]          │    │
│  ├─────────────────────────────────────────────┤    │
│  │ 🟢 Audit Logger                             │    │
│  │    https://audit.internal/webhook           │    │
│  │    admin.user.created  admin.user.role_...  │    │
│  │    + 2 custom hooks                         │    │
│  │    Scope: ws_abc123                         │    │
│  │    Last: 12m ago                            │    │
│  │    [Logs] [Test] [Edit] [🗑️]  [▶️]          │    │
│  └─────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```
