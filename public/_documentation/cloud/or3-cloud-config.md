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

| Key                               | Env Variable                             | Default                        | Description                                                                              |
| --------------------------------- | ---------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------- |
| `auth.enabled`                    | `SSR_AUTH_ENABLED`                       | `false`                        | Enable SSR authentication (gates all cloud features)                                     |
| `auth.provider`                   | `AUTH_PROVIDER` (or `OR3_AUTH_PROVIDER`) | `"clerk"`                      | Auth provider (`basic-auth` / `clerk` / `custom`)                                        |
| `auth.guestAccessEnabled`         | `OR3_GUEST_ACCESS_ENABLED`               | `false`                        | Allow unauthenticated (guest) access when users provide their own OpenRouter key         |
| `auth.autoProvision`              | `OR3_AUTH_AUTO_PROVISION`                | `true`                         | Auto-provision users/workspaces on first authenticated session                           |
| `auth.registrationMode`           | `OR3_AUTH_REGISTRATION_MODE`             | derived (from `autoProvision`) | First-time registration policy (`open` / `invite_only` / `disabled`)                     |
| `auth.sessionProvisioningFailure` | `OR3_SESSION_PROVISIONING_FAILURE`       | `"throw"`                      | What to do when provisioning fails (`throw` / `unauthenticated` / `service-unavailable`) |
| `auth.lockPage.enabled`           | `OR3_AUTH_LOCK_PAGE_ENABLED`             | `false`                        | Redirect protected shell routes to a public lock page instead of rendering the app shell |
| `auth.lockPage.adapter`           | `OR3_AUTH_LOCK_PAGE_ADAPTER`             | `"default"`                    | Registered lock page adapter id used by the lock page route                              |
| `auth.clerk.publishableKey`       | `NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY`      | —                              | Clerk publishable key                                                                    |
| `auth.clerk.secretKey`            | `NUXT_CLERK_SECRET_KEY`                  | —                              | Clerk secret key                                                                         |

#### Lock Page (Optional)

Use the lock page when you want signed-out visitors redirected away from the main shell (`/`, `/chat`, `/docs`) and onto a dedicated public route.

- It stays inert unless `SSR_AUTH_ENABLED=true`.
- It only applies to the authenticated shell entry points, not arbitrary public pages.
- Admin routes remain reachable and are never redirected through the lock page.
- Guest access still bypasses the lock page when `auth.guestAccessEnabled=true`.
- With `adapter: 'default'`, OR3 prefers the active auth provider's registered lock page surface and falls back to the built-in generic renderer when none exists.
- Unknown custom adapter ids fall back to the built-in default renderer.

```typescript
auth: {
    enabled: true,
    provider: 'basic-auth',
    lockPage: {
        enabled: true,
        adapter: 'default',
    },
}
```

The built-in lock page route is fixed at `/welcome`.

Minimal env setup:

```bash
SSR_AUTH_ENABLED=true
OR3_AUTH_PROVIDER=basic-auth
OR3_AUTH_LOCK_PAGE_ENABLED=true
OR3_AUTH_LOCK_PAGE_ADAPTER=default
```

Practical behavior:

- Visiting `/`, `/chat`, or `/docs` while signed out redirects to `/welcome?next=...`.
- After a successful sign-in, the user is sent back to the original safe in-app target.
- The `next` target is sanitized so external redirects are ignored.

To brand the experience, register a custom lock page adapter from normal app/plugin code and point `auth.lockPage.adapter` at that id. If left at `default`, the active provider can supply its own lock page UI. Forks that want full control can replace `app/pages/welcome.vue` directly.

#### Invite Tokens (Optional)

If `auth.registrationMode` is set to `invite_only`, invite token signing must be configured via env:

| Env Variable                        | Default  | Description                                       |
| ----------------------------------- | -------- | ------------------------------------------------- |
| `OR3_AUTH_INVITE_TOKEN_SECRET`      | —        | HMAC secret used to sign/verify invite tokens     |
| `OR3_AUTH_INVITE_TOKEN_TTL_SECONDS` | `604800` | Default TTL for generated invite tokens (seconds) |

