# OR3 Environment and Provider Settings Reference

This is the deployment-oriented reference for environment variables consumed by
`or3-chat` and its first-party provider packages. It complements the typed
configuration reference:

- [Base configuration](./or3-config) documents `config.or3.ts`.
- [Cloud configuration](./or3-cloud-config) documents `config.or3cloud.ts`.
- [Configuration reference](./config-reference) explains the resolved config
  objects and validation rules.
- The provider pages document provider-specific installation and operations.

The tables below cover runtime and deployment settings. Test, benchmark,
release-pipeline, and browser-harness variables are intentionally excluded;
they are not application configuration.

## How environment values are resolved

- Put deployment values in `.env` (or `.env.local` for local development). Keep
  server-only secrets out of `NUXT_PUBLIC_*` variables.
- `OR3_AUTH_PROVIDER` is the canonical auth-provider key; `AUTH_PROVIDER` is a
  supported compatibility alias. When both are present, the `OR3_` key wins.
- `OR3_CLOUD_SYNC_ENABLED`/`OR3_SYNC_ENABLED` and
  `OR3_CLOUD_STORAGE_ENABLED`/`OR3_STORAGE_ENABLED` are compatibility pairs.
  The `OR3_CLOUD_*` value wins when both are present.
- Most base feature flags use “enabled unless exactly `false`”. Cloud gates and
  provider safety switches document their own semantics below.
- Comma-separated values are trimmed. JSON settings must contain valid JSON;
  invalid rate-limit JSON is ignored and falls back to defaults.
- `NODE_ENV=production` enables strict cloud/provider validation. Set
  `OR3_STRICT_CONFIG=true` to enable the same validation outside production.

## Runtime and cloud gates

| Variable | Default | Purpose |
|---|---:|---|
| `NODE_ENV` | host-defined | Selects production validation and secure cookies. |
| `SSR_AUTH_ENABLED` | `false` | Enables SSR auth and the dependent server cloud surfaces. |
| `OR3_AUTH_PROVIDER` / `AUTH_PROVIDER` | `clerk` | Auth provider ID (`basic-auth`, `clerk`, or a registered custom provider). |
| `OR3_CLOUD_SYNC_ENABLED` / `OR3_SYNC_ENABLED` | enabled when auth is enabled | Enables server sync. Set either key to `false` to disable it. |
| `OR3_SYNC_PROVIDER` | `convex` | Sync backend (`sqlite`, `convex`, `firebase`, or a registered provider). |
| `OR3_CLOUD_STORAGE_ENABLED` / `OR3_STORAGE_ENABLED` | enabled when auth is enabled | Enables server storage. Set either key to `false` to disable it. |
| `NUXT_PUBLIC_STORAGE_PROVIDER` | `convex` | Storage backend (`fs`, `convex`, `s3`, or a registered provider). |
| `OR3_STRICT_CONFIG` | production-only | Enables strict configuration validation in non-production environments. |

Static builds (`bun run generate:static`) do not provide SSR auth, server
routes, or server provider storage. See [Cloud providers](./providers) for
the static/SSR boundary.

### Nuxt and prebuilt-container compatibility names

Source deployments should use the canonical names in the tables below. The
prebuilt image's entrypoint translates those values to Nuxt runtime-config
names; an explicitly supplied `NUXT_*` value wins. These names are useful when
running a prebuilt image directly, but are not required for the wizard:

