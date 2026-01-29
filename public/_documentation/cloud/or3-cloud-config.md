# OR3 Cloud Configuration (or3-cloud-config)

Server-side configuration for authentication, sync, storage, rate limiting, and security. **Requires SSR mode.**

For a complete, setting-by-setting deep dive (including defaults, strict-mode requirements, and how env vars are interpreted), see:

- [Configuration Reference](./config-reference)

## Quick Start

```typescript
// config.or3cloud.ts
import { defineOr3CloudConfig } from './utils/or3-cloud-config';

export const or3CloudConfig = defineOr3CloudConfig({
    auth: {
        enabled: true,
        provider: 'clerk',
        clerk: {
            publishableKey: process.env.NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
            secretKey: process.env.NUXT_CLERK_SECRET_KEY,
        },
    },
    sync: {
        enabled: true,
        provider: 'convex',
        convex: { url: process.env.VITE_CONVEX_URL },
    },
});
```

## Configuration Sections

### Authentication

| Key | Env Variable | Default | Description |
|-----|--------------|---------|-------------|
| `auth.enabled` | `SSR_AUTH_ENABLED` | `false` | Enable SSR authentication |
| `auth.provider` | `AUTH_PROVIDER` | `"clerk"` | Auth provider (`clerk` / `custom`) |
| `auth.clerk.publishableKey` | `NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | — | Clerk publishable key |
| `auth.clerk.secretKey` | `NUXT_CLERK_SECRET_KEY` | — | Clerk secret key |

### Sync (Multi-Device)

| Key | Env Variable | Default | Description |
|-----|--------------|---------|-------------|
| `sync.enabled` | `OR3_SYNC_ENABLED` | `true` (if auth) | Enable cross-device sync |
| `sync.provider` | `OR3_SYNC_PROVIDER` | `"convex"` | Backend (`convex` / `firebase` / `custom`) |
| `sync.convex.url` | `VITE_CONVEX_URL` | — | Convex deployment URL |

### Storage (File Uploads)

| Key | Env Variable | Default | Description |
|-----|--------------|---------|-------------|
| `storage.enabled` | `OR3_STORAGE_ENABLED` | `true` (if auth) | Enable cloud storage |
| `storage.provider` | `NUXT_PUBLIC_STORAGE_PROVIDER` | `"convex"` | Backend (`convex` / `s3` / `custom`) |

### LLM Services

| Key | Env Variable | Default | Description |
|-----|--------------|---------|-------------|
| `services.llm.openRouter.instanceApiKey` | `OPENROUTER_API_KEY` | — | Managed API key (optional) |
| `services.llm.openRouter.allowUserOverride` | `OR3_OPENROUTER_ALLOW_USER_OVERRIDE` | `true` | Allow user-provided keys |
| `services.llm.openRouter.requireUserKey` | `OR3_OPENROUTER_REQUIRE_USER_KEY` | `false` | Require user keys and ignore instance key |

### Rate Limiting

| Key | Env Variable | Default | Description |
|-----|--------------|---------|-------------|
| `limits.enabled` | `OR3_LIMITS_ENABLED` | `true` | Enable rate limiting |
| `limits.requestsPerMinute` | `OR3_REQUESTS_PER_MINUTE` | `20` | Per-user requests/minute |
| `limits.maxMessagesPerDay` | `OR3_MAX_MESSAGES_PER_DAY` | `0` (unlimited) | Daily message cap |
| `limits.maxConversations` | `OR3_MAX_CONVERSATIONS` | `0` (unlimited) | Max conversations |
| `limits.storageProvider` | `OR3_LIMITS_STORAGE_PROVIDER` | `"convex"` (if sync) | Rate limit backend |

### Legal

| Key | Env Variable | Description |
|-----|--------------|-------------|
| `legal.termsUrl` | `OR3_TERMS_URL` | Terms of Service URL (footer link) |
| `legal.privacyUrl` | `OR3_PRIVACY_URL` | Privacy Policy URL (footer link) |

### Security

| Key | Env Variable | Default | Description |
|-----|--------------|---------|-------------|
| `security.allowedOrigins` | `OR3_ALLOWED_ORIGINS` | `[]` (all) | CORS allowed origins (comma-separated) |
| `security.forceHttps` | `OR3_FORCE_HTTPS` | `true` (prod) | Force HTTPS redirects |

## Dependency Chain

```
auth → sync → storage
      └─────→ rate-limit-provider
```

- **Auth** is the gate—sync and storage require it
- **Sync** defaults to enabled when auth is enabled
- **Storage** defaults to enabled when auth is enabled
- **Rate limit storage** uses Convex when sync is enabled, otherwise memory

## Static vs SSR Builds

> [!IMPORTANT]
> This config is for **SSR builds only**. Static builds cannot use cloud features.

| Build Mode | Cloud Config Behavior |
|------------|----------------------|
| **Static** (`nuxt generate`) | ❌ Server routes don't exist. Cloud features unavailable. |
| **SSR** (`nuxt build`) | ✅ Full support. Server middleware, API routes, secrets available. |

### What Happens in Static Builds?

- `*.server.ts` plugins are **excluded** from the bundle
- Server-only `runtimeConfig` values are `undefined`
- API routes (`server/api/`) don't exist
- Auth, sync, storage, rate limiting are all disabled

### Plugin File Naming

```
app/plugins/
├── cloud-feature.client.ts   ← Runs in both (client-side only)
├── cloud-feature.server.ts   ← SSR only, DOES NOT RUN in static
└── cloud-feature.ts          ← Both sides in SSR, client-only in static
```

### Checking Build Mode at Runtime

```typescript
// In server code
const config = useRuntimeConfig();
if (config.auth.enabled) {
    // Safe to use auth APIs
}

// In client code
const config = useRuntimeConfig();
if (config.public.ssrAuthEnabled) {
    // Auth is available, show login UI
}
```

## Validation

Strict mode (production default) requires:

- `auth.clerk.publishableKey` + `auth.clerk.secretKey` when auth enabled
- `sync.convex.url` when sync enabled with Convex
- `services.llm.openRouter.instanceApiKey` when `allowUserOverride: false`

```
[or3-cloud-config] Configuration validation failed:
- auth.clerk.secretKey is required when auth is enabled.
```

## Usage

### Runtime Config Access

```typescript
// Server-side (API routes, server plugins)
const config = useRuntimeConfig();
if (config.sync.enabled) {
    // Use sync APIs
}

// Client-side (components, client plugins)
const config = useRuntimeConfig();
if (config.public.sync.enabled) {
    // Show sync status UI
}
```

> [!NOTE]
> `runtimeConfig.public` only includes **non-sensitive** values for client gating. For example, `limits.storageProvider` remains server-only and is intentionally omitted from the public runtime config.

### Direct Import

```typescript
import { or3CloudConfig } from '~~/config.or3cloud';

// Access at build time (nuxt.config.ts, server code)
const syncUrl = or3CloudConfig.sync.convex?.url;
```

> [!WARNING]
> Don't import `config.or3cloud.ts` in client code—it may contain secrets like `auth.clerk.secretKey`.

## Related

- [or3-config](./or3-config) — Base configuration (branding, features, limits)
- [auth-system](./auth-system) — Authentication architecture
- [sync-layer](./sync-layer) — Sync system details
- [storage-layer](./storage-layer) — Storage system details