### Sync (Multi-Device)

| Key                    | Env Variable                                     | Default          | Description                                                   |
| ---------------------- | ------------------------------------------------ | ---------------- | ------------------------------------------------------------- |
| `sync.enabled`         | `OR3_SYNC_ENABLED` (or `OR3_CLOUD_SYNC_ENABLED`) | `true` (if auth) | Enable cross-device sync                                      |
| `sync.provider`        | `OR3_SYNC_PROVIDER`                              | `"convex"`       | Backend (`sqlite` / `convex` / `firebase` / `custom`)         |
| `sync.convex.url`      | `VITE_CONVEX_URL`                                | —                | Convex deployment URL                                         |
| `sync.convex.adminKey` | `CONVEX_SELF_HOSTED_ADMIN_KEY`                   | —                | Server-side Convex admin key for super admin dashboard access |

#### Getting `CONVEX_SELF_HOSTED_ADMIN_KEY`

- **Convex Cloud**: Open the Convex Dashboard → select your deployment → **Settings → URL & Deploy Key** → copy the deploy key.
- **Self-hosted**: Use the admin key generated by your backend (for the official docker setup, run `docker compose exec backend ./generate_admin_key.sh`).
- **Local anonymous dev**: Convex writes a local admin key under `~/.convex/anonymous-convex-backend-state/`.

#### Convex Environment Variables

When using Convex as the sync/storage backend, set these environment variables:

- `VITE_CONVEX_URL` (required): Convex deployment URL used by OR3 for sync + storage.
- `CLERK_ISSUER_URL` (required for Clerk auth): Issuer URL from your Clerk JWT template. This is read by [convex/auth.config.ts](../../convex/auth.config.ts) so Convex can validate Clerk tokens.

If you are self-hosting Convex, you may also need Convex runtime variables (outside OR3):

- `CONVEX_SELF_HOSTED_URL`
- `CONVEX_SELF_HOSTED_ADMIN_KEY`

> [!NOTE]
> OR3 only reads `VITE_CONVEX_URL` for the Convex URL. The other values are consumed by Convex itself.

#### Setting Convex env vars (Convex backend)

Convex needs these set in its environment:

- `CLERK_ISSUER_URL`
- `OR3_ADMIN_JWT_SECRET`

Set them with:

```
bunx convex env set CLERK_ISSUER_URL=<your-clerk-issuer-url>
bunx convex env set OR3_ADMIN_JWT_SECRET=<your-admin-jwt-secret>
```

### Storage (File Uploads)

| Key                           | Env Variable                                           | Default                  | Description                                   |
| ----------------------------- | ------------------------------------------------------ | ------------------------ | --------------------------------------------- |
| `storage.enabled`             | `OR3_STORAGE_ENABLED` (or `OR3_CLOUD_STORAGE_ENABLED`) | `true` (if auth)         | Enable cloud storage                          |
| `storage.provider`            | `NUXT_PUBLIC_STORAGE_PROVIDER`                         | `"convex"`               | Backend (`fs` / `convex` / `s3` / `custom`)   |
| `storage.allowedMimeTypes`    | `OR3_STORAGE_ALLOWED_MIME_TYPES`                       | image/pdf/text allowlist | Comma-separated upload MIME allowlist         |
| `storage.workspaceQuotaBytes` | `OR3_STORAGE_WORKSPACE_QUOTA_BYTES`                    | unset                    | Optional per-workspace storage quota in bytes |
| `storage.gcRetentionSeconds`  | `OR3_STORAGE_GC_RETENTION_SECONDS`                     | `2592000`                | Default retention used by storage GC          |
| `storage.gcCooldownMs`        | `OR3_STORAGE_GC_COOLDOWN_MS`                           | `60000`                  | Cooldown between manual storage GC runs       |

### LLM Services