| Compatibility variable | Canonical value |
|---|---|
| `NUXT_AUTH_ENABLED`, `NUXT_PUBLIC_SSR_AUTH_ENABLED` | `SSR_AUTH_ENABLED` |
| `NUXT_AUTH_PROVIDER`, `NUXT_PUBLIC_AUTH_PROVIDER` | `OR3_AUTH_PROVIDER` / `AUTH_PROVIDER` |
| `NUXT_PUBLIC_GUEST_ACCESS_ENABLED` | `OR3_GUEST_ACCESS_ENABLED` |
| `NUXT_AUTH_AUTO_PROVISION`, `NUXT_AUTH_REGISTRATION_MODE`, `NUXT_AUTH_BOOTSTRAP_EMAIL`, `NUXT_AUTH_INVITE_TOKEN_SECRET`, `NUXT_AUTH_INVITE_TOKEN_TTL_SECONDS` | matching `OR3_AUTH_*` / Basic Auth settings |
| `NUXT_SYNC_ENABLED`, `NUXT_PUBLIC_SYNC_ENABLED` | `OR3_CLOUD_SYNC_ENABLED` / `OR3_SYNC_ENABLED` |
| `NUXT_SYNC_PROVIDER`, `NUXT_PUBLIC_SYNC_PROVIDER` | `OR3_SYNC_PROVIDER` |
| `NUXT_STORAGE_ENABLED`, `NUXT_PUBLIC_STORAGE_ENABLED` | `OR3_CLOUD_STORAGE_ENABLED` / `OR3_STORAGE_ENABLED` |
| `NUXT_STORAGE_PROVIDER`, `NUXT_PUBLIC_STORAGE_PROVIDER` | `NUXT_PUBLIC_STORAGE_PROVIDER` (or Docker-only `OR3_STORAGE_PROVIDER`) |
| `NUXT_ADMIN_AUTH_USERNAME`, `NUXT_ADMIN_AUTH_PASSWORD`, `NUXT_ADMIN_AUTH_JWT_SECRET`, `NUXT_ADMIN_AUTH_JWT_EXPIRY` | matching `OR3_ADMIN_*` settings |
| `NUXT_SECURITY_FORCE_HTTPS` | `OR3_FORCE_HTTPS` (middleware override) |

Nuxt also supports runtime overrides such as `NUXT_OPENROUTER_BASE_URL`,
`NUXT_OPENROUTER_ALLOW_USER_OVERRIDE`, `NUXT_OPENROUTER_REQUIRE_USER_KEY`,
`NUXT_OPENROUTER_API_KEY`, and `NUXT_CLERK_SECRET_KEY`. Prefer the canonical
OR3/provider variables for source configuration so the resolver, wizard, and
doctor see the same values.

## Base application settings

These values are read by `config.or3.ts` and work in static and SSR builds.

| Variable | Default | Purpose |
|---|---:|---|
| `OR3_SITE_NAME` | `OR3` | Product name shown in the UI and metadata. |
| `OR3_SITE_DESCRIPTION` | empty | Metadata description. |
| `OR3_LOGO_URL` | empty | Logo URL/path. |
| `OR3_FAVICON_URL` | empty | Favicon URL/path. |
| `OR3_DEFAULT_THEME` | `blank` | Default theme ID. |
| `OR3_DISABLED_THEMES` | empty | Comma-separated theme IDs hidden from users. |
| `OR3_WORKFLOWS_ENABLED` | enabled | Master workflow toggle. |
| `OR3_WORKFLOWS_EDITOR` | enabled | Workflow editor UI. |
| `OR3_WORKFLOWS_SLASH_COMMANDS` | enabled | Workflow slash commands. |
| `OR3_WORKFLOWS_EXECUTION` | enabled | Workflow execution. |
| `OR3_DOCUMENTS_ENABLED` | enabled | Document editing. |
| `OR3_BACKUP_ENABLED` | enabled | Workspace backup UI. |
| `OR3_MENTIONS_ENABLED` | enabled | Mentions system. |
| `OR3_MENTIONS_DOCUMENTS` | enabled | Document mentions. |
| `OR3_MENTIONS_CONVERSATIONS` | enabled | Conversation mentions. |
| `OR3_DASHBOARD_ENABLED` | enabled | Dashboard UI. |
| `OR3_WORKSPACE_TABS_ENABLED` | enabled | Workspace tab/split UI. |
| `OR3_MAX_FILE_SIZE_BYTES` | `20 MiB` | Maximum local upload size. |
| `OR3_MAX_CLOUD_FILE_SIZE_BYTES` | `100 MiB` | Maximum cloud upload size. |
| `OR3_MAX_FILES_PER_MESSAGE` | `10` | Maximum attachments per message. |
| `OR3_LOCAL_STORAGE_QUOTA_MB` | unset | Browser storage warning threshold. |
| `OR3_DEFAULT_PANE_COUNT` | `1` | Initial pane count. |
| `OR3_MAX_PANES` | `4` | Maximum pane count. |
| `OR3_SIDEBAR_COLLAPSED` | `false` | Collapse the sidebar by default. |
| `OR3_TERMS_URL` | empty | Terms-of-service link. |
| `OR3_PRIVACY_URL` | empty | Privacy-policy link. |

