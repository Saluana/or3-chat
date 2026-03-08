# Webhooks

OR3 webhooks deliver real-time server-side events to external HTTP endpoints. Every delivery is a signed JSON payload with automatic retries, delivery logging, and SSRF protection.

There are two webhook scopes:

| Scope | Management Surface | Typical Use Case |
|---|---|---|
| **User** | Dashboard → Webhooks plugin page | Workspace integrations — Slack notifications, logging, CI triggers |
| **Admin** | Admin panel → `/admin/webhooks` | Ops monitoring — user provisioning, sync errors, job failures |

Both scopes share the same store, dispatcher, signing, retry policy, and delivery log infrastructure.

---

## Quick Start

### 1. Enable Webhooks

Webhooks are enabled by default when SSR auth is active. Verify your `.env`:

```env
SSR_AUTH_ENABLED=true

# Required — used to encrypt signing secrets at rest
OR3_WEBHOOKS_ENCRYPTION_KEY=your-32-char-secret-key-here

# Optional overrides (these are the defaults)
OR3_WEBHOOKS_MAX_PER_USER=20
OR3_WEBHOOKS_RATE_LIMIT_PER_MINUTE=120
OR3_WEBHOOKS_DELIVERY_TIMEOUT_MS=10000
OR3_WEBHOOKS_LOG_RETENTION_HOURS=72
```

> **Important:** If `OR3_WEBHOOKS_ENCRYPTION_KEY` is not set, webhook creation is rejected and the runtime will not start.

### 2. Create a Webhook

Open the **Dashboard → Webhooks** page and click **New Webhook**.

1. Enter your **Target URL** (must be HTTPS in production).
2. Add an optional **Label** for identification.
3. Select the **Events** you want to receive.
4. Click **Create Webhook**.
5. **Copy the signing secret** — it is shown only once and cannot be retrieved again.

### 3. Receive Events

