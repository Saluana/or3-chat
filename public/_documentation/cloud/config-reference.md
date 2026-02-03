# Configuration Reference

This page is the authoritative reference for every OR3 configuration setting (base + cloud), including environment variables, defaults, and what each setting actually does.

OR3 has two configuration layers:

- `or3-config` (local-first): branding, feature toggles, client limits. Works in static + SSR.
- `or3-cloud-config` (SSR-only): auth, sync, storage, server limits, admin, background jobs.

---

## Where Settings Come From

There are two supported ways to configure OR3:

1. Config files:
   - `config.or3.ts` -> `defineOr3Config()`
   - `config.or3cloud.ts` -> `defineOr3CloudConfig()`

2. Environment variables (most common in deployments):
   - `server/admin/config/resolve-config.ts` builds both configs from env.

### Boolean env semantics

Most feature flags use a "disable by setting false" pattern:

- If the env var is unset: default applies.
- If the env var is set to `false`: feature is disabled.
- If the env var is set to `true`: feature is enabled.

Exceptions:

- `SSR_AUTH_ENABLED` must be explicitly `true` to enable cloud features.
- `OR3_OPENROUTER_REQUIRE_USER_KEY` only enables when `true`.

---

## Base Config (`or3-config`)

Defined by `defineOr3Config()` in `utils/or3-config.ts`.

### `site`

Controls branding and basic identity.

#### `site.name`

- Type: `string`
- Default: `"OR3"`
- Env: `OR3_SITE_NAME`
- Purpose: Primary product name shown in UI + metadata.
- How it’s used: sidebar title, dashboard title, PWA manifest.

#### `site.description`

- Type: `string`
- Default: `""`
- Env: `OR3_SITE_DESCRIPTION`
- Purpose: Meta description (SEO + PWA).

#### `site.logoUrl`

- Type: `string`
- Default: `""`
- Env: `OR3_LOGO_URL`
- Purpose: Logo image URL used in the UI.
- Notes: Use a stable absolute or public path. Leave empty to use built-in defaults.

#### `site.faviconUrl`

- Type: `string`
- Default: `""`
- Env: `OR3_FAVICON_URL`
- Purpose: Favicon URL.

#### `site.defaultTheme`

- Type: `string`
- Default: `"blank"`
- Env: `OR3_DEFAULT_THEME`
- Purpose: Default theme name for new users.
- Notes: Must match a theme available in the app.

### `features`

Feature toggles. All default to enabled.

#### `features.workflows.enabled`

- Type: `boolean`
- Default: `true`
- Env: `OR3_WORKFLOWS_ENABLED`
- Purpose: Master switch for workflows.
- How it’s used: disables editor, slash commands, and execution when off.

#### `features.workflows.editor`

- Type: `boolean`
- Default: `true`
- Env: `OR3_WORKFLOWS_EDITOR`
- Purpose: Enables the workflow editor UI.

#### `features.workflows.slashCommands`

- Type: `boolean`
- Default: `true`
- Env: `OR3_WORKFLOWS_SLASH_COMMANDS`
- Purpose: Enables workflow-related slash commands.

#### `features.workflows.execution`

- Type: `boolean`
- Default: `true`
- Env: `OR3_WORKFLOWS_EXECUTION`
- Purpose: Enables the workflow execution engine.

#### `features.documents.enabled`

- Type: `boolean`
- Default: `true`
- Env: `OR3_DOCUMENTS_ENABLED`
- Purpose: Enables the documents feature.

#### `features.backup.enabled`

- Type: `boolean`
- Default: `true`
- Env: `OR3_BACKUP_ENABLED`
- Purpose: Enables workspace export/import.

#### `features.mentions.enabled`

- Type: `boolean`
- Default: `true`
- Env: `OR3_MENTIONS_ENABLED`
- Purpose: Master switch for @mentions.

#### `features.mentions.documents`

- Type: `boolean`
- Default: `true`
- Env: `OR3_MENTIONS_DOCUMENTS`
- Purpose: Allows mentioning documents.

#### `features.mentions.conversations`

- Type: `boolean`
- Default: `true`
- Env: `OR3_MENTIONS_CONVERSATIONS`
- Purpose: Allows mentioning conversations/threads.

#### `features.dashboard.enabled`

- Type: `boolean`
- Default: `true`
- Env: `OR3_DASHBOARD_ENABLED`
- Purpose: Enables the dashboard/settings UI.

### `limits`

Local limits enforced in the client.

#### `limits.maxFileSizeBytes`

- Type: `number`
- Default: `20 * 1024 * 1024` (20MB)
- Env: `OR3_MAX_FILE_SIZE_BYTES`
- Purpose: Max file size for local uploads.

#### `limits.maxCloudFileSizeBytes`