## Auth policy and providers

### Auth policy

| Variable | Default | Purpose |
|---|---:|---|
| `OR3_GUEST_ACCESS_ENABLED` | `false` | Allow unauthenticated guest access where supported. |
| `OR3_AUTH_AUTO_PROVISION` | `true` | Legacy registration switch. Prefer `OR3_AUTH_REGISTRATION_MODE` for new deployments. |
| `OR3_AUTH_REGISTRATION_MODE` | derived | `open`, `invite_only`, or `disabled`; when unset, `OR3_AUTH_AUTO_PROVISION=false` maps to `disabled`, otherwise `open`. |
| `OR3_AUTH_INVITE_TOKEN_SECRET` | unset | HMAC secret required for `invite_only` registration. |
| `OR3_AUTH_INVITE_TOKEN_TTL_SECONDS` | `604800` | Default invite-token lifetime. |
| `OR3_SESSION_PROVISIONING_FAILURE` | `throw` | Session provisioning failure mode: `throw`, `unauthenticated`, or `service-unavailable`. |
| `OR3_AUTH_LOCK_PAGE_ENABLED` | `false` | Redirect signed-out shell visitors to `/welcome`. |
| `OR3_AUTH_LOCK_PAGE_ADAPTER` | `default` | Registered lock-page adapter ID. |

### Clerk (`or3-provider-clerk`)

| Variable | Required | Purpose |
|---|---:|---|
| `NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | yes | Client-side Clerk publishable key. |
| `NUXT_CLERK_SECRET_KEY` | yes | Server-only Clerk secret key. |

Use `AUTH_PROVIDER=clerk` (or `OR3_AUTH_PROVIDER=clerk`) and install
`or3-provider-clerk`.

### Basic Auth (`or3-provider-basic-auth`)

| Variable | Default | Purpose |
|---|---:|---|
| `OR3_BASIC_AUTH_JWT_SECRET` | unset | Signing secret; required when Basic Auth is active. |
| `OR3_BASIC_AUTH_REFRESH_SECRET` | unset | Refresh-token signing secret; the wizard copies the JWT secret when no separate value is entered. |
| `OR3_BASIC_AUTH_ACCESS_TTL_SECONDS` | `900` | Access-token lifetime. |
| `OR3_BASIC_AUTH_REFRESH_TTL_SECONDS` | `2592000` | Refresh-token lifetime. |
| `OR3_BASIC_AUTH_ROTATION_GRACE_MS` | `30000` | Grace period for a just-rotated refresh token. |
| `OR3_BASIC_AUTH_DB_PATH` | `./.data/or3-basic-auth.sqlite` | Provider-owned account/session database. |
| `OR3_BASIC_AUTH_BOOTSTRAP_EMAIL` | unset | Initial administrator email. Set with the password. |
| `OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD` | unset | Initial administrator password. Set with the email. |
| `OR3_BASIC_AUTH_ALLOW_INSECURE_DEV` | `false` | Non-production escape hatch for missing secrets; never use in production. |
| `OR3_BASIC_AUTH_RATE_LIMIT_BACKEND` | `sqlite` | Set to `memory` only for single-process development; it is unsafe for clustered deployments. |

Use `AUTH_PROVIDER=basic-auth` and install `or3-provider-basic-auth`. Strict
production validation requires both JWT and refresh secrets.

### Convex (`or3-provider-convex`)

| Variable | Scope | Purpose |
|---|---|---|
| `VITE_CONVEX_URL` | OR3 server/client | Convex deployment URL used by sync, storage, and Connect. |
| `CONVEX_SELF_HOSTED_ADMIN_KEY` | OR3 server | Server/deploy key used by internal Convex operations. |
| `CONVEX_SELF_HOSTED_URL` | Convex/self-hosted deployments | Self-hosted Convex URL when the backend requires it. OR3 still resolves the public URL from `VITE_CONVEX_URL`. |
| `VITE_CONVEX_SITE_URL` | Convex auth deployments | Optional Convex site URL written by the wizard for self-hosted/auth setups. |
| `OR3_CONVEX_ALLOW_INSECURE_HTTP` | `false` | Development-only opt-in for an `http://` Convex URL. HTTPS is required otherwise. |
| `CLERK_ISSUER_URL` | Convex backend | Clerk issuer URL consumed by `convex/auth.config.ts`. |
| `OR3_ADMIN_JWT_SECRET` | OR3 + Convex backend | Shared secret for the server-to-Convex admin bridge. |

