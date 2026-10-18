# Optional secret store

`or3-secrets` supplies an optional private Unix-socket vault for remembered secrets in reviewed, package-backed trusted plugins. The service runs on Bun 1.3.14; OR3 uses a Node 24 client. The first implementation is unpublished development software and has no independent security audit or FIPS validation. Qualify the release and deployment security profile before using real credentials.

Build/install the qualified local `@or3/secrets` package and add `@or3/secrets/nuxt` to `modules`. Select it through private runtime configuration:

```ts
export default defineNuxtConfig({
  modules: ['@or3/secrets/nuxt'],
  runtimeConfig: { secrets: {
    provider: 'or3-secrets', namespace: 'deployment',
    socketPath: '/run/or3-secrets/api.sock',
    tokenFile: '/run/or3/credentials/secrets.token',
    vaultId: 'REPLACE_WITH_INITIALIZATION_VAULT_ID',
  } },
});
```

Runtime environment overrides are `NUXT_SECRETS_PROVIDER`, `NUXT_SECRETS_NAMESPACE`, `NUXT_SECRETS_SOCKET_PATH`, `NUXT_SECRETS_TOKEN_FILE` and `NUXT_SECRETS_VAULT_ID`. These hold paths and vault identity, never raw credentials or the master key. None belongs in `runtimeConfig.public`. Session bootstrap advertises only a selection boolean. A selected missing/invalid provider fails closed; static generation and `ssr: false` skip the module.

Provision a dedicated vault UID distinct from OR3. The service exclusively owns its `0700` vault/key directories and `0600` database, key and operator files. OR3 receives only a scoped expiring service-token file in its own private credential directory and permission to connect to a deliberately shared `0750` socket directory/`0660` socket. Do not mount the database or master key into OR3. Use `serve --socket-group NUMERIC_GID` after provisioning matching directory/group ownership. Namespace-bound OR3 tokens need `metadata,read,write,delete`; restrict owner/workspace/consumer further when suitable. Maintain separate operator/audit credentials, external MFA-protected administration, monitoring and recovery-key custody.

`host.secrets.set(key,value,{persistence:'session'})` stays in activation memory and clears on disposal. Default/`remember` writes use the selected provider. OR3 validates the current session, internal user ID, workspace write permission, exact selected trusted package, sealed live activation and current approved `secrets.read/write/use` grant. It constructs namespace/owner/workspace/plugin scope server-side and uses one compare-and-set attempt. Refs report actual revisions; reads after a context change are discarded. Workspace membership/role changes and workspace deletion also fence waiting requests: the host refuses newly stale work and suppresses plaintext returned after authorization invalidation, even when the activation handle remains live. A request already admitted to the service can commit during teardown; it never delivers a stale result into a replacement context. Activation handles expire after 30 minutes or host restart; restart the plugin to obtain new authority after expiry.

`secrets.read` gives trusted code plaintext. `secrets.write` permits set/delete, and `secrets.use` permits refs/unlock availability probes. Unlock reports availability; it does not fetch a master key into the browser. Missing provider, invalid identity, service outage, wrong vault and unsupported activations return errors without falling back to browser storage. The host and vault correlate request/acting-user/hashed-activation fields; these are application assertions, not human MFA or proof of individual operator identity.

The browser refuses redirects for secret requests. OR3 limits this route to 60 requests per minute per internal user across all plugins and 16 concurrent package/vault operations per process. Saturation returns `429` with `Retry-After`; mutations are never automatically retried. Keep normal HTTP upload/time limits at the host ingress. Client/provider filesystem paths must be absolute and normalized, without symlinks or `.`/`..` components.

Vault startup reconciles authenticated audit mutations against current secret revisions/tombstones, token issuance/revocation and the wrapping count, rejecting selective replay or removal of otherwise valid database rows. Independently retained audit receipts remain necessary to detect a complete consistent rollback. Early unpublished vault fixtures without this evidence must be recreated in new disposable directories; there is no automatic migration or overwrite.

Selecting the provider does not import/delete old localStorage secrets or Dexie OpenRouter keys. Old remembered plugin values require explicit re-entry. Connection, webhook, Connect and background-job credential storage remains under its existing owners. With no provider selected, remembered plugin values use device-local storage. Confirmed sign-out clears those values before asynchronous teardown; switching to a different authenticated account clears them synchronously, including switches through a temporary signed-out state. Startup reconciliation preserves them when no preceding account is known. No automatic migration is performed.

Use the package's `docs/operations.md` for exact stdin/private output commands, credential renewal/revocation, bounded audit collection, stopped-vault encrypted backup and fresh-key restore/rekey. Recovery revokes every copied credential, preserves revisions and requires newly issued consumers. Retain independent audit receipts and old backup keys separately. Process-crash and disk-full tests do not qualify power-loss durability or your deployment's RPO/RTO.

For CLI setup, use `or3-secrets --help`, `put --help`, or `help token issue`: each command lists required flags and a complete example. Terminal errors identify missing options and give a next step without echoing supplied values; scripts receive `{error:{code,message,hint}}` on stderr. Existing output files return `output_exists` (exit 64) and are preserved. Use a new private output path; plaintext still requires `get --stdout` or `get --out-file`, and values enter through stdin.

Ctrl-C or SIGTERM stops the foreground vault service gracefully. Successful cleanup closes the vault, removes its socket and exits 0; failures retain a nonzero status.

The reviewed client pins the socket service UID through private `NUXT_SECRETS_SERVICE_UID` (or Node `serviceUid` / CLI `--service-uid`). It defaults to the client UID, so a separate service account needs its explicit numeric UID and a service-owned run directory. Foreign-owned leaf sockets are refused before credential transmission.

Full SQLite index/table integrity is checked at admission. Invalid credentials are refused before acquiring a slow-body slot, and audit-reader limits cover all audit-producing routes. Live work stops before the 960 MiB high-water mark, reserving space below the 1 GiB encrypted backup ceiling. Offline row-wise rekey can rotate oversized sources; an inventory that remains oversized stays unavailable until a reviewed capacity change. Backup outputs and recovery custody artifacts must stay outside managed vaults; raw backup staging stays on live custody storage. The compatible host commit is declared by the provider package's `host-compatibility.json`.