- Type: `number`
- Default: `100 * 1024 * 1024` (100MB)
- Env: `OR3_MAX_CLOUD_FILE_SIZE_BYTES`
- Purpose: Max file size for cloud uploads.
- Notes: Only meaningful when cloud storage is enabled.

#### `limits.maxFilesPerMessage`

- Type: `number`
- Default: `10`
- Env: `OR3_MAX_FILES_PER_MESSAGE`
- Purpose: Max attachments per chat message.

#### `limits.localStorageQuotaMB`

- Type: `number | null`
- Default: `null`
- Env: `OR3_LOCAL_STORAGE_QUOTA_MB`
- Purpose: Shows warnings when IndexedDB usage approaches this threshold.
- Notes: `null` disables warnings.

### `ui`

UI defaults.

#### `ui.defaultPaneCount`

- Type: `number`
- Default: `1`
- Env: `OR3_DEFAULT_PANE_COUNT`
- Purpose: Default panes for new users.
- Validation: must be an integer in `[1..4]`.

#### `ui.maxPanes`

- Type: `number`
- Default: `4`
- Env: `OR3_MAX_PANES`
- Purpose: Maximum panes allowed.
- Validation: must be an integer in `[1..8]`.

#### `ui.sidebarCollapsedByDefault`

- Type: `boolean`
- Default: `false`
- Env: `OR3_SIDEBAR_COLLAPSED`
- Purpose: Whether the sidebar starts collapsed.

### `extensions`

- Type: `Record<string, unknown>`
- Default: `{}`
- Purpose: Namespace for third-party plugin config.
- How to use:

```ts
export const or3Config = defineOr3Config({
  extensions: {
    myPlugin: {
      apiUrl: 'https://api.example.com',
      featureFlag: true,
    },
  },
});
```

### `legal`

#### `legal.termsUrl`

- Type: `string`
- Default: `""`
- Env: `OR3_TERMS_URL`
- Purpose: Terms of Service URL (footer link).

#### `legal.privacyUrl`

- Type: `string`
- Default: `""`
- Env: `OR3_PRIVACY_URL`
- Purpose: Privacy Policy URL (footer link).

---

## Cloud Config (`or3-cloud-config`)

Defined by `defineOr3CloudConfig()` in `utils/or3-cloud-config.ts`.

Important default behavior when using env:

- `SSR_AUTH_ENABLED=true` enables auth.
- When auth is enabled:
  - sync is enabled unless `OR3_SYNC_ENABLED=false`
  - storage is enabled unless `OR3_STORAGE_ENABLED=false`

### `auth`

#### `auth.enabled`

- Type: `boolean`
- Default: `false`
- Env: `SSR_AUTH_ENABLED`
- Purpose: Gates all cloud features (auth, sync, storage, admin).

#### `auth.provider`

- Type: `'clerk' | 'custom'`
- Default: `'clerk'`
- Env: `AUTH_PROVIDER`
- Purpose: Selects the SSR auth provider.

#### `auth.clerk.publishableKey`