`CLERK_ISSUER_URL` and the Convex-side `OR3_ADMIN_JWT_SECRET` are set with the
Convex CLI, not in the OR3 application `.env` when using the wizard.

## Sync providers

### SQLite (`or3-provider-sqlite`)

The existing `better-sqlite3` local-file path remains the default. Set
`OR3_SQLITE_DRIVER` only when selecting another runtime.

| Variable | Applies to | Default | Purpose |
|---|---|---:|---|
| `OR3_SQLITE_DRIVER` | all SQLite runtimes | `better-sqlite3` | `better-sqlite3`, `bun`, `turso`, or `d1`. |
| `OR3_SQLITE_DB_PATH` | local Node/Bun | unset outside tests | Persistent database path. Required unless ephemeral in-memory mode is explicitly allowed. |
| `OR3_SQLITE_PRAGMA_JOURNAL_MODE` | local Node/Bun | `WAL` | SQLite journal mode. |
| `OR3_SQLITE_PRAGMA_SYNCHRONOUS` | local Node/Bun | `NORMAL` | SQLite synchronous setting. |
| `OR3_SQLITE_ALLOW_IN_MEMORY` | local Node/Bun | `false` | Permit `:memory:` outside tests; data is lost on restart. |
| `OR3_SQLITE_STRICT` | local Node/Bun | `false` | Reject in-memory SQLite configuration. |
| `OR3_SQLITE_TURSO_URL` | Turso/libSQL | unset | Turso/libSQL database URL. |
| `OR3_SQLITE_TURSO_AUTH_TOKEN` | Turso/libSQL | unset | Server-only Turso auth token. |
| `OR3_SQLITE_D1_BINDING` | Cloudflare D1 | `DB` | Name of the D1 binding in the Worker environment. |

Turso adds the `libsql` dependency. Bun uses `bun:sqlite`; D1 uses the Worker
binding and must run in a Workers request context. See
[SQLite provider setup](./provider-sqlite) for runtime limitations.

## Storage providers

### Shared storage settings

| Variable | Default | Purpose |
|---|---:|---|
| `OR3_STORAGE_ALLOWED_MIME_TYPES` | built-in image/PDF/text list | Comma-separated upload MIME allowlist. |
| `OR3_STORAGE_WORKSPACE_QUOTA_BYTES` | unset | Per-workspace storage quota. |
| `OR3_STORAGE_GC_RETENTION_SECONDS` | `2592000` | Default retention window for storage GC. |
| `OR3_STORAGE_GC_COOLDOWN_MS` | `60000` | Minimum delay between manual GC runs. |

### Filesystem (`or3-provider-fs`)

| Variable | Default | Purpose |
|---|---:|---|
| `OR3_STORAGE_FS_ROOT` | unset | Absolute persistent storage root; required when `fs` is selected. |
| `OR3_STORAGE_FS_TOKEN_SECRET` | unset | Server-only signing secret; required and 32+ characters are recommended. |
| `OR3_STORAGE_FS_URL_TTL_SECONDS` | `900` | Presigned URL lifetime, from 1 to 3600 seconds. |