| Key                                         | Env Variable                         | Default                        | Description                                     |
| ------------------------------------------- | ------------------------------------ | ------------------------------ | ----------------------------------------------- |
| `services.llm.openRouter.instanceApiKey`    | `OPENROUTER_API_KEY`                 | —                              | Managed API key (optional)                      |
| `services.llm.openRouter.baseUrl`           | `OR3_OPENROUTER_BASE_URL`            | `https://openrouter.ai/api/v1` | OpenRouter-compatible base URL for proxy setups |
| `services.llm.openRouter.allowUserOverride` | `OR3_OPENROUTER_ALLOW_USER_OVERRIDE` | `true`                         | Allow user-provided keys                        |
| `services.llm.openRouter.requireUserKey`    | `OR3_OPENROUTER_REQUIRE_USER_KEY`    | `false`                        | Require user keys and ignore instance key       |

### Rate Limiting

| Key                          | Env Variable                    | Default                                         | Description                                            |
| ---------------------------- | ------------------------------- | ----------------------------------------------- | ------------------------------------------------------ |
| `limits.enabled`             | `OR3_LIMITS_ENABLED`            | `true`                                          | Enable rate limiting                                   |
| `limits.requestsPerMinute`   | `OR3_REQUESTS_PER_MINUTE`       | `20`                                            | Per-user requests/minute                               |
| `limits.maxMessagesPerDay`   | `OR3_MAX_MESSAGES_PER_DAY`      | `0` (unlimited)                                 | Daily message cap                                      |
| `limits.maxConversations`    | `OR3_MAX_CONVERSATIONS`         | `0` (unlimited)                                 | Max conversations                                      |
| `limits.storageProvider`     | `OR3_LIMITS_STORAGE_PROVIDER`   | `sync.provider` (if sync), otherwise `"memory"` | Rate limit backend                                     |
| `limits.operationRateLimits` | `OR3_RATE_LIMIT_OVERRIDES_JSON` | `{}`                                            | Per-operation `{ windowMs, maxRequests }` override map |

Example `OR3_RATE_LIMIT_OVERRIDES_JSON`:

```json
{
    "storage:upload": { "maxRequests": 20, "windowMs": 60000 },
    "workflow:background": { "maxRequests": 10, "windowMs": 60000 }
}
```

### Background Streaming

| Key                                            | Env Variable                        | Default                                         | Description                         |
| ---------------------------------------------- | ----------------------------------- | ----------------------------------------------- | ----------------------------------- |
| `backgroundStreaming.enabled`                  | `OR3_BACKGROUND_STREAMING_ENABLED`  | `false`                                         | Enable server background streaming  |
| `backgroundStreaming.storageProvider`          | `OR3_BACKGROUND_STREAMING_PROVIDER` | `sync.provider` (if sync), otherwise `"memory"` | Background job state backend        |
| `backgroundStreaming.maxConcurrentJobs`        | `OR3_BACKGROUND_MAX_JOBS`           | `20`                                            | Global concurrent background jobs   |
| `backgroundStreaming.maxConcurrentJobsPerUser` | `OR3_BACKGROUND_MAX_JOBS_PER_USER`  | `5`                                             | Per-user concurrent background jobs |
| `backgroundStreaming.jobTimeoutSeconds`        | `OR3_BACKGROUND_JOB_TIMEOUT`        | `300`                                           | Background job timeout in seconds   |

> [!NOTE]
> Legal links (`OR3_TERMS_URL`, `OR3_PRIVACY_URL`) are configured in [or3-config](./or3-config) (base config), not `or3-cloud-config`.

### Security