- Type: `string | undefined`
- Default: `undefined`
- Env: `NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- Purpose: Clerk client key.
- Required: yes when `auth.enabled=true` and provider is `clerk` (strict mode).

#### `auth.clerk.secretKey`

- Type: `string | undefined`
- Default: `undefined`
- Env: `NUXT_CLERK_SECRET_KEY`
- Purpose: Clerk server key.
- Required: yes when `auth.enabled=true` and provider is `clerk` (strict mode).

### `sync`

#### `sync.enabled`

- Type: `boolean`
- Default: `false`
- Env: `OR3_SYNC_ENABLED`
- Purpose: Enables cross-device sync.

#### `sync.provider`

- Type: `'convex' | 'firebase' | 'custom'`
- Default: `'convex'`
- Env: `OR3_SYNC_PROVIDER`
- Purpose: Selects backend implementation.

#### `sync.convex.url`

- Type: `string | undefined`
- Default: `undefined`
- Env: `VITE_CONVEX_URL`
- Purpose: Convex deployment URL.
- Required: yes when `sync.enabled=true` and provider is `convex` (strict mode).

#### `sync.convex.adminKey`

- Type: `string | undefined`
- Default: `undefined`
- Env: `CONVEX_SELF_HOSTED_ADMIN_KEY`
- Purpose: Server-side Convex admin key for super admin dashboard access without a user auth session.
- Notes: Only used on the server. Keep this secret.
  - How to get it:
    - Convex Cloud: Convex Dashboard → deployment → Settings → URL & Deploy Key → copy deploy key.
    - Self-hosted: use your backend’s generated admin key (docker: `docker compose exec backend ./generate_admin_key.sh`).
    - Local anonymous dev: see `~/.convex/anonymous-convex-backend-state/`.

#### Convex Auth (Clerk) Environment

Convex validates Clerk JWTs via [convex/auth.config.ts](../../convex/auth.config.ts). Set:

- `CLERK_ISSUER_URL` (required when using Clerk): Issuer URL from your Clerk JWT template.

These are consumed by Convex (not OR3 runtime config), but they are required for the Convex backend to accept auth tokens.

Set them using Convex CLI:

```
bunx convex env set CLERK_ISSUER_URL=<your-clerk-issuer-url>
bunx convex env set OR3_ADMIN_JWT_SECRET=<your-admin-jwt-secret>
```

### `storage`

#### `storage.enabled`

- Type: `boolean`
- Default: `false`
- Env: `OR3_STORAGE_ENABLED`
- Purpose: Enables cloud file uploads and download gateway.

#### `storage.provider`

- Type: `'convex' | 's3' | 'custom'`
- Default: `'convex'`
- Env: `NUXT_PUBLIC_STORAGE_PROVIDER`
- Purpose: Selects object storage backend.

### `services.llm.openRouter`

#### `services.llm.openRouter.instanceApiKey`

- Type: `string | undefined`
- Default: `undefined`
- Env: `OPENROUTER_API_KEY`
- Purpose: Instance-provided OpenRouter key (host-managed).
- Notes: Used as fallback when users don’t supply a key.

#### `services.llm.openRouter.allowUserOverride`

- Type: `boolean`
- Default: `true`
- Env: `OR3_OPENROUTER_ALLOW_USER_OVERRIDE`
- Purpose: Allows user-provided keys.
- Strict mode rule: if `false`, `instanceApiKey` must be present.

#### `services.llm.openRouter.requireUserKey`

- Type: `boolean`
- Default: `false`
- Env: `OR3_OPENROUTER_REQUIRE_USER_KEY`
- Purpose: Forces users to supply their own keys.
- Strict mode rule: cannot be `true` while `allowUserOverride` is `false`.

### `limits`

These are instance-level usage limits (mostly for SSR / hosted deployments).

#### `limits.enabled`

- Type: `boolean`
- Default: `true`
- Env: `OR3_LIMITS_ENABLED`
- Purpose: Enables rate limiting / quotas.

#### `limits.requestsPerMinute`

- Type: `number`
- Default: `20`
- Env: `OR3_REQUESTS_PER_MINUTE`
- Purpose: Per-user request limit for LLM calls.

#### `limits.maxConversations`

- Type: `number`
- Default: `0`
- Env: `OR3_MAX_CONVERSATIONS`
- Purpose: Cap on conversations per user.
- Notes: `0` means unlimited.

#### `limits.maxMessagesPerDay`

- Type: `number`
- Default: `0`
- Env: `OR3_MAX_MESSAGES_PER_DAY`
- Purpose: Daily message cap.
- Notes: `0` means unlimited.

#### `limits.storageProvider`

- Type: `'memory' | 'convex' | 'redis' | 'postgres'`
- Default:
  - `'convex'` when sync is enabled
  - otherwise `'memory'`
- Env: `OR3_LIMITS_STORAGE_PROVIDER`
- Purpose: Where rate limit counters are stored.
- Notes: use a persistent provider for production.

### `security`

#### `security.allowedOrigins`

- Type: `string[]`
- Default: `[]`
- Env: `OR3_ALLOWED_ORIGINS` (comma-separated)
- Purpose: CORS allowlist.

#### `security.forceHttps`

- Type: `boolean`
- Default: `NODE_ENV === 'production'`
- Env: `OR3_FORCE_HTTPS`
- Purpose: Redirect HTTP to HTTPS.

#### `security.proxy.trustProxy`

- Type: `boolean`
- Default: `false`
- Env: `OR3_TRUST_PROXY`
- Purpose: Trust reverse-proxy headers (`X-Forwarded-*`) for client IP/host.
- Notes: Enable this when running behind a load balancer / reverse proxy.

#### `security.proxy.forwardedForHeader`

- Type: `'x-forwarded-for' | 'x-real-ip'`
- Default: `'x-forwarded-for'`
- Env: `OR3_FORWARDED_FOR_HEADER`
- Purpose: Which header to treat as the client IP.

### `backgroundStreaming`

SSR-only background processing for AI streams.

#### `backgroundStreaming.enabled`

- Type: `boolean`
- Default: `false`
- Env: `OR3_BACKGROUND_STREAMING_ENABLED`
- Purpose: Enables server-side background streaming.

#### `backgroundStreaming.storageProvider`

- Type: `'memory' | 'convex' | 'redis'`
- Default:
  - `'convex'` when sync is enabled
  - otherwise `'memory'`
- Env: `OR3_BACKGROUND_STREAMING_PROVIDER`
- Purpose: Where background job state is stored.

#### `backgroundStreaming.maxConcurrentJobs`

- Type: `number`
- Default: `20`
- Env: `OR3_BACKGROUND_MAX_JOBS`
- Purpose: Global concurrency limit.

#### `backgroundStreaming.jobTimeoutSeconds`

- Type: `number`
- Default: `300`
- Env: `OR3_BACKGROUND_JOB_TIMEOUT`
- Purpose: Job timeout.

### `admin`

SSR-only admin controls.

#### `admin.basePath`

- Type: `string`
- Default: `"/admin"`
- Env: `OR3_ADMIN_BASE_PATH`
- Purpose: Admin route base path.

#### `admin.allowedHosts`

- Type: `string[]`
- Default: `[]`
- Env: `OR3_ADMIN_ALLOWED_HOSTS` (comma-separated)
- Purpose: Host allowlist for admin routes.

#### `admin.allowRestart`

- Type: `boolean`
- Default: `false`
- Env: `OR3_ADMIN_ALLOW_RESTART`
- Purpose: Enables restart button in admin.

#### `admin.allowRebuild`

- Type: `boolean`
- Default: `false`
- Env: `OR3_ADMIN_ALLOW_REBUILD`
- Purpose: Enables rebuild + restart in admin.

#### `admin.rebuildCommand`

- Type: `string`
- Default: `"bun run build"`
- Env: `OR3_ADMIN_REBUILD_COMMAND`
- Purpose: Command executed for rebuilds.

#### `admin.extensionMaxZipBytes`

- Type: `number`
- Default: `25 * 1024 * 1024` (25MB)
- Env: `OR3_ADMIN_EXTENSION_MAX_ZIP_BYTES`
- Purpose: Max uploaded extension zip size.

#### `admin.extensionMaxFiles`

- Type: `number`
- Default: `2000`
- Env: `OR3_ADMIN_EXTENSION_MAX_FILES`
- Purpose: Max number of files in an extension.

#### `admin.extensionMaxTotalBytes`

- Type: `number`
- Default: `200 * 1024 * 1024` (200MB)
- Env: `OR3_ADMIN_EXTENSION_MAX_TOTAL_BYTES`
- Purpose: Max unpacked extension size.

#### `admin.extensionAllowedExtensions`

- Type: `string[]`
- Default: a conservative allowlist (see `DEFAULT_OR3_CLOUD_CONFIG`)
- Env: `OR3_ADMIN_EXTENSION_ALLOWED_EXTENSIONS` (comma-separated)
- Purpose: Allowed file extensions inside extension installs.

---

## Strict Mode and Validation

`defineOr3CloudConfig()` runs in strict mode by default in production:

- strict is enabled when `NODE_ENV === 'production'` or `OR3_STRICT_CONFIG === 'true'`.
- strict mode enforces required secrets (Clerk keys, Convex URL, OpenRouter constraints).

---

## Common Config Examples

### Local-Only (Static)

Static builds do not support SSR auth/sync/storage.

```bash
SSR_AUTH_ENABLED=false