### S3-compatible (`or3-provider-s3`)

| Variable | Default | Purpose |
|---|---:|---|
| `OR3_STORAGE_S3_ENDPOINT` | provider default | S3-compatible endpoint; HTTPS is required unless the development override is set. |
| `OR3_STORAGE_S3_ALLOW_INSECURE_HTTP` | `false` | Development-only opt-in for an HTTP endpoint. |
| `OR3_STORAGE_S3_REGION` | unset | Required S3 region. |
| `OR3_STORAGE_S3_BUCKET` | unset | Required bucket name. |
| `OR3_STORAGE_S3_ACCESS_KEY_ID` | unset | Required server-only access key. |
| `OR3_STORAGE_S3_SECRET_ACCESS_KEY` | unset | Required server-only secret key. |
| `OR3_STORAGE_S3_SESSION_TOKEN` | unset | Optional temporary-credential session token. |
| `OR3_STORAGE_S3_FORCE_PATH_STYLE` | `false` | Use path-style addressing for MinIO and some compatible hosts. |
| `OR3_STORAGE_S3_KEY_PREFIX` | empty | Optional object-key prefix. |
| `OR3_STORAGE_S3_URL_TTL_SECONDS` | `900` | Presigned URL lifetime, from 1 to 3600 seconds. |
| `OR3_STORAGE_S3_REQUIRE_CHECKSUM` | enforced | Must be omitted or true; `false` is rejected because checksum enforcement is required. |

### Convex storage

Select `NUXT_PUBLIC_STORAGE_PROVIDER=convex` and provide the Convex settings
listed above. The S3 and filesystem variables are ignored when Convex storage
is selected.

## OpenRouter, limits, and background jobs

| Variable | Default | Purpose |
|---|---:|---|
| `OPENROUTER_API_KEY` | unset | Instance-managed OpenRouter key. |
| `OR3_OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | OpenRouter-compatible API base URL. |
| `OR3_OPENROUTER_ALLOW_USER_OVERRIDE` | `true` | Allow users to provide their own keys. |
| `OR3_OPENROUTER_REQUIRE_USER_KEY` | `false` | Require a user-provided key. |
| `OR3_LIMITS_ENABLED` | `true` | Enable core rate limits and quotas. |
| `OR3_REQUESTS_PER_MINUTE` | `20` | Per-user LLM request limit. |
| `OR3_MAX_CONVERSATIONS` | `0` | Conversation cap; `0` means unlimited. |
| `OR3_MAX_MESSAGES_PER_DAY` | `0` | Daily message cap; `0` means unlimited. |
| `OR3_LIMITS_STORAGE_PROVIDER` | sync provider or `memory` | Backend for rate-limit counters. |
| `OR3_RATE_LIMIT_OVERRIDES_JSON` | `{}` | JSON map of per-operation `{windowMs,maxRequests}` overrides. |
| `DISABLE_RATE_LIMIT` | unset | Development switch. Set to `1` to disable rate limiting. Admin login limits honor it always; sync push limits honor it only outside production. |
| `OR3_BACKGROUND_STREAMING_ENABLED` | `false` | Enable SSR background AI jobs. |
| `OR3_BACKGROUND_STREAMING_PROVIDER` | sync provider or `memory` | Background job state backend. |
| `OR3_BACKGROUND_MAX_JOBS` | `20` | Global concurrent jobs. |
| `OR3_BACKGROUND_MAX_JOBS_PER_USER` | `5` | Per-user concurrent jobs. |
| `OR3_BACKGROUND_JOB_TIMEOUT` | `300` | Job timeout in seconds. |

OpenRouter's browser PKCE flow has three optional public settings:

| Variable | Default | Purpose |
|---|---:|---|
| `NUXT_PUBLIC_OPENROUTER_REDIRECT_URI` | current origin + `/openrouter-callback` | Explicit callback URL for public HTTPS/tunnel deployments. |
| `NUXT_PUBLIC_OPENROUTER_CLIENT_ID` | empty | Registered OpenRouter OAuth client ID. |
| `NUXT_PUBLIC_OPENROUTER_AUTH_URL` | `https://openrouter.ai/auth` | OpenRouter-compatible authorization URL. |

