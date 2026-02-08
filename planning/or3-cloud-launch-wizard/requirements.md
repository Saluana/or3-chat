# requirements.md

artifact_id: 2d4e0a4a-19e9-4be0-99c8-f562605a1959

## Overview

We want a **wizard-style “create an OR3 Cloud instance” experience**, but we will build it in this order:

1. **API (first)**: a stable, typed wizard API that can drive any UI.
2. **CLI**: an interactive terminal wizard that uses the API.
3. **Web wizard**: out of scope for this phase.

The wizard’s job is to **collect configuration**, **validate it**, **write it** (env/config), and **start/deploy** an OR3 Cloud (SSR) instance of OR3 Chat. The flow must be straightforward and non-annoying, with great defaults and clear explanations.

The wizard must align with the existing configuration model:

- Base config is env-driven via `config.or3.ts`.
- Cloud config is env-driven via `config.or3cloud.ts` and validated by `defineOr3CloudConfig()`.
- Cloud features are gated by `SSR_AUTH_ENABLED=true`.

## Users / Roles

- **Instance Operator**: a developer/admin who wants to launch an OR3 Cloud instance for themselves, a team, or customers.
- **Future Web User** (out of scope): will later use a web wizard driven by the same API.

## Requirements

### 1. Wizard session lifecycle

1.1 As an Instance Operator, I want to start a wizard session that guides me step-by-step, so that I can complete setup without reading docs.

- WHEN I start the wizard THEN it SHALL create a new session with a unique id.
- WHEN a session is created THEN it SHALL return the first step with defaults pre-filled.
- WHEN I request the current session state THEN it SHALL return the answers collected so far.
- IF I abandon the wizard THEN the session SHALL be discardable without writing anything.

1.2 As an Instance Operator, I want to resume a wizard session, so that I can continue later.

- WHEN I resume a saved session THEN it SHALL restore the step position and collected answers.
- IF a session contains secrets THEN the system SHALL support “resume without secrets” (re-prompt) mode.

### 2. UX: prompts, defaults, and inputs

2.1 As an Instance Operator, I want the wizard to feel effortless, so that setup doesn’t feel like a chore.

- WHEN the wizard asks a question THEN it SHALL provide a recommended default.
- WHEN a question is boolean THEN the CLI SHALL accept `y`/`n` and Enter for default.
- WHEN an answer is invalid THEN the wizard SHALL explain what is wrong and how to fix it.
- WHEN an answer is optional THEN the wizard SHALL allow skipping without penalties.

2.2 As an Instance Operator, I want a “review screen” before writing files, so that I can confirm I didn’t make a mistake.

- WHEN I reach the review step THEN it SHALL display a redacted summary (no secrets).
- WHEN I confirm the review THEN the wizard SHALL proceed to apply/write steps.
- IF I do not confirm THEN the wizard SHALL allow me to edit prior answers.

2.3 As an Instance Operator, I want to choose which providers to use (auth, sync, storage), so that the setup matches my deployment.

- WHEN the wizard reaches provider selection THEN it SHALL ask separately for auth, db sync, and storage providers.
- WHEN a provider is selected THEN the wizard SHALL only ask the required questions for that provider.
- WHEN a provider is not yet implemented THEN it SHALL not appear as a selectable option.
- WHEN new providers are added in the future THEN the wizard SHALL be able to surface them without redesigning the flow.

### 3. Configuration coverage (what the wizard must set)

3.1 As an Instance Operator, I want the wizard to configure OR3 Cloud correctly, so that SSR auth + sync + storage work.

- WHEN I enable OR3 Cloud THEN the wizard SHALL set `SSR_AUTH_ENABLED=true`.
- WHEN I select an auth provider THEN the wizard SHALL write `AUTH_PROVIDER=<id>` (default `basic-auth`).
- WHEN auth provider is Basic Auth THEN the wizard SHALL collect:
  - `OR3_BASIC_AUTH_JWT_SECRET`
- WHEN auth provider is Basic Auth THEN the wizard SHOULD support collecting:
  - `OR3_BASIC_AUTH_REFRESH_SECRET` (optional)
  - `OR3_BASIC_AUTH_ACCESS_TTL_SECONDS` (optional)
  - `OR3_BASIC_AUTH_REFRESH_TTL_SECONDS` (optional)
