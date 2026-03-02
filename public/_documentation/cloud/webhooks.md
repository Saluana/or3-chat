# Webhooks

OR3 webhooks deliver server-side events to external HTTP endpoints with signed JSON payloads, retry scheduling, delivery logs, and separate user/admin scopes.

There are two management surfaces:

- User webhooks: dashboard plugin page under `Webhooks`
- Admin webhooks: admin panel page at `/admin/webhooks`

Both scopes use the same store, dispatcher, retry policy, HMAC signing, and delivery logging.

---

## User Event Catalog

User webhooks expose a curated catalog:

- `thread.created`
- `thread.updated`
- `thread.deleted`
- `message.created`
- `message.updated`
- `message.completed`
- `document.created`
- `document.updated`
- `document.deleted`
- `notification.created`

These events are intended for normal workspace integrations. They do not expose arbitrary internal hook names.

---

## Admin Event Catalog

Admin webhooks expose curated operational events:

- `admin.user.created`
- `admin.workspace.created`
- `admin.workspace.deleted`
- `admin.user.role_changed`
- `admin.plugin.installed`
- `admin.plugin.enabled`
- `admin.plugin.disabled`
- `admin.sync.error`
- `admin.storage.error`
- `admin.job.completed`
- `admin.job.failed`

Admin payloads also include `scope: "admin"` and intentionally omit `user_id`.

---

## Admin Advanced Mode

Admin webhooks support an advanced mode for subscribing to raw server-side Nitro hook names through `custom_hooks`.

Use this when you need delivery for a hook that is not part of the curated admin catalog.

Rules:

- Hook names must be non-empty.
- Hook names must include `:action:` or `:filter:`.
- Only hooks emitted on the server process bus (`nitroApp.hooks`) are deliverable.
- Payload schemas for custom hooks are not stable; treat them as internal contracts.

Example custom hooks:

- `db.messages.create:action:after`
- `db.threads.create:action:after`
- `admin.workspace:action:created`

---

## Payload Envelope

Every delivery is JSON and follows the same envelope:

```json
{
  "event": "thread.created",
  "event_id": "c8f0d6ee-3c1f-4ec8-9b40-9a2a8a0e8f7c",
  "timestamp": "2026-03-01T18:00:00.000Z",
  "workspace_id": "ws_123",
  "user_id": "user_123",
  "data": {
    "id": "thread_123",
    "title": "Support case"
  }
}
```

Headers included on every delivery:

- `X-OR3-Event`
- `X-OR3-Event-ID`
- `X-OR3-Timestamp`
- `X-OR3-Signature`
- `User-Agent: OR3-Webhooks/1.0`

---

## Signature Verification

OR3 signs the raw request body with HMAC-SHA256 over:

- `{timestamp}.{body}`

Where:

- `timestamp` is the exact `X-OR3-Timestamp` header value
- `body` is the raw JSON body bytes as received

The signature header format is:

- `sha256=<hex>`

### Node.js

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyOr3Webhook(rawBody, headers, signingSecret) {
  const timestamp = headers['x-or3-timestamp'];
  const received = headers['x-or3-signature'];
  if (!timestamp || !received) return false;

  const expected = `sha256=${createHmac('sha256', signingSecret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex')}`;

  return timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(received)
  );
}
```

### Python

```python
import hmac
import hashlib

def verify_or3_webhook(raw_body: str, headers: dict[str, str], signing_secret: str) -> bool:
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

---

## Configuration

Webhook behavior is controlled by `config.or3cloud.ts` / `or3-cloud-config` and the matching env vars:

| Setting | Env Var | Default |
|---|---|---|
| Master switch | `OR3_WEBHOOKS_ENABLED` | `true` when SSR auth is enabled |
| User limit | `OR3_WEBHOOKS_MAX_PER_USER` | `20` |
| Admin limit | `OR3_WEBHOOKS_ADMIN_MAX` | `50` |
| Per-webhook rate limit | `OR3_WEBHOOKS_RATE_LIMIT_PER_MINUTE` | `120` |
| Delivery timeout | `OR3_WEBHOOKS_DELIVERY_TIMEOUT_MS` | `10000` |
| Block private IPs | `OR3_WEBHOOKS_BLOCK_PRIVATE_IPS` | `true` |
| Secret encryption key | `OR3_WEBHOOKS_ENCRYPTION_KEY` | empty (required for create/update) |
| Retry window | `OR3_WEBHOOKS_MAX_RETRY_HOURS` | `1` |
| Log retention | `OR3_WEBHOOKS_LOG_RETENTION_HOURS` | `72` |

If no encryption key is configured, webhook creation is rejected and the webhook runtime will not start.

---

## Operational Notes

- Deliveries are retried with exponential backoff.
- The dispatcher performs DNS-time private IP checks to block SSRF and DNS rebinding.
- Pending deliveries survive restarts because they are stored in the webhook store.
- Stale `in_flight` rows are reaped automatically after worker crashes.
- Delivery logs are available from both the user and admin UI for the last retention window.