OR3_SITE_NAME="OR3"
OR3_DEFAULT_THEME="retro"
OR3_DOCUMENTS_ENABLED=true
OR3_WORKFLOWS_ENABLED=false
```

### Minimal Cloud (SSR + Auth + Sync)

```bash
SSR_AUTH_ENABLED=true
AUTH_PROVIDER=clerk
NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
NUXT_CLERK_SECRET_KEY=sk_...

OR3_SYNC_ENABLED=true
OR3_SYNC_PROVIDER=convex
VITE_CONVEX_URL=https://your-deployment.convex.cloud
```

### Hosted / Locked-Down (No User Keys)

```bash
SSR_AUTH_ENABLED=true
AUTH_PROVIDER=clerk
NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
NUXT_CLERK_SECRET_KEY=sk_...

OR3_SYNC_ENABLED=true
VITE_CONVEX_URL=https://your-deployment.convex.cloud

# Host-provided OpenRouter key, users cannot override
OPENROUTER_API_KEY=or_...
OR3_OPENROUTER_ALLOW_USER_OVERRIDE=false

# Rate limiting enabled and persisted
OR3_LIMITS_ENABLED=true
OR3_REQUESTS_PER_MINUTE=10
OR3_LIMITS_STORAGE_PROVIDER=convex

# Security hardening
OR3_ALLOWED_ORIGINS=https://chat.example.com
OR3_FORCE_HTTPS=true

# Optional strict mode even outside production
OR3_STRICT_CONFIG=true
```

---

## Related

- [Base Config](./or3-config)
- [Cloud Config](./or3-cloud-config)
- [Auth System](./auth-system)
- [Sync Layer](./sync-layer)
- [Storage Layer](./storage-layer)
- [Troubleshooting](./troubleshooting)
