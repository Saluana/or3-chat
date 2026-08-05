# OR3 Cloud Install Wizard

The OR3 Cloud install wizard provides a single guided command for configuring local-only use, SSR auth, sync, storage, and OR3 Connect.

## Quick Start

```bash
bun run or3-cloud:init
```

Direct CLI usage:

```bash
bun run scripts/cli/or3-cloud.ts init
```

When published, the same CLI is packaged with a bin entry (`or3-cloud`) so it can be executed through `bunx` or `npx`.

## What the Wizard Does

1. Creates a wizard session with defaults (recommended stack: `basic-auth + sqlite + fs`).
2. Uses template mode to decide provider flow depth:
   - `personal-local`: browser-only use with no account, remote access, sync, or server storage.
   - `preset-local`: the recommended self-hosted stack with Basic Auth + SQLite + Filesystem (email-only when Customize is off).
   - `preset-local-fast`: same stack with zero guided questions (auto credentials; review and deploy).
   - `preset-clerk-convex`: auto-applies Clerk + Convex + Convex and skips manual provider selection.
   - `custom`: keeps manual provider selection.
3. Collects provider-specific answers only for selected providers.
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

`bun start` → cloud opens the wizard with `--mode self-hosted` (recommended path, personal-local hidden). Use the **Use recommended defaults — skip questions** template (or `or3-cloud init --fast --admin-email admin@example.com`) for zero guided inputs. Fast self-hosted setup requires a real admin email and writes generated credentials to a mode-`0600` `.or3-initial-credentials` file instead of terminal output.

## Commands

### `or3-cloud init`

Interactive wizard flow.

Common flags:

- `--preset personal-local|recommended|legacy-clerk-convex`
- `--instance-dir <path>`
- `--env-file .env|.env.local`
- `--dry-run`
- `--manual`
- `--fast` (self-hosted requires `--admin-email <email>`)
- `--admin-password-file <path>` (read an automation-managed password without putting it in command history)
- `--enable-install` (feature-flagged package install execution)
- `--package-manager bun|npm`

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

### `or3-cloud presets`

Preset management:

- `presets list`
- `presets save <name> [--session <id>]`
- `presets load <name>`
- `presets delete <name>`

Secrets are excluded from preset storage by default.

### `or3-cloud deploy`

Runs deploy for the last session (or specific `--session <id>`):

- local-dev: `bun install`, optional `bunx convex dev`, `bun run dev:ssr`
- prod-build: `bun install`, `bun run build` (then run `bun run preview`)

## Environment Variables Written

The wizard writes canonical runtime env keys that OR3 already consumes:

- `AUTH_PROVIDER`
- `OR3_SYNC_ENABLED`
- `OR3_SYNC_PROVIDER`
- `OR3_STORAGE_ENABLED`
- `NUXT_PUBLIC_STORAGE_PROVIDER`
- provider-specific keys (basic-auth / sqlite / fs / clerk / convex)
- `OR3_CONNECT_*` keys when remote agent computers are enabled

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
- Sync: `sqlitePragmaJournalMode=WAL`, `sqlitePragmaSynchronous=NORMAL`, `sqliteAllowInMemory=false`, `sqliteStrict=false`, Convex self-hosted extras unset
- Storage: `fsUrlTtlSeconds=900`, `s3ForcePathStyle=false`, `s3UrlTtlSeconds=900`, `s3RequireChecksum=false`, optional S3 extras unset
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
- [Cloud Providers](./providers)
- [OR3 Cloud Config](./or3-cloud-config)
- [OR3 Connect](./or3-connect)