| Key                                  | Env Variable               | Default              | Description                                                               |
| ------------------------------------ | -------------------------- | -------------------- | ------------------------------------------------------------------------- |
| `security.allowedOrigins`            | `OR3_ALLOWED_ORIGINS`      | `[]` (all)           | CORS allowed origins (comma-separated)                                    |
| `security.forceHttps`                | `OR3_FORCE_HTTPS`          | `true` (prod)        | Force HTTPS redirects                                                     |
| `security.proxy.trustProxy`          | `OR3_TRUST_PROXY`          | `false`              | Trust reverse-proxy headers (`X-Forwarded-*`)                             |
| `security.proxy.forwardedForHeader`  | `OR3_FORWARDED_FOR_HEADER` | `"x-forwarded-for"`  | Which header to treat as the client IP (`x-forwarded-for` or `x-real-ip`) |
| `security.proxy.forwardedHostHeader` | —                          | `"x-forwarded-host"` | Header used for forwarded host resolution (fixed)                         |

### Admin

Admin routes are **disabled by default**. They become available only when `OR3_ADMIN_USERNAME` and `OR3_ADMIN_PASSWORD` are set.

#### Dashboard & Operations

| Key                                | Env Variable                             | Default            | Description                                                                         |
| ---------------------------------- | ---------------------------------------- | ------------------ | ----------------------------------------------------------------------------------- |
| `admin.basePath`                   | `OR3_ADMIN_BASE_PATH`                    | `"/admin"`         | Base path for admin UI/routes                                                       |
| `admin.allowedHosts`               | `OR3_ADMIN_ALLOWED_HOSTS`                | `[]`               | Optional host allowlist (comma-separated). If set, admin returns 404 on other hosts |
| `admin.allowRestart`               | `OR3_ADMIN_ALLOW_RESTART`                | `false`            | Allow admin-initiated restarts                                                      |
| `admin.allowRebuild`               | `OR3_ADMIN_ALLOW_REBUILD`                | `false`            | Allow admin-initiated rebuild + restart                                             |
| `admin.rebuildCommand`             | `OR3_ADMIN_REBUILD_COMMAND`              | `"bun run build"`  | Rebuild command used when `allowRebuild` is enabled                                 |
| `admin.extensionMaxZipBytes`       | `OR3_ADMIN_EXTENSION_MAX_ZIP_BYTES`      | `25MB`             | Max ZIP size for extension installs (bytes)                                         |
| `admin.extensionMaxFiles`          | `OR3_ADMIN_EXTENSION_MAX_FILES`          | `2000`             | Max number of files in an extension install                                         |
| `admin.extensionMaxTotalBytes`     | `OR3_ADMIN_EXTENSION_MAX_TOTAL_BYTES`    | `200MB`            | Max total unpacked bytes for an extension install (bytes)                           |
| `admin.extensionAllowedExtensions` | `OR3_ADMIN_EXTENSION_ALLOWED_EXTENSIONS` | built-in allowlist | Comma-separated allowed file extensions for extension installs                      |

#### Admin Auth (Super Admin)

| Key                                        | Env Variable                                 | Default               | Description                                     |
| ------------------------------------------ | -------------------------------------------- | --------------------- | ----------------------------------------------- |
| `admin.auth.username`                      | `OR3_ADMIN_USERNAME`                         | —                     | Super admin username (required to enable admin) |
| `admin.auth.password`                      | `OR3_ADMIN_PASSWORD`                         | —                     | Super admin password (required to enable admin) |
| `admin.auth.jwtSecret`                     | `OR3_ADMIN_JWT_SECRET`                       | auto-generated in dev | JWT signing secret (required in production)     |
| `admin.auth.jwtExpiry`                     | `OR3_ADMIN_JWT_EXPIRY`                       | `"24h"`               | JWT/cookie expiry (`24h`, `7d`, etc.)           |
| `admin.auth.deletedWorkspaceRetentionDays` | `OR3_ADMIN_DELETED_WORKSPACE_RETENTION_DAYS` | unset                 | Days to retain soft-deleted workspaces          |

#### Plugin Operations

