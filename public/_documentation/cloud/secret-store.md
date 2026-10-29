# Cloud credentials and the secret store

Authenticated Cloud selects `@or3/secrets@0.1.1` by default. The managed single-host Docker installer provisions a separate vault container automatically. Installing the npm package alone does **not** initialize or start a vault. The standard build launcher excludes vault access during prerender; custody is required at application runtime. Static/local BYOK deployments keep their existing browser credential flow.

The vault uses Bun 1.3.14, encrypted SQLite and a local Unix socket. It has no replication. Automatic provisioning supports one persistent Docker host, including multiple Node workers sharing that host's socket. Stateless serverless instances and independent hosts cannot share this vault. Use an appropriate replacement provider or explicitly disable it; a platform's Node preset alone does not establish persistent custody. Source launches offer local development provisioning, attachment to an existing service, or an explicit opt-out before Nuxt starts.

## Source launch setup and upgrades

After updating a source checkout, run `bun install`, then `bun run dev`. With authentication enabled and vault settings missing, an interactive launch prompts before Nuxt starts:

1. Automatically create or reuse a **local development vault**.
2. Manually attach an existing vault using its socket path, token file, namespace, initialized vault ID and numeric service UID.
3. Explicitly use instance billing only, without personal keys, OAuth or remembered plugin secrets.

`bun start` reaches the same development launcher. `bun run preview` also checks runtime custody. Configure ahead of time with `bun run setup:secrets`, or use `--auto`, `--manual` or `--disable`. With `--manual`, values already supplied through the environment or dotenv file can be verified without a terminal. Unattended launches never guess, initialize custody or silently opt out: incomplete settings stop with a setup command instead of a browser `invalid_configuration` error. Builds and type checks do not provision vaults. Explicit `bun run dev -- --or3-offline` bypasses the secret store for that launch without changing saved custody. Direct `nuxt dev` and direct `.output/server/index.mjs` execution bypass source setup; configure an external supervisor before launching them.

Automatic setup runs the installed provider's initialization command, creates private custody in the source checkout's `.or3/secrets` and saves only connection settings in the selected dotenv file (normally `.env`). A watched plugin development host uses its own profile for new automatic vault custody. Existing profiles continue using their saved vault settings; custody is not moved automatically. Existing comments and unrelated settings survive; changed files receive a private backup. The Unix socket lives in a short, private directory under the system temporary directory. The source launcher starts its owned service, verifies identity and token access, renews its seven-day service token at startup and daily, and stops the owned service when it exits. Keep one source launcher per local vault; use an independently supervised service for shared launches. Restart the whole source launcher after changing vault settings.

Custody survives source updates and normal restarts. Existing `.env` credentials are **not imported**: instance keys and signing credentials retain their roles, while personal keys remain account-scoped. A second setup never replaces an existing master key, vault ID or database. An incomplete custody directory refuses regeneration. Preserve it and restore the matching key/configuration from backup. Manual attachment verifies the running service before saving any settings.

The local vault runs as your OS user and is for macOS/Linux development. It does not provide the separate-user custody of managed Docker. Automatic initialization refuses `NODE_ENV=production`; production source deployments must attach a separately provisioned service. Installing the package remains distinct from provisioning a running vault. Back up the entire private custody directory securely; deleting it loses access to its saved credentials.

## Connect once

After signing in, paste an OpenRouter key or connect through OAuth. Cloud stores it under the authenticated internal user ID, with reserved account scope `@account` / `@or3.openrouter`. Workspace write authorization is still required for use. The same account can use it across authorized workspaces and devices; another account cannot inherit it. Connection/status APIs return only `connected` and `persisted` booleans. OAuth PKCE is in an account-bound HttpOnly transaction cookie; exchange and storage happen on the server. The callback receives status only.

One server policy selects credentials for chat, background chat, memory classification, model catalogs, governed plugin completion and trusted workflow preparation:

- `requireUserKey: true`: use the user's key, regardless of override configuration; absence never bills the instance.
- Otherwise, `allowUserOverride: true`: prefer the user's key, then the instance key when no user record is available.
- `allowUserOverride: false`: use the configured instance key.

A selected vault outage fails closed whenever selection needs a personal key. Cloud ignores browser credential headers and has no direct-browser inference fallback. Instance calls retain existing rate, concurrency and usage limits; governed plugin calls retain their existing budgets. Background jobs retain their existing encrypted execution custody and authorization; the vault is not a new job scheduler.

## Existing browser keys

Cloud never hydrates a legacy browser key into usable application state. On sign-in/reconnect, it offers a one-time import only for a legacy key tagged with the **same provider and internal account ID**. Unowned older values cannot prove ownership and require explicit re-entry. Declining or failing import preserves the source; it cannot be used directly by new Cloud code.

Credential requests and OAuth initiation include the tab's expected account, which the server checks against its session cookie. A stale tab cannot import or start a connection for a newly signed-in account. The paste-key form clears on dismissal or account changes. Import uses compare-and-set and removes owned browser copies only after server persistence is verified. A saved/deleted account record prevents another device from re-importing stale credentials. Reconnecting devices discard their matching copies; clearing offline or inaccessible devices is best-effort. Inaccessible copies do not invalidate a verified server save, and cleanup is retried on reconnect. Connection/disconnection failures are shown in the UI; a failed disconnect does not claim removal. No credentials enter session payloads, workspace synchronization or Cloud workspace exports. Device-local plugin values are not automatically imported. Explicit workspace cache deletion policies still apply independently.

## Managed single-host custody

The release image contains both runtimes, but they run in separate containers:

| Container | Identity / mounts |
| --- | --- |
| OR3 application | UID/GID 65532; app data plus read-only socket and service-token volumes |
| Vault | Confined root supervisor; actual service/CLI UID 1000, socket group 65532; private data and master/operator volumes; no network |

The application never receives the database, master key or operator token. The supervisor initializes only completely empty custody, verifies ownership, starts the service and issues a namespace-scoped service token with `metadata,read,write,delete`. Tokens last seven days and renew at startup and daily. Token files are atomically replaced; renewal failure stops the vault. Namespace-wide application authority is deliberate: OR3 enforces user/workspace/plugin grants, while the vault enforces exact supplied scopes.

Compose waits for vault readiness before starting OR3. Deep health/`doctor` probes selected vault availability; ordinary liveness does not. The updated provider uses the authenticated, non-writing `probe` operation, so public health polling does not append vault audit events. Deploy the matching vault service and provider together; diagnostic `status` remains audited. Volumes persist through upgrades/restarts. An incomplete initialization, wrong ownership, missing master key or different vault identity refuses startup. **Never delete custody volumes or generate a replacement key to repair an existing vault.**

## Configuration and explicit opt-out

The private Nuxt settings are `NUXT_SECRETS_PROVIDER`, `NUXT_SECRETS_NAMESPACE`, `NUXT_SECRETS_SOCKET_PATH`, `NUXT_SECRETS_TOKEN_FILE`, `NUXT_SECRETS_VAULT_ID`, and `NUXT_SECRETS_SERVICE_UID`. They contain selection, paths and identity, never the master key. The module is registered automatically for authenticated Cloud. A missing selected provider fails startup; unavailable storage returns sanitized errors.

Managed defaults are namespace `or3`, socket `/run/or3-secrets/api.sock`, token `/run/or3-secrets-client/service.token`, service UID `1000`; a private generated metadata file supplies the vault ID. External supervisors must configure all these values and persist custody securely. A separately provisioned vault requires service-owned `0700` data/key directories, `0600` files, a `0750` shared socket directory and `0660` socket; pin its numeric service UID.

Set `NUXT_SECRETS_PROVIDER=` explicitly to disable it. Passive connection status reports that personal credential storage is unavailable without treating the explicit opt-out as a vault outage; attempts to save, migrate, or delete personal credentials still fail closed. Stop the managed deployment before changing this setting, then use `start` to apply saved configuration; `restart` alone retains the existing container environment. The managed CLI omits the vault profile. Cloud then supports instance billing only; user-key saves, OAuth and remembered plugin secrets fail closed. There is no browser-storage downgrade. An administrator may register/select a different `ServerSecretStore` using the existing provider contract. Replacing a provider does not automatically move its data.

## Plugin boundary

Reviewed trusted plugins use existing `context.secrets.set/get/delete/ref` methods for **their own** namespace/user/workspace/plugin scope. Session-only secrets remain activation memory. Server routes enforce the selected package, approved grants, sealed live activation, owner and workspace before/after operations. Membership/role changes and workspace deletion invalidate pending operations even when the activation remains live; results arriving after invalidation are refused. Revoked, stale or expired activations fail. `secrets.read` deliberately delivers that plugin's plaintext to trusted code. Portable/isolated runtimes retain their current unsupported private-secret behavior; no shared OpenRouter-key lookup is added.

Cloud `context.ai.complete()` uses existing governed server admission. Trusted packages require `ai.provider`; portable packages retain `network.http`. No raw credential is returned. Cloud browser `context.ai.provider()` explicitly returns `unsupported`; use completion or a suitable host action. Static trusted SDK access remains compatible. Arbitrary trusted-host code is **not sandboxed**: it runs with substantial host privileges, including access to its own secrets. Approved trusted server workflow adapters retain server-side SDK/raw-key compatibility, prepare credentials through the central policy, require a live authorized origin per request and cannot select a different billing key through the adapter.

## Backup and recovery

Managed backup/update stops the application and vault, captures the app archive plus an **encrypted** `vault.backup`, verifies its SHA-256 in the authenticated manifest, then restarts when appropriate. Export includes that encrypted artifact. Master/operator files are deliberately excluded. Keep separately protected, independently recoverable copies of the master key and audit receipts; an app backup without the matching key cannot recover credentials. Account for vault backup bytes when planning disk capacity.

Application rollback/restore preserves the live vault and its newer revocations; it does not replay old upstream credentials. Rollback to an older release may stop using the vault, but its volumes and encrypted backups remain. To recover a lost vault, stop admission and follow the package's [operations procedure](https://github.com/Saluana/or3-secrets/blob/main/docs/operations.md): restore the verified encrypted backup with its separately held old key into **new empty custody**, generate a fresh key/operator token with `restore`, then provision fresh application tokens. Restore revokes copied credentials and preserves secret revisions. Never restore over the source or automatically initialize over damaged custody. Reattach the explicitly recovered volumes only after verifying identity and records; retain the source for investigation.

`bun scripts/test/run-cloud-vault-e2e.ts` repeats initialization, UID/mount isolation, scoped access, crash restart, outage, encrypted backup, fresh-key recovery and partial-custody refusal with disposable containers. `bun scripts/test/run-cloud-credentials-e2e.ts` exercises real-service browser migration and second-device cleanup. Receipts are under `test-results/`.

This integration is not independent production qualification. The pinned vault runtime still requires the provider's advisory review, independent security review, target-host power-loss/durability qualification and measured recovery objectives. No FIPS validation is claimed. See the provider's operations/security documents before importing real credentials.

Device-local remembered plugin secrets in static/local deployments clear synchronously on confirmed sign-out or a change to another account, before asynchronous teardown. A stale session during startup preserves them. Delayed cleanup from an older account cannot erase credentials saved by the new account.
