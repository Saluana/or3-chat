# OR3 Chat contributor instructions

OR3 is a local-first Nuxt/Vue application with optional Cloud providers and a plugin SDK.
Prioritize correctness and data safety, then extensibility, developer experience, and performance.

## Working in this checkout

- Use Bun for repository commands and dependency management: `bun install`, `bun run <script>`, and `bunx <tool>`.
- Use the supported dev/build wrappers; they select Node where required by the SQLite stack.
- Source development starts with `bun run dev`; managed installations follow [Cloud setup](public/_documentation/cloud/setup.md).
- Start with [the docmap](public/_documentation/docmap.json) and the relevant public guide, then inspect the defining types, callers, and existing extension points.
- [The source map](public/_documentation/start/source-map.md) locates feature owners and registries; source types and current code define exact APIs.
- Prefer `rg` for search and current library documentation when an external contract is uncertain.
- Preserve unrelated worktree changes and use the user's existing authorization; ask only when material information or approval is missing.
- Keep changes focused and type-safe, and follow a supplied plan, checking off completed tasks when applicable.
- Update affected documentation and docmap entries when public behavior or extension contracts change.
- Commit messages use `[Type] Short note on changes`.

## Extension and runtime boundaries

- Prefer supported configuration, themes, plugins, and providers; change core when it owns the defect or a public contract is missing.
- Reuse hooks, registries, and composables; avoid parallel registries and unmanaged global state.
- Keep server-only auth/DB code under `server/**` or provider `runtime/server/**` and browser code behind client boundaries.
- Gate SSR modules in `nuxt.config.ts`; static builds must remain usable without server SDKs or Cloud providers.
- Providers register server implementations through Nitro plugins; keep their Nuxt modules thin.
- Source integrations may use private app imports; installable plugins use documented `@or3/plugin-sdk` entry points.
- Check the current SDK support table: a type or manifest field alone does not prove host support.
- `trusted-host` is reviewed host code; isolated plugins must fail closed rather than fall back to trusted execution.
- Retain owner-scoped cleanup handles for registrations, subscriptions, and resources across unmount, replacement, and HMR.
- Update hook payload types and public hook docs when adding or changing an emitted hook.

## Cloud and data invariants

Changing these architecture contracts requires explicit approval.

- Canonical users/workspaces live in the selected sync backend through `AuthWorkspaceStore`; do not add a duplicate authority store.
- Direct sync providers use `AuthTokenBroker` with provider-specific tokens; gateway SSR operations enforce `can()`.
- Keep one Dexie database per workspace (`or3-db-${workspaceId}`).
- Use snake_case sync/storage wire schemas aligned with Dexie; map only where the backend requires it.
- Capture local writes and outbox operations atomically through Dexie hooks; remote-applied writes must not re-enqueue.
- Preserve outbox coalescing, bounded queues, and retention policies.
- `op_id` provides idempotency: repeated pushes replay their result rather than apply twice.
- Allocate contiguous, monotonically increasing `server_version` values in one workspace transaction and use one workspace cursor.
- Preserve LWW comparison by `clock` then `hlc`, tombstone deletes, and GC constrained by the minimum device cursor plus retention.
- Order messages by `index` and HLC-derived, indexed `order_key`.
- Treat `ref_count` as derived state; do not LWW-sync it.
- Keep blob transfers local-first and queued, with local-only `file_transfers` state.
- Authorize short-lived presigned URLs through `can()` and preserve upload reservation/commit contracts.

## Authentication and workspace safety

- `can()` is the authorization gate for SSR operations; reuse the route's feature gate, no-store, rate-limit, and origin-validation patterns.
- `SessionContext.user.id` is the internal store ID; `providerUserId` is the external subject.
- Honor the active workspace pointer and refresh session state after provider sign-in, sign-out, or credential changes.
- Resolve the current DB at operation start; capture and guard originating workspace/account identity across asynchronous work.
- Use existing Dexie entity and KV helpers; persist user OpenRouter keys through `persistUserApiKey()`.
- Keep server credentials server-only and secrets out of source, logs, reports, and `localStorage`.
- In SSR mode without a user key, require the OpenRouter server route rather than falling back to a direct request.
- Reuse wizard/config APIs and nondestructive env merges; preserve unknown entries and supported aliases.
- Back up and obtain explicit approval before destructive data replacement or provider migration.
- Verify configured providers are installed and registered; provider defaults differ between managed and source deployments.

## UI, search, and background work

- Use Nuxt UI components, semantic theme tokens, and existing variants; centralize shared variants instead of adding a styling system.
- Respect the active theme's appearance and existing retro defaults where used; keep icon-only buttons square and centered.
- Use `v-theme` for DOM decoration and `useThemeOverrides()` for reactive component props; see the current theme docs for contexts and selectors.
- Preserve accessible keyboard/focus behavior, responsive layouts, and light/dark states.
- Lazy-load heavy optional features and reuse existing search/index composables.
- Keep search debounced and bounded with substring fallback; indexed edits and replacements must invalidate or update search even when row counts stay unchanged.
- Background eligibility and tool execution depend on current auth, sync, runtime, and provider capabilities; use [background execution](public/_documentation/cloud/background-execution.md).
- Preserve durable admission, cancellation, recovery, and canonical history contracts; a transport failure must not fabricate a terminal generation result.
- Scope background notifications to the originating account/workspace and dispatch through the existing notification hooks/service.
- Treat sync HTTP 429 responses as deferrals using structured `Retry-After` metadata without incrementing failed-attempt counts.

## Validation

- Verify changed behavior with the smallest appropriate existing suite; add regression coverage when it protects a meaningful failure mode.
- Normal implementation uses targeted files or `bun run test:changed`; `bun run test` is the fast core lane.
- Use `test:integration`, `test:scripts`, `test:release-policy`, or `test:plugin-compatibility` only for changes touching those lanes.
- Reserve `bun run test:full` for cross-cutting/high-risk changes, scheduled CI, and release qualification.
- Use named `test:e2e:*` harnesses for credential-writing, paid-network, visual-artifact, stress, and performance suites; retain their repeatable artifacts.
- Extend canonical suites; avoid permanently skipped tests, test-local copies of production logic, and cosmetic source-string assertions.
- Run relevant type checks when changing contracts, inspect the final diff, and prefer compact test output.
- Report the result and validation concisely; include material limitations, artifact/activation status, or recovery steps when relevant.

## Deployment and release

- [docs/cloud-updates.md](docs/cloud-updates.md) is the canonical update guide; follow it instead of inventing release procedures.
- Routine application updates use the documented development workflow and exact image digests.
- Stable releases require explicit intent and the documented candidate/tag ceremony.
- Do not publish packages/images outside documented workflows, bump versions, or alter live data merely to update application code.

## Task-specific references

- [Cloud providers](public/_documentation/cloud/providers.md), [auth](public/_documentation/cloud/auth-system.md), [sync](public/_documentation/cloud/sync-layer.md), and [storage](public/_documentation/cloud/storage-layer.md).
- [Database safety](public/_documentation/database/safe-changes.md) and [chat lifecycle](public/_documentation/architecture/chat-lifecycle.md).
- [Plugins](public/_documentation/plugins/overview.md), [hooks](public/_documentation/hooks/reference.md), and [themes](public/_documentation/themes/overview.md).
- [Development commands and runtime requirements](public/_documentation/start/development-setup.md).