| Key                                                                          | Default | Description                                                                                                                                                          |
| ---------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `admin.disableNonCorePlugins` (`OR3_DISABLE_NON_CORE_PLUGINS`)               | `false` | Boot-time safe mode; skips configured Nuxt plugin modules, admin/workspace plugin discovery, runtime manifests, and plugin server routes before plugin code executes |
| `admin.pluginRuntimeShadowEnabled` (`OR3_PLUGIN_RUNTIME_SHADOW_ENABLED`)     | `true`  | Enables the read-only Milestone 1 observer; set to `false` and restart to restore the observer-free V1 path without disabling plugins                                |
| `admin.pluginRuntimeLoaderEnabled`                                           | `true`  | Enables workspace plugin runtime manifest + client loader paths                                                                                                      |
| `admin.pluginRuntimeV2Enabled` (`OR3_PLUGIN_RUNTIME_V2_ENABLED`)             | `true`  | Startup-only selection for the generation-safe bundled V1 manager; set to `false` and restart to restore the V1 authority path                                       |
| `admin.pluginRuntimeV2WorkspaceIds` (`OR3_PLUGIN_RUNTIME_V2_WORKSPACE_IDS`)  | `[]`    | Optional comma-separated workspace canary allowlist; empty means every workspace when V2 is enabled                                                                  |
| `admin.pluginContributionV2Surfaces` (`OR3_PLUGIN_CONTRIBUTION_V2_SURFACES`) | `[]`    | Startup-only comma-separated allowlist for independently migrated contribution surfaces                                                                              |
| `admin.hookEngineV2Enabled` (`OR3_HOOK_ENGINE_V2_ENABLED`)                   | `false` | Startup-only Hook Runtime V2 selector; set to `false` and restart to restore the frozen V1 engine                                                                    |
| `admin.pluginModuleLoaderV2Enabled` (`OR3_PLUGIN_MODULE_LOADER_V2_ENABLED`)   | `false` | Startup-only gate for the V2 immutable package candidate/promotion lane and selected server modules; disable and restart for a no-data-deletion rollback              |
| `admin.pluginModuleLoaderV2WorkspaceIds` (`OR3_PLUGIN_MODULE_LOADER_V2_WORKSPACE_IDS`) | `[]` | Startup-only V2 package canary allowlist; independent of the bundled V1 manager canary, empty means all workspaces when the loader is enabled |
| `admin.pluginIsolationEnabled` (`OR3_PLUGIN_ISOLATION_ENABLED`)               | `false` | Enables optional isolated plugin execution surfaces where supported                                                                                                  |
| `admin.pluginZipInstallEnabled`                                              | `true`  | Enables/disables ZIP-based extension install endpoint                                                                                                                |
| `admin.pluginRouteDispatcherEnabled`                                         | `true`  | Enables/disables manifest-declared plugin server route dispatcher                                                                                                    |

## Dependency Chain

```
auth ─┬→ sync
      └→ storage

sync (optional) ─→ limits.storageProvider default
sync (optional) ─→ backgroundStreaming.storageProvider default
```

- **Auth** is the gate—sync and storage require it
- **Sync** defaults to enabled when auth is enabled
- **Storage** defaults to enabled when auth is enabled
- **Rate limit storage** defaults to `sync.provider` when sync is enabled, otherwise memory
- **Background job storage** defaults to `sync.provider` when sync is enabled, otherwise memory

## Static vs SSR Builds

> [!IMPORTANT]
> This config is for **SSR builds only**. Static builds cannot use cloud features.

| Build Mode                   | Cloud Config Behavior                                              |
| ---------------------------- | ------------------------------------------------------------------ |
| **Static** (`nuxt generate`) | ❌ Server routes don't exist. Cloud features unavailable.          |
| **SSR** (`nuxt build`)       | ✅ Full support. Server middleware, API routes, secrets available. |

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
- `services.llm.openRouter.allowUserOverride` must be `true` when `requireUserKey: true`

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
- [providers](./providers) — Install provider packages + Clerk/Convex bridge wiring
- [provider-clerk](./provider-clerk) — Dedicated Clerk provider install/setup guide
- [provider-convex](./provider-convex) — Dedicated Convex provider install/setup guide
- [auth-system](./auth-system) — Authentication architecture
- [sync-layer](./sync-layer) — Sync system details
- [storage-layer](./storage-layer) — Storage system details