These values are intentionally public. Do not put an OpenRouter API key in a
`NUXT_PUBLIC_*` variable.

## Security and webhooks

### HTTP/security

| Variable | Default | Purpose |
|---|---:|---|
| `OR3_ALLOWED_ORIGINS` | empty | Comma-separated CORS allowlist. |
| `OR3_FORCE_HTTPS` | true in production | Redirect HTTP requests to HTTPS. |
| `OR3_TRUST_PROXY` | `false` | Trust reverse-proxy headers; enable only behind a header-sanitizing proxy. |
| `OR3_FORWARDED_FOR_HEADER` | `x-forwarded-for` | Client-IP header (`x-forwarded-for` or `x-real-ip`). |

### Webhooks

Webhooks are enabled when auth is enabled unless explicitly disabled. The
encryption key is required before webhook creation.

| Variable | Default | Purpose |
|---|---:|---|
| `OR3_WEBHOOKS_ENABLED` | enabled with auth | Enable/disable webhook delivery. |
| `OR3_WEBHOOKS_ENCRYPTION_KEY` | falls back to admin JWT secret | Encrypt webhook signing secrets at rest. |
| `OR3_WEBHOOKS_MAX_PER_USER` | `20` | Per-user webhook limit. |
| `OR3_WEBHOOKS_ADMIN_MAX` | `50` | Admin webhook limit. |
| `OR3_WEBHOOKS_RATE_LIMIT_PER_MINUTE` | `120` | Delivery rate limit. |
| `OR3_WEBHOOKS_DELIVERY_TIMEOUT_MS` | `10000` | HTTP delivery timeout. |
| `OR3_WEBHOOKS_BLOCK_PRIVATE_IPS` | `false` | Block private/internal target addresses. Enable for stricter SSRF policy. |
| `OR3_WEBHOOKS_MAX_RETRY_HOURS` | `1` | Retry horizon. |
| `OR3_WEBHOOKS_LOG_RETENTION_HOURS` | `72` | Delivery-log retention. |

## Admin, plugins, and persistent paths

### Admin dashboard and credentials

| Variable | Default | Purpose |
|---|---:|---|
| `OR3_ADMIN_USERNAME` | unset | Enables the deployment admin account when paired with a password. |
| `OR3_ADMIN_PASSWORD` | unset | Deployment admin password. |
| `OR3_ADMIN_JWT_SECRET` | generated in development | Admin JWT secret; set explicitly in production. |
| `OR3_ADMIN_JWT_EXPIRY` | `24h` | Admin session/JWT expiry. |
| `OR3_ADMIN_DELETED_WORKSPACE_RETENTION_DAYS` | unset | Retention for soft-deleted workspaces. |
| `OR3_ADMIN_BASE_PATH` | `/admin` | Admin route prefix. |
| `OR3_ADMIN_ALLOWED_HOSTS` | empty | Comma-separated admin host allowlist. |
| `OR3_ADMIN_ALLOW_RESTART` | `false` | Allow admin-triggered restart. |
| `OR3_ADMIN_ALLOW_REBUILD` | `false` | Allow admin-triggered rebuild and restart. |
| `OR3_ADMIN_REBUILD_COMMAND` | `bun run build` | Command used for admin rebuilds. |
| `OR3_ADMIN_DATA_DIR` | `.data` | Persistent location for admin credentials and generated JWT secret. |
| `OR3_SHUTDOWN_TIMEOUT_MS` | `15000` | Graceful-shutdown request-drain timeout. |

### Plugin/runtime controls

These are startup or deployment controls. Restart after changing them.