- WHEN auth provider is Clerk (legacy option) THEN the wizard SHALL collect:
  - `NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
  - `NUXT_CLERK_SECRET_KEY`
- WHEN I choose whether sync is enabled THEN the wizard SHALL write `OR3_SYNC_ENABLED=true|false`.
- WHEN I select a sync provider THEN the wizard SHALL write `OR3_SYNC_PROVIDER=<id>` (default `sqlite`).
- WHEN sync provider is SQLite THEN the wizard SHALL collect:
  - `OR3_SQLITE_DB_PATH`
- WHEN sync provider is SQLite THEN the wizard SHOULD support collecting:
  - `OR3_SQLITE_PRAGMA_JOURNAL_MODE` (optional)
  - `OR3_SQLITE_PRAGMA_SYNCHRONOUS` (optional)
- WHEN sync provider is Convex THEN the wizard SHALL collect:
  - `VITE_CONVEX_URL`
- WHEN using Convex AND I am self-hosting THEN the wizard SHOULD support collecting `CONVEX_SELF_HOSTED_ADMIN_KEY` (optional; used for server-side admin access).
- WHEN I choose whether storage is enabled THEN the wizard SHALL write `OR3_STORAGE_ENABLED=true|false`.
- WHEN I select a storage provider THEN the wizard SHALL write `NUXT_PUBLIC_STORAGE_PROVIDER=<id>` (default `fs`).
- WHEN storage provider is FS THEN the wizard SHALL collect:
  - `OR3_STORAGE_FS_ROOT`
  - `OR3_STORAGE_FS_TOKEN_SECRET`
- WHEN storage provider is FS THEN the wizard SHOULD support collecting:
  - `OR3_STORAGE_FS_URL_TTL_SECONDS` (optional)
- WHEN storage provider is Convex THEN the wizard SHALL not require extra env beyond the Convex URL.
- WHEN Convex + Clerk are used (legacy preset or mixed stack) THEN the wizard SHALL guide/setup Convex env vars:
  - `CLERK_ISSUER_URL`
  - `OR3_ADMIN_JWT_SECRET`

3.1.1 As an Instance Operator, I want fast-start presets for common stacks, so that setup is quick without losing compatibility.

- WHEN I start a new SSR wizard flow THEN the default recommended preset SHALL be:
  - Auth `basic-auth`
  - Sync `sqlite`
  - Storage `fs`
- WHEN I choose presets THEN the wizard SHALL keep a legacy preset option:
  - Auth `clerk`
  - Sync `convex`
  - Storage `convex`
- WHEN apply writes provider modules THEN it SHALL include only module IDs required by the selected providers.

3.1.2 As an Instance Operator, I want the wizard to clearly separate “OR3 env vars” vs “Convex env vars”, so that I don’t put secrets in the wrong place.

- WHEN the wizard presents a review screen THEN it SHALL label each value as either:
  - “OR3 `.env`” (Nuxt/OR3 runtime), or
  - “Convex backend env” (set via `bunx convex env set ...`)

3.2 As an Instance Operator, I want the wizard to configure base OR3 settings, so that branding and feature toggles are correct.

- WHEN I configure branding THEN the wizard SHALL support `OR3_SITE_NAME`, optional logo/favicon, and `OR3_DEFAULT_THEME`.
- WHEN I configure feature toggles THEN the wizard SHALL support the main toggles (workflows/documents/backup/mentions/dashboard).

3.2.1 As an Instance Operator, I want to choose which themes to install and which theme is the default, so that the instance feels right.

- WHEN the wizard asks about themes THEN it SHALL offer the built-in themes (at least `blank` and `retro`).
- WHEN the user chooses “install all” THEN the wizard SHALL install all available themes.
- WHEN the user chooses a default theme THEN the wizard SHALL set `OR3_DEFAULT_THEME` accordingly.
- WHEN theme installation is not supported by the current version THEN the wizard SHALL still allow selecting the default theme (and warn if the theme isn’t available).

3.3 As an Instance Operator, I want optional cloud settings exposed in a friendly way, so that I can tailor my instance without digging in config.

- WHEN I configure OpenRouter hosting THEN the wizard SHALL support:
  - `OPENROUTER_API_KEY` (optional)
  - `OR3_OPENROUTER_ALLOW_USER_OVERRIDE` (default true)
  - `OR3_OPENROUTER_REQUIRE_USER_KEY` (default false)
- WHEN I configure limits THEN the wizard SHALL support:
  - `OR3_REQUESTS_PER_MINUTE` (default 20)
  - `OR3_MAX_CONVERSATIONS` (default 0)
  - `OR3_MAX_MESSAGES_PER_DAY` (default 0)
  - `OR3_LIMITS_STORAGE_PROVIDER` (default auto)
- WHEN I configure security THEN the wizard SHALL support:
  - `OR3_ALLOWED_ORIGINS` (comma-separated)
  - `OR3_FORCE_HTTPS` (default true in prod)
  - proxy/trust settings if relevant (`OR3_TRUST_PROXY`, `OR3_FORWARDED_FOR_HEADER`)

### 4. Validation (correctness and safety)

4.1 As an Instance Operator, I want the wizard to validate configuration before writing, so that I don’t end up with a broken deployment.

- WHEN validation runs THEN it SHALL validate using the same rules as `defineOr3CloudConfig()`.
- WHEN the wizard is targeting production THEN validation SHALL run in “strict mode” equivalent.
- IF required variables are missing THEN the wizard SHALL explain exactly what is missing.

4.2 As an Instance Operator, I want safe handling of secrets, so that keys are not leaked.

- WHEN the wizard prints summaries THEN it SHALL redact secrets.
- WHEN the wizard logs errors THEN it SHALL avoid printing full secret values.
- WHEN saving presets THEN it SHALL not store secrets by default.

### 5. Writing configuration (files + env)

5.1 As an Instance Operator, I want the wizard to write configuration in the standard OR3 way, so that deployments are predictable.

- WHEN applying configuration THEN it SHALL write environment variables to a chosen env file (e.g. `.env`, `.env.local`) in the target instance directory.
- WHEN applying configuration THEN it SHALL not require editing `config.or3.ts` or `config.or3cloud.ts`.
- WHEN applying configuration THEN it SHALL write/update `or3.providers.generated.ts` from selected provider IDs only (for example `or3-provider-basic-auth/nuxt`, `or3-provider-sqlite/nuxt`, `or3-provider-fs/nuxt`).
- WHEN writing an env file THEN it SHALL preserve unrelated existing variables (non-destructive merge).
- WHEN choosing an env file THEN it SHOULD default to `.env` for compatibility with existing OR3 tooling (e.g. admin config writer); if `.env.local` is used, the wizard SHOULD warn about any known limitations.
- WHEN updating an existing env file THEN it SHOULD create a timestamped backup before writing, so that mistakes are reversible.

5.2 As an Instance Operator, I want a portable configuration output, so that I can deploy on any host.

- WHEN apply completes THEN it SHALL be possible to run the instance using standard Bun/Nuxt commands.

5.3 As an Instance Operator, I want the CLI to install required provider/theme dependencies as needed, so that setup is fully guided.

- WHEN a selected provider requires additional packages THEN the CLI SHALL be able to install them (future capability; not required in v1).
- WHEN installing dependencies THEN the CLI SHALL support Bun-first (`bun add`) and remain compatible with npm-based workflows.
- WHEN installing dependencies THEN the wizard SHALL be explicit about what is being installed and why.

### 6. Deploy / boot

6.1 As an Instance Operator, I want the wizard to boot the server after validation, so that I can confirm the instance works.

- WHEN I select a “local dev” target THEN the wizard SHALL run the required commands to start SSR mode.
- WHEN I select a “production build” target THEN the wizard SHALL produce a build and provide the start command.

6.2 As an Instance Operator, I want good failure messages during deploy, so that I can fix issues quickly.

- IF a command fails THEN the wizard SHALL show the failing step, the command, and the next recommended action.

### 7. Installation and distribution

7.1 As an Instance Operator, I want to run the wizard via Bun or npm tooling, so that onboarding is one command.

- WHEN installing the wizard CLI THEN it SHALL support running via `bunx` and `npx`.
- WHEN running via `bunx`/`npx` THEN it SHALL be able to bootstrap a new instance directory.

7.2 As an Instance Operator, I want provider installation to be additive and reversible, so that trying new providers doesn’t permanently break my repo.

- WHEN the CLI installs provider dependencies THEN it SHALL record what it changed (packages and files).
- WHEN I choose to undo installation THEN the CLI SHALL be able to provide manual steps to revert.

### 8. Non-functional requirements

8.1 Performance

- WHEN running the wizard THEN it SHALL start quickly and avoid heavy runtime dependencies.

8.2 Compatibility

- The wizard SHALL work on macOS, Linux, and Windows.

8.3 Safety

- The wizard SHALL not change OR3 runtime behavior beyond setting env/config values.
- The wizard SHALL not break static builds (cloud remains gated by `SSR_AUTH_ENABLED`).