Build a receiver that accepts POST requests, verifies the HMAC signature, and processes the payload. See the [Express Example](#express-receiver-example) below.

---

## User Event Catalog

User webhooks expose curated workspace-level events:

| Event | Description |
|---|---|
| `thread.created` | A new conversation thread is created. |
| `thread.updated` | A conversation thread is updated. |
| `thread.deleted` | A conversation thread is soft-deleted. |
| `message.created` | A new message is stored. |
| `message.updated` | An existing message is updated. |
| `message.completed` | AI generation finishes for a message. |
| `document.created` | A new document is created. |
| `document.updated` | An existing document is updated. |
| `document.deleted` | A document is soft-deleted. |
| `notification.created` | A notification is pushed. |

---

## Admin Event Catalog

Admin webhooks expose operational events. Payloads include `scope: "admin"` and intentionally omit `user_id`.

| Event | Description |
|---|---|
| `admin.user.created` | A new user is provisioned. |
| `admin.workspace.created` | A workspace is created. |
| `admin.workspace.deleted` | A workspace is deleted. |
| `admin.user.role_changed` | A user role changes. |
| `admin.plugin.installed` | A plugin or theme is installed. |
| `admin.plugin.enabled` | A plugin is enabled. |
| `admin.plugin.disabled` | A plugin is disabled. |
| `admin.sync.error` | A sync error occurs. |
| `admin.storage.error` | A storage error occurs. |
| `admin.job.completed` | A background job completes. |
| `admin.job.failed` | A background job fails. |

### Admin Custom Hooks

Admin webhooks support subscribing to raw Nitro server hook names through `custom_hooks`. Use this when you need events not in the curated catalog.

Rules:
- Hook names must include `:action:` or `:filter:`.
- Only hooks emitted on the Nitro server process bus are deliverable.
- Payload schemas for custom hooks are **not stable** — treat them as internal contracts.

Examples: `db.messages.create:action:after`, `db.threads.create:action:after`

---

## Payload Envelope

Every delivery is a JSON POST with this structure:

```json
{
  "event": "thread.created",
  "event_id": "c8f0d6ee-3c1f-4ec8-9b40-9a2a8a0e8f7c",
  "timestamp": "2026-03-01T18:00:00.000Z",
  "workspace_id": "ws_123",
  "user_id": "user_123",
  "data": {
    "id": "thread_abc",
    "title": "New support case"
  }
}
```

### Headers

Every delivery includes these headers:

| Header | Description |
|---|---|
| `Content-Type` | `application/json` |
| `X-OR3-Event` | The event type (e.g. `thread.created`) |
| `X-OR3-Event-ID` | Unique delivery ID (UUID) |
| `X-OR3-Timestamp` | Unix timestamp (seconds) of when the payload was signed |
| `X-OR3-Signature` | HMAC-SHA256 signature (`sha256=<hex>`) |
| `User-Agent` | `OR3-Webhooks/1.0` |

### Event Data Shapes

Each event type carries a specific `data` shape:

**Thread events** (`thread.created`, `thread.updated`, `thread.deleted`):
```ts
{
  id: string;
  title?: string | null;
  status?: string | null;
  deleted?: boolean;
  pinned?: boolean;
  created_at?: number;
  updated_at?: number;
}
```

**Message events** (`message.created`, `message.updated`):
```ts
{
  id: string;
  thread_id: string;
  role?: string | null;
  content?: string | null;
  deleted?: boolean;
  index?: number;
  order_key?: string | null;
  created_at?: number;
  updated_at?: number;
}
```

**Message completed** (`message.completed`):
```ts
{
  thread_id: string;
  message_id: string;
  model_id?: string | null;
  job_id?: string | null;
  completed_at?: string | null;
}
```

**Document events** (`document.created`, `document.updated`, `document.deleted`):
```ts
{
  id: string;
  title?: string | null;
  content_length?: number | null;
  deleted?: boolean;
  created_at?: number;
  updated_at?: number;
}
```

**Notification** (`notification.created`):
```ts
{
  id: string;
  user_id: string;
  thread_id?: string | null;
  document_id?: string | null;
  type?: string | null;
  title?: string | null;
  body?: string | null;
  read_at?: number | null;
  created_at?: number;
  updated_at?: number;
}
```

---

## Signature Verification

OR3 signs every delivery with HMAC-SHA256. You **must** verify signatures to ensure payloads are authentic and untampered.

The signature is computed over:

```
{timestamp}.{rawBody}
```

Where `timestamp` is the exact value from the `X-OR3-Timestamp` header and `rawBody` is the raw JSON string as transmitted.

### Verification Steps

1. Extract the `X-OR3-Timestamp` and `X-OR3-Signature` headers.
2. Compute HMAC-SHA256 of `"${timestamp}.${rawBody}"` using your signing secret.
3. Format as `sha256=${hex}`.
4. Compare using a timing-safe function to prevent timing attacks.
5. Optionally reject payloads with timestamps older than 5 minutes to prevent replay attacks.

---

## Express Receiver Example

A complete Express server that receives OR3 webhook events, verifies signatures, and processes payloads.

### Setup

```bash
mkdir or3-webhook-receiver && cd or3-webhook-receiver
bun init -y
bun add express
bun add -d @types/express
```

### Full Example (`index.ts`)

```ts
import express from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';

// ─── Configuration ───────────────────────────────────────────────
const PORT = 4000;
const SIGNING_SECRET = process.env.OR3_WEBHOOK_SECRET ?? '';
const MAX_TIMESTAMP_DRIFT_MS = 5 * 60 * 1000; // 5 minutes

if (!SIGNING_SECRET) {
  console.error('OR3_WEBHOOK_SECRET is required');
  process.exit(1);
}

// ─── Signature Verification ─────────────────────────────────────
function verifySignature(
  rawBody: string,
  timestamp: string,
  signature: string,
  secret: string
): boolean {
  const expected = `sha256=${createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex')}`;

  if (expected.length !== signature.length) return false;

  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

// ─── Webhook Payload Types ──────────────────────────────────────
interface WebhookPayload {
  event: string;
  event_id: string;
  timestamp: string;
  workspace_id?: string | null;
  user_id?: string | null;
  scope?: 'user' | 'admin';
  data: Record<string, unknown>;
}

// ─── Express App ────────────────────────────────────────────────
const app = express();

// IMPORTANT: Use express.text() to get the raw body string for signature
// verification. express.json() would parse it first, and re-serializing
// may produce a different string than what was signed.
app.post(
  '/webhooks/or3',
  express.text({ type: 'application/json' }),
  (req, res) => {
    const rawBody = req.body as string;
    const timestamp = req.headers['x-or3-timestamp'] as string | undefined;
    const signature = req.headers['x-or3-signature'] as string | undefined;
    const eventType = req.headers['x-or3-event'] as string | undefined;
    const eventId = req.headers['x-or3-event-id'] as string | undefined;

    // ── Guard: required headers ──
    if (!timestamp || !signature || !eventType || !eventId) {
      res.status(400).json({ error: 'Missing required webhook headers' });
      return;
    }

    // ── Guard: replay protection ──
    const timestampSeconds = Number(timestamp);
    const ageMs = Math.abs(Date.now() - timestampSeconds * 1000);
    if (!Number.isFinite(timestampSeconds) || ageMs > MAX_TIMESTAMP_DRIFT_MS) {
      res.status(403).json({ error: 'Timestamp too old' });
      return;
    }

    // ── Guard: signature verification ──
    if (!verifySignature(rawBody, timestamp, signature, SIGNING_SECRET)) {
      res.status(403).json({ error: 'Invalid signature' });
      return;
    }

    // ── Parse and process ──
    const payload: WebhookPayload = JSON.parse(rawBody);

    console.log(`[webhook] ${payload.event} (${payload.event_id})`);
    console.log(`  workspace: ${payload.workspace_id ?? 'n/a'}`);
    console.log(`  user:      ${payload.user_id ?? 'n/a'}`);
    console.log(`  data:`, JSON.stringify(payload.data, null, 2));

    // Route to event-specific handlers
    switch (payload.event) {
      case 'thread.created':
        console.log(`  → New thread: "${payload.data.title}"`);
        break;
      case 'message.completed':
        console.log(
          `  → AI response completed for thread ${payload.data.thread_id}`
        );
        break;
      case 'document.created':
        console.log(`  → New document: "${payload.data.title}"`);
        break;
      default:
        console.log(`  → Unhandled event type: ${payload.event}`);
    }

    // Respond with 200 to acknowledge receipt.
    // OR3 treats any 2xx as success. Non-2xx triggers retry.
    res.status(200).json({ received: true });
  }
);

app.listen(PORT, () => {
  console.log(`OR3 webhook receiver listening on http://localhost:${PORT}`);
});
```

### Run It

```bash
OR3_WEBHOOK_SECRET=your-signing-secret-here bun run index.ts
```

### Test With curl

```bash
# Compute a test signature
TIMESTAMP=$(date +%s)
BODY='{"event":"thread.created","event_id":"test-123","timestamp":"2026-03-01T00:00:00Z","workspace_id":"ws_1","user_id":"u_1","data":{"id":"t_1","title":"Test thread"}}'
SECRET="your-signing-secret-here"
SIGNATURE="sha256=$(echo -n "${TIMESTAMP}.${BODY}" | openssl dgst -sha256 -hmac "${SECRET}" | awk '{print $2}')"

curl -X POST http://localhost:4000/webhooks/or3 \
  -H "Content-Type: application/json" \
  -H "X-OR3-Event: thread.created" \
  -H "X-OR3-Event-ID: test-123" \
  -H "X-OR3-Timestamp: ${TIMESTAMP}" \
  -H "X-OR3-Signature: ${SIGNATURE}" \
  -d "${BODY}"
```

### Key Implementation Notes

1. **Use `express.text()`, not `express.json()`** — signature verification requires the exact raw body bytes. Parsing to JSON and re-serializing may alter whitespace or key order.
2. **Always use `timingSafeEqual`** — prevents timing side-channel attacks on the signature comparison.
3. **Check timestamp freshness** — reject payloads older than 5 minutes to block replay attacks.
4. **Return 2xx promptly** — OR3 treats any 2xx as successful delivery. Non-2xx responses trigger automatic retries with exponential backoff.

---

## Verification in Other Languages

### Python

```python
import hmac
import hashlib

def verify_or3_webhook(
    raw_body: str,
    headers: dict[str, str],
    signing_secret: str
) -> bool:
    timestamp = headers.get("x-or3-timestamp")
    received = headers.get("x-or3-signature")
    if not timestamp or not received:
        return False

    payload = f"{timestamp}.{raw_body}".encode("utf-8")
    digest = hmac.new(
        signing_secret.encode("utf-8"),
        payload,
        hashlib.sha256,
    ).hexdigest()
    expected = f"sha256={digest}"
    return hmac.compare_digest(expected, received)
```

### Go

```go
package main

import (
    "crypto/hmac"
    "crypto/sha256"
    "encoding/hex"
    "fmt"
)

func VerifyOR3Webhook(rawBody, timestamp, signature, secret string) bool {
    mac := hmac.New(sha256.New, []byte(secret))
    mac.Write([]byte(fmt.Sprintf("%s.%s", timestamp, rawBody)))
    expected := "sha256=" + hex.EncodeToString(mac.Sum(nil))
    return hmac.Equal([]byte(expected), []byte(signature))
}
```

---

## Retry Policy

Failed deliveries are retried with exponential backoff:

| Attempt | Delay |
|---|---|
| 1 | Immediate |
| 2 | 30 seconds |
| 3 | 2 minutes |
| 4 | 10 minutes |
| 5 | 30 minutes |
| 6 | 1 hour |

Retries stop after the configured `OR3_WEBHOOKS_MAX_RETRY_HOURS` window (default: 1 hour).

A delivery is considered **successful** on any HTTP 2xx response. Any non-2xx, network error, or timeout triggers the next retry.

---

## Security

### SSRF Protection

OR3 performs DNS-time private IP checks before delivering webhooks. By default, URLs resolving to private/internal IP ranges (10.x, 172.16-31.x, 192.168.x, 127.x, ::1, etc.) are blocked.

Control this with `OR3_WEBHOOKS_BLOCK_PRIVATE_IPS`:
- `true` (default in production) — blocks private IPs
- `false` — allows private IPs (useful for local development)

### Signing Secret Encryption

Signing secrets are encrypted at rest using AES-256-GCM with the `OR3_WEBHOOKS_ENCRYPTION_KEY`. They are decrypted only at delivery time and never stored in plaintext.

### URL Validation

Webhook URLs must:
- Use `https://` or `http://` protocol
- Not resolve to private IP addresses (when SSRF protection is enabled)
- Be reachable within the configured delivery timeout

---

## Configuration Reference

| Setting | Env Var | Default | Description |
|---|---|---|---|
| Master switch | `OR3_WEBHOOKS_ENABLED` | `true` (when SSR auth enabled) | Enable/disable the webhook system |
| Encryption key | `OR3_WEBHOOKS_ENCRYPTION_KEY` | — (**required**) | AES key for signing secret encryption |
| User limit | `OR3_WEBHOOKS_MAX_PER_USER` | `20` | Max webhooks per user |
| Admin limit | `OR3_WEBHOOKS_ADMIN_MAX` | `50` | Max admin-scope webhooks |
| Rate limit | `OR3_WEBHOOKS_RATE_LIMIT_PER_MINUTE` | `120` | Max deliveries per webhook per minute |
| Delivery timeout | `OR3_WEBHOOKS_DELIVERY_TIMEOUT_MS` | `10000` | HTTP timeout per delivery attempt |
| Block private IPs | `OR3_WEBHOOKS_BLOCK_PRIVATE_IPS` | `true` | SSRF protection toggle |
| Retry window | `OR3_WEBHOOKS_MAX_RETRY_HOURS` | `1` | Hours to keep retrying failed deliveries |
| Log retention | `OR3_WEBHOOKS_LOG_RETENTION_HOURS` | `72` | Hours to keep delivery logs |

---

## Delivery Logs

Both the user dashboard and admin panel show delivery logs for each webhook, including:

- Event type and delivery status (`success`, `failed`, `pending`, `in_flight`, `cancelled`)
- HTTP status code from the receiver
- Request payload (full JSON)
- Response body (truncated to 4 KB)
- Error message (for failures)
- Duration in milliseconds
- Attempt count

Logs are retained for the configured `OR3_WEBHOOKS_LOG_RETENTION_HOURS` (default: 72 hours) and automatically purged after that.

---

## Operational Notes

- Pending deliveries **survive server restarts** — they are stored in the webhook store and reprocessed on startup.
- Stale `in_flight` rows (from worker crashes) are automatically reaped after 5 minutes.
- The dispatcher polls for claimable work every 5 seconds and processes in batches of 25.
- A webhook is marked `failing` health after consecutive delivery failures.
- Use the **Test Ping** button in the UI to verify connectivity before going live.
- Webhook persistence is **provider-owned**. The active sync provider must register a `WebhookStore` implementation.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "Webhook store not configured" | Active sync provider hasn't registered a webhook store | Ensure your provider package is installed and rebuilt |
| Cannot create webhooks | Missing `OR3_WEBHOOKS_ENCRYPTION_KEY` | Set the env var and restart |
| All deliveries fail immediately | Target URL resolves to private IP | Set `OR3_WEBHOOKS_BLOCK_PRIVATE_IPS=false` for local dev |
| Signature verification fails | Body was parsed/re-serialized before verification | Use raw body string for HMAC computation |
| Deliveries stop retrying | Retry window expired | Increase `OR3_WEBHOOKS_MAX_RETRY_HOURS` or fix receiver |