| Variable | Default | Purpose |
|---|---:|---|
| `OR3_DISABLE_NON_CORE_PLUGINS` | `false` | Safe mode that skips non-core plugin discovery/routes. |
| `OR3_PLUGIN_ZIP_INSTALL_ENABLED` | `true` | Enable ZIP extension installation. |
| `OR3_PLUGIN_RUNTIME_SHADOW_ENABLED` | `true` | Enable the read-only plugin runtime observer. |
| `OR3_PLUGIN_RUNTIME_V2_ENABLED` | `true` | Select the generation-safe plugin manager. |
| `OR3_PLUGIN_RUNTIME_V2_WORKSPACE_IDS` | empty | Comma-separated V2 workspace canary allowlist. |
| `OR3_PLUGIN_CONTRIBUTION_V2_SURFACES` | empty | Comma-separated migrated contribution surfaces. |
| `OR3_HOOK_ENGINE_V2_ENABLED` | `false` | Select Hook Runtime V2. |
| `OR3_PLUGIN_MODULE_LOADER_V2_ENABLED` | `false` | Enable immutable package candidate/promotion flow. |
| `OR3_PLUGIN_MODULE_LOADER_V2_WORKSPACE_IDS` | empty | V2 module-loader workspace canary allowlist. |
| `OR3_PLUGIN_ISOLATION_ENABLED` | `false` | Enable supported isolated plugin surfaces. |
| `OR3_ADMIN_EXTENSION_MAX_ZIP_BYTES` | `25 MiB` | Maximum uploaded extension archive size. |
| `OR3_ADMIN_EXTENSION_MAX_FILES` | `2000` | Maximum files in an extension archive. |
| `OR3_ADMIN_EXTENSION_MAX_TOTAL_BYTES` | `200 MiB` | Maximum unpacked extension size. |
| `OR3_ADMIN_EXTENSION_ALLOWED_EXTENSIONS` | built-in list | Comma-separated extension suffix allowlist. |
| `OR3_EXTENSIONS_ROOT` | `./extensions` | Persistent root for installed extensions. |

## OR3 Connect (advanced/self-hosted)

Managed Cloud currently withholds the remote Connect capability. These values
are for explicitly configured source/self-hosted deployments.

| Variable | Default | Purpose |
|---|---:|---|
| `OR3_CONNECT_ENABLED` | `false` | Enable remote-computer persistence and relay integration. |
| `OR3_CONNECT_PROVIDER` | sync provider | Persistence provider (`sqlite` or `convex`). |
| `OR3_CONNECT_RELAY_PROVIDER` | `cloudflare` | Relay provider. |
| `OR3_CONNECT_PUBLIC_URL` | unset | HTTPS URL the connecting computer can open. |
| `OR3_CONNECT_ENCRYPTION_KEY` | unset | At least 32 random characters; encrypts Connect credentials. |
| `OR3_CONNECT_MAX_COMPUTERS` | `3` | Per-account connected-computer limit. |
| `OR3_CONNECT_CLOUDFLARE_ACCOUNT_ID` | discovered | Optional Cloudflare account ID. |
| `OR3_CONNECT_CLOUDFLARE_ZONE_ID` | discovered | Optional Cloudflare zone ID. |
| `OR3_CONNECT_CLOUDFLARE_API_TOKEN` | unset | Server-only Tunnel/DNS API token. |
| `OR3_CONNECT_HOSTNAME_SUFFIX` | discovered | Hostname suffix used for per-computer tunnels. |
| `OR3_CONNECT_CLOUDFLARE_VALIDATION_ATTESTATION` | unset | Signed wizard verification result for Cloudflare permissions. |

See [OR3 Connect](./or3-connect) before enabling this feature.

## Wizard and operator tooling

| Variable | Scope | Purpose |
|---|---|---|
| `OR3_CLOUD_WIZARD_HOME` | source wizard CLI | Overrides the home directory used for wizard sessions/presets. |
| `OR3_WIZARD_UI_ENABLED` | wizard UI process | Enables the browser wizard UI; disable for production runtime processes. |
| `OR3_WIZARD_UI_TOKEN` | wizard UI process | Token required by the wizard UI API. |
| `OR3_WIZARD_ENABLE_INSTALL` | source wizard CLI | Set to `1` to allow the wizard to execute dependency installation. |

