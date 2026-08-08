# OR3 Cloud Source Wizard

> This is an advanced source-development path. Managed Cloud intentionally
> withholds remote Connect until its operator and staging proof are complete;
> use [Start Here](../../../docs/start-here.md) for supported beginner routes.

This page documents the repository-local wizard for contributors and advanced
custom-provider deployments. Normal local or VPS installations should use the
managed `@or3/cloud` distribution documented in `/docs/installation`.

## Quick Start

```bash
bun run setup
```

This runs `scripts/cli/or3-cloud.ts init`. In a terminal it opens the browser
wizard by default; `--ui` forces the browser wizard, `--cli` forces the
terminal wizard, and `--fast` runs a zero-question setup. Direct CLI usage:

```bash
bun run scripts/cli/or3-cloud.ts init
```

The source wizard is not the managed Cloud operator and does not perform image
based upgrades. It remains available through the application repository's
`or3-cloud` scripts.

## What the Wizard Does

1. Creates a wizard session with defaults (recommended stack: `basic-auth + sqlite + fs`).
2. Uses template mode to decide provider flow depth:
   - `personal-local`: browser-only use with no account, remote access, sync, or server storage.
   - `preset-local`: the recommended self-hosted stack with Basic Auth + SQLite + Filesystem (email-only when Customize is off).
   - legacy `preset-local-fast` sessions remain readable, but now collect the same real administrator identity as the recommended stack.
   - `preset-clerk-convex`: auto-applies Clerk + Convex + Convex and skips manual provider selection.
   - `custom`: keeps manual provider selection.
3. Collects provider-specific answers only for selected providers, including a
   SQLite runtime selector: existing local `better-sqlite3`, Bun, Turso/libSQL,
   or a preconfigured Cloudflare D1 binding.
4. Supports per-section advanced toggles with a global expert mode switch.
5. Prompts only visible fields (conditional prompts respect prior answers).
   - Auto-generated secrets (JWT, bootstrap password, FS token, admin password) stay behind advanced options
   - Safe path defaults (`./.data/...` and `<instance>/.data/or3-storage`) stay behind advanced options
   - `themesToInstall` only when `themeInstallMode=install-selected`
   - limits detail fields only when `limitsEnabled=true`
   - `forwardedForHeader` only when `trustProxy=true`
6. Validates using:
   - field-level checks (paths, secrets, URLs, cross-field rules)
   - authoritative config builders (`buildOr3ConfigFromEnv`, `buildOr3CloudConfigFromEnv`)
7. Optionally configures account-bound remote agent computers:
   - persistence inherits the selected sync provider unless explicitly overridden
   - Cloudflare account and zone IDs are discovered from the hostname when omitted
   - encryption credentials and API tokens are kept out of persisted wizard sessions and reviews
8. Shows a redacted review screen with effective defaults for hidden advanced fields.
9. Applies config by:
   - updating target env file (`.env` by default) with non-destructive merge
   - creating timestamped backup files before write (unless disabled)
   - generating `or3.providers.generated.ts` from selected providers only
10. Optionally sets Convex backend env vars for Clerk + Convex stacks.
11. Optionally runs deploy commands (`bun install`, `bun run dev:ssr` or `bun run build`).

`npm start` (or `bun start`) asks whether to run locally or use managed Cloud. Choosing Cloud runs `npx @or3/cloud init --local`, which asks once for a real administrator email and creates the supported deployment. The source wizard remains for contributors and advanced custom-provider deployments.

## Commands

### `or3-cloud init`

Interactive wizard flow.

Common flags:

- `--mode personal|self-hosted|custom` (chooses a preset; self-hosted matches `--preset recommended`)
- `--preset personal-local|recommended|legacy-clerk-convex`
- `--target dev|docker|configure`
- `--instance-dir <path>`
- `--env-file .env|.env.local`
- `--dry-run`
- `--cli` (force the terminal wizard; the default opens in your browser when a display is available)
- `--ui` / `--ui-port <port>` (open the browser wizard; `--no-open` skips auto-open)
- `--manual`
- `--fast` is an automation-only source command; self-hosted use requires `--admin-email <email>` and never invents a placeholder identity
- `--admin-password <password>` / `--admin-password-file <path>` (read an automation-managed password without putting it in command history)
- `--domain <hostname>` (public domain; sets Docker exposure to `public`)
- `--docker-exposure private|public`
- `--enable-install` (feature-flagged package install execution)
- `--strict` / `--no-backup`
- `--pm bun|npm` (also accepted as `--package-manager`)
- `--no-focused-prompts` (disable one-question-at-a-time terminal screens)

Navigation inside setup questions:

- `/back` moves to the previous visible question (or previous visible step at question boundaries)
- `/next` skips to the next visible question/step

Progress counters are dynamic:

- `Step X of Y` counts only currently visible steps
- `Question A of B` counts only currently visible fields in that step

### `or3-cloud validate`

Validates the current env file in-place.

```bash
bun run scripts/cli/or3-cloud.ts validate --env-file .env
```

### `or3-cloud doctor`

Extends `validate` with runtime health checks: provider packages installed,
generated providers file in sync, writable database and storage paths, port
availability, and Convex CLI checks. Exits with code 1 on hard failures.

```bash
bun run scripts/cli/or3-cloud.ts doctor --env-file .env
```

The `doctor` npm script (same as `bun run doctor`) runs it for the current
directory.

### `or3-cloud presets`

Preset management:

- `presets list`
- `presets save <name> [--session <id>]`
- `presets load <name>`
- `presets delete <name>`

Secrets are excluded from preset storage by default.

### `or3-cloud deploy`

Runs deploy for the last session (or specific `--session <id>`):

- local-dev: `bun install`, optional Convex scaffold init and `bunx convex dev`, `bun run dev:ssr`
- docker: `docker compose -f compose.yaml up --build -d --wait` (adds `-f compose.public.yaml` for public exposure) and probes the `/api/health?deep=true` endpoint
- configure-only: writes configuration and starts nothing
- prod-build: `bun install`, `bun run build` (then run `bun run preview`)

## Environment Variables Written

The wizard writes canonical runtime env keys that OR3 already consumes:

- `SSR_AUTH_ENABLED` (master cloud switch)
- `AUTH_PROVIDER`
- `OR3_SYNC_ENABLED`
- `OR3_SYNC_PROVIDER`
- `OR3_SQLITE_DRIVER` plus the selected runtime's path, Turso credentials, or
  D1 binding
- `OR3_STORAGE_ENABLED`
- `NUXT_PUBLIC_STORAGE_PROVIDER`
- provider-specific keys (basic-auth / sqlite / fs / clerk / convex)
- `OR3_CONNECT_*` keys when remote agent computers are enabled
- admin dashboard keys (`OR3_ADMIN_USERNAME`, `OR3_ADMIN_PASSWORD`)

Compatibility aliases are also written for forward naming cleanup support:

- `OR3_AUTH_PROVIDER`
- `OR3_CLOUD_SYNC_ENABLED`
- `OR3_CLOUD_STORAGE_ENABLED`

For the authoritative config reference, see:

- [Configuration Reference](./config-reference)

## Installation Modes

Local-only:

- Accounts: disabled
- Remote access: disabled
- Server sync/storage: disabled

Recommended default:

- Auth: `basic-auth`
- Sync: `sqlite`
- Storage: `fs`
- Remote access: optional and disabled until selected

Legacy selectable preset:

- Auth: `clerk`
- Sync: `convex`
- Storage: `convex`

## Advanced Field Defaults (when skipped)

When advanced prompts are skipped for a section, the wizard applies these defaults:

- OR3 base: `themeInstallMode=use-existing`, `themesToInstall=blank,retro`, logo/favicon unset
- Auth: `basicAuthAccessTtlSeconds=900`, `basicAuthRefreshTtlSeconds=2592000`, `basicAuthDbPath=./.data/or3-basic-auth.sqlite`
- Sync: `sqlitePragmaJournalMode=WAL`, `sqlitePragmaSynchronous=NORMAL`, `sqliteAllowInMemory=false`, `sqliteStrict=false`, Convex self-hosted extras unset. SQLite runtime selection and its required connection values stay in the core flow.
- Storage: `fsUrlTtlSeconds=900`, `s3ForcePathStyle=false`, `s3UrlTtlSeconds=900`, checksum enforcement enabled, optional S3 extras unset. Leave `OR3_STORAGE_S3_REQUIRE_CHECKSUM` unset or set it to `true`; the S3 provider rejects `false`.
- AI/Limits/Security: `openrouterAllowUserOverride=true`, `openrouterRequireUserKey=false`, `requestsPerMinute=20`, `maxConversations=0`, `maxMessagesPerDay=0`, `forwardedForHeader=x-forwarded-for`, `strictConfig=false`
- OR3 Connect: persistence inherits sync, relay is `cloudflare`, maximum computers is `3`, and Cloudflare account/zone IDs are discovered when omitted

## Convex Backend Env Separation

When Clerk + Convex is selected, the wizard keeps Convex backend env separate from OR3 `.env`:

- OR3 env file: `VITE_CONVEX_URL`, app/runtime env
- Convex backend env (set via CLI):
  - `CLERK_ISSUER_URL`
  - `OR3_ADMIN_JWT_SECRET`

## Related

- [Configuration Reference](./config-reference)
- [Environment and Provider Settings Reference](./environment-reference)
- [Cloud Providers](./providers)
- [OR3 Cloud Config](./or3-cloud-config)
- [OR3 Connect](./or3-connect)