The wizard writes only selected provider settings, removes stale values from
the selected provider family, redacts secrets in reviews, and preserves the
existing `better-sqlite3` default. See [OR3 Cloud Wizard](./or3-cloud-wizard).

## Managed `@or3/cloud` deployment metadata

The managed operator stores these values in its deployment directory. They are
operator-managed metadata, not application provider settings; prefer the
`npx @or3/cloud` commands over editing them by hand.

| Variable | Purpose |
|---|---|
| `OR3_VERSION` | Exact OR3 release recorded for the deployment. |
| `OR3_IMAGE` | Immutable container image selected for that release. |
| `OR3_COMPOSE_PROJECT` | Docker Compose project name. |
| `OR3_VOLUME_NAME` | Named volume containing `/data` (auth, SQLite, and files). |
| `OR3_PORT` | Loopback host port; defaults to `3000`. |
| `OR3_PUBLIC_DOMAIN` | Public hostname used by the Caddy profile; local mode uses `localhost`. |
| `OR3_CADDY_DATA_VOLUME` | Caddy certificate/data volume in public mode. |
| `OR3_CADDY_CONFIG_VOLUME` | Caddy configuration volume in public mode. |

`OR3_CLOUD_SKIP_PULL=true` is a recovery/development override and should not
be used for ordinary updates. The managed profile deliberately fixes its
provider stack to Basic Auth + SQLite + filesystem; use the source wizard for
Clerk, Convex, S3, Turso, Bun, D1, or custom provider layouts.

## Common deployment profiles

### Basic Auth + SQLite + filesystem

```bash
SSR_AUTH_ENABLED=true
AUTH_PROVIDER=basic-auth
OR3_SYNC_ENABLED=true
OR3_SYNC_PROVIDER=sqlite
OR3_SQLITE_DB_PATH=/srv/or3/.data/or3-sync.sqlite
OR3_STORAGE_ENABLED=true
NUXT_PUBLIC_STORAGE_PROVIDER=fs
OR3_STORAGE_FS_ROOT=/srv/or3/.data/storage
OR3_STORAGE_FS_TOKEN_SECRET=replace-with-a-long-random-secret
OR3_BASIC_AUTH_JWT_SECRET=replace-with-a-long-random-secret
OR3_BASIC_AUTH_REFRESH_SECRET=replace-with-a-different-long-random-secret
OR3_BASIC_AUTH_BOOTSTRAP_EMAIL=admin@example.com
OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD=replace-with-a-strong-password
```

### Clerk + Convex

```bash
SSR_AUTH_ENABLED=true
AUTH_PROVIDER=clerk
OR3_SYNC_ENABLED=true
OR3_SYNC_PROVIDER=convex
OR3_STORAGE_ENABLED=true
NUXT_PUBLIC_STORAGE_PROVIDER=convex
NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
NUXT_CLERK_SECRET_KEY=sk_...
VITE_CONVEX_URL=https://<deployment>.convex.cloud
CONVEX_SELF_HOSTED_ADMIN_KEY=...
```

### Turso SQLite

```bash
SSR_AUTH_ENABLED=true
AUTH_PROVIDER=clerk
OR3_SYNC_ENABLED=true
OR3_SYNC_PROVIDER=sqlite
OR3_SQLITE_DRIVER=turso
OR3_SQLITE_TURSO_URL=libsql://your-database.turso.io
OR3_SQLITE_TURSO_AUTH_TOKEN=...
```

### Cloudflare D1

```bash
OR3_SQLITE_DRIVER=d1
OR3_SQLITE_D1_BINDING=DB
```

D1 also needs a Workers-compatible auth/storage combination and a Worker
binding named `DB` (or the name supplied in `OR3_SQLITE_D1_BINDING`).

## Secret handling checklist

- Never commit `.env`, `.env.local`, provider tokens, or generated admin data.
- Keep `NUXT_PUBLIC_*` values limited to values intended for the browser.
- Use separate secrets for auth, admin, webhooks, storage, and Connect where
  practical.
- Restart after changing startup-only provider or plugin settings.
