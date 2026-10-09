# Runtime and security

This reference is for operators and authors who need to understand permission
review, package activation, and recovery. Use [Install and manage plugins](/documentation/plugins/install-and-manage)
for the ordinary UI workflow.

## Operator configuration

Managed deployments should follow the existing [Cloud configuration](/documentation/cloud/configure)
and the repository's `docs/cloud-updates.md` workflow. These are advanced configuration keys, not a replacement installation
procedure. Restart or redeploy through that workflow when build-time config changes.

| Variable | Purpose / default |
| --- | --- |
| `OR3_MARKETPLACE_REGISTRY_ORIGIN` | Trusted HTTPS registry origin without a path |
| `OR3_MARKETPLACE_INSTALL_ENABLED` | Exactly `true` permits registry acquisition; off by default |
| `OR3_MARKETPLACE_RELEASE_KEYS` | Trusted Ed25519 release-key JSON: `keyId` and public JWK |
| `OR3_MARKETPLACE_MAX_ARTIFACT_BYTES` | Per-acquisition download limit, 128 MiB by default |
| `OR3_MARKETPLACE_RESERVE_BYTES` | Disk space reserved for the instance, 64 MiB by default |
| `OR3_PLUGIN_MODULE_LOADER_V2_ENABLED` | Enables immutable package execution; off by default |
| `OR3_PLUGIN_MODULE_LOADER_V2_WORKSPACE_IDS` | Optional workspace allowlist for package loading |
| `OR3_PLUGIN_ISOLATION_ENABLED` | Enables contained client execution; off by default and required for portable packages |
| `OR3_HOOK_ENGINE_V2_ENABLED` | Selects the current hook engine at process start; off by default |
| `OR3_PLUGIN_RUNTIME_V2_ENABLED` | Browser/compatibility manager, on by default; does not itself enable package loading |
| `OR3_PLUGIN_RUNTIME_V2_WORKSPACE_IDS` | Optional manager workspace selection |
| `OR3_DISABLE_NON_CORE_PLUGINS` | Startup safe mode that prevents non-core discovery/execution |
| `OR3_PLUGIN_CONNECTION_SECRET` | Encryption key for plugin connections |
| `OR3_LIBRARY_LINK_SECRET` | Separate encryption key for personal Library links |

A release-key entry has this shape; replace the placeholders with the actual
trusted public key, never a private signing key:

```json
[{ "keyId": "registry-key-id", "publicJwk": { "kty": "OKP", "crv": "Ed25519", "x": "base64url-public-key" } }]
```

Portable model-backed features additionally need a provider credential in the
host's provider configuration and an approved model/price catalog:

```text
OR3_PLUGIN_ALLOWED_MODELS=<model-id>
OR3_PLUGIN_MODEL_PRICES={"<model-id>":{"promptPerMillion":0.2,"completionPerMillion":0.6}}
```

Use actual model IDs and verified provider prices. Unpriced models are refused;
an empty allowlist means no approved models. Containers map model/secret values
to their `NUXT_ADMIN_*` runtime overrides at startup. Provider charges belong
to the configured account and are attributed to the acting plugin.

## Packages and permission review

Acquisition resolves a plugin and exact release from the configured registry;
it does not accept caller-chosen package URLs. Before selection changes, the
server verifies signed metadata, the advisory checkpoint, archive bytes,
canonical package tree, manifest, and effective authority. It checks disk
capacity, host/runtime support, workspace access, setup, and state compatibility.

The runtime supports reviewed trusted-host code and contained portable clients.
Trusted code runs in the host page/server; reviewed SDK permissions do not turn
it into a sandbox. Portable plugins run in an opaque-origin sandboxed frame
hosting a worker. The host window does not evaluate portable publisher code.
There is no fallback from unsupported isolation to trusted execution.

Permissions are workspace-specific, while selected code is instance-wide.
Every enabled workspace must pass update preflight. Approvals can carry forward
when access is unchanged or narrowed. Adding a destination, path, method, scope,
write, hook, feature, dependency, or changing trust can expand authority and require
fresh approval. Engine ranges are signed compatibility metadata, checked by the
host; they do not by themselves expand workspace access. Runtime activation
handles are separately generation-bound and invalidated on replacement.

Review is bound to the exact candidate/authority shown. A changed selection or
workspace set invalidates an impact review. An update does not broaden access
or enable disabled workspaces by implication. A setup/state blocker preserves
the currently selected version.

## Browser checks and activation

Client packages require exact-package browser evidence before promotion.
Portable checks activate the candidate in the contained runtime. Trusted-host
checks verify entry bytes, host Vue ABI/import mapping, and import without
running `setup`; normal activation runs `setup` after promotion and enablement.
A server check alone does not prove client startup.

The live host Vue render proof loads a precompiled same-origin module through
the host import map. It runs under the managed production CSP without `blob:`
scripts or `unsafe-eval`.

Installed, workspace-enabled, and browser-running are separate states. The UI
checks the exact package digest, not just a version string. An activation check
never proves a paid feature or workflow succeeded. Portable code starts when its
surface is needed rather than starting every worker during manifest refresh.

Portable execution is currently qualified for Chromium only. Containment probes
exist for other engines, but probe measurements do not establish lifecycle
qualification. Static hosts cannot run mediated package capabilities.

## Containment and budgets

The portable boundary denies direct host DOM, cookies, browser storage,
IndexedDB, unmediated fetch/WebSocket, remote imports, navigation, clipboard,
and other browser authority. Approved capabilities are host calls. UI is
validated data rendered with host components; Markdown is sanitized.
These are application runtime bounds, not OS CPU/memory isolation.

| Current bound | Value |
| --- | --- |
| Message | 256 KiB; depth 32; 20,000 values |
| Single result / total activation output | 1 MiB / 4 MiB |
| Calls / concurrent calls per activation | 1000 / 8 |
| Per-call deadline | 10 seconds |
| Activation wall clock | 120 seconds |
| UI depth / nodes / text / items | 8 / 200 / 16 KiB / 2048 |
| AI output per call | 4096 tokens |
| AI spend per acting user/workspace/plugin budget window | $1.00 |

Ordinary wall-clock expiry can replace a visible activation automatically while
preserving its last view and typed fields. Terminal policy, containment, or quota
failures are blocked; use explicit recovery rather than replaying failed work.
Stale-handle recovery is bounded. Saved plugin storage/settings survive a worker
restart; in-memory plugin state does not.

The server mints an activation handle bound to the user, workspace, generation,
package digest, and approved grants, then revalidates live authority on requests.
Disable, workspace switching, updates, and teardown revoke the relevant handles.
Current handle/admission state is process-local; use the qualified single-process
host topology. Replica routing does not provide a shared activation store.

Paid completions reserve worst-case spend in a durable ledger before dispatch.
Restarting a worker cannot reset spent budget. A lost response or timeout is an
uncertain outcome; the host does not automatically replay a completion or
external write. Only a host UI action can mint approval for a protected write,
purchase, credential change, or access change. Plugin/model output cannot approve it.

## Recovery and safe mode

| Situation | Recovery |
| --- | --- |
| Interrupted acquisition | Continue the same recorded operation after resolving its blocker |
| Pending update needs setup | Configure the candidate in the named workspace, then Continue |
| Bad activation | Use Run check or Retry plugin startup; inspect the exact selected digest |
| Need an older version | Review Restore previous version; all enabled workspaces must read its state |
| Need to stop one workspace | Disable; saved data stays |
| Need instance-wide removal | Uninstall; saved data deletion is a separate action |
| Host unsafe to open | Set `OR3_DISABLE_NON_CORE_PLUGINS=true` outside plugin UI and restart before discovery |

Confirm safe mode in the Runtime Inspector. Do not clear data as a startup
repair. Code restoration does not restore a database snapshot or reverse an
incompatible migration. Canceling is available before promotion commits; after
commit the operation reports the selected installation instead of claiming it
was canceled. Package bytes may remain retained after disable or uninstall.

Runner ownership protects a staged acquisition. A timed-out heartbeat alone
cannot prove a remote runner stopped. If a runner cannot be resumed, an operator
must verify the owning host/process is stopped before using the ownership-token
recovery operation; never delete arbitrary locks while runners are live.
Detailed service contracts live under `server/utils/plugins/acquisition/` and
`server/admin/plugins/`.

## Registry trust and key rotation

Signed advisory checkpoints have a monotonic security revision. Older revisions,
equivocation, replay, stale checkpoints, untrusted keys, mismatched bytes, and
quarantined releases are refused. Accepted trust state is durable. A publication
date alone is not trust freshness.

A quarantine blocks new acquisition and activation; it does not remotely unload
an already running release. Disable or uninstall it locally, or update to a
permitted release. User data is untouched. Library purchase coverage does not
bypass signatures or quarantine.

Key rotation is host-update-first: distribute the new public key to every
supported host's trust root while retaining the old key, pretrust it at the
registry, switch the signer, then retire the old key while preserving historical
verification. A signed snapshot carries key status, not new trusted key material.
Pretrusting a key centrally cannot make an older host trust it automatically.

## Local development admission

Unpublished candidates run in a separate loopback-only development host with
local basic-auth, SQLite, and filesystem providers. `bun run dev:plugin --create`
configures the watched host and prints local credentials automatically. The
manual `bun run dev:plugin` path uses its configured local owner credentials.

Admission independently requires a development build, `OR3_PLUGIN_DEVELOPMENT=1`,
a dedicated `OR3_PLUGIN_DEV_PROFILE` containing all data roots, local providers,
a direct loopback connection, authenticated owner, and same-origin mutation.
Production builds reject development admission. Do not share the profile with
production or normal checkout data.

Local admission uses labeled development provenance; signed acquisition uses
registry provenance. Both still check package identity, grants, setup, canary,
and state. Development receipts cannot replace independent marketplace evidence.
See [Publish](/documentation/plugins/publish) to exercise a frozen candidate.

## API and implementation map

| Surface | Route family / owner |
| --- | --- |
| Acquire, status, retry, cancel | `/api/admin/plugins/acquisitions` |
| Grants, canary, promote, rollback, uninstall | `/api/admin/plugins/packages/<pluginId>` |
| Site catalog and workspace rollout | `/api/admin/plugins/site-catalog`, `/api/admin/plugins/rollouts` |
| Runtime view | `/api/plugins/runtime-manifest` |
| Setup, first action, sample | `/api/plugins/<pluginId>/setup-plan`, `/first-action`, `/sample` |
| Portable activation and capability bridge | `/api/plugins/isolation/` |
| Redacted support diagnostics | `/api/plugins/diagnostics` |

Admin mutations require their authenticated authority and normal same-origin
intent checks; route families are not a shortcut around permissions.
Implementation/qualification references include
`server/admin/plugins/v2-host-capabilities.ts`,
`shared/plugins/isolation/`, `shared/plugins/authority/effective-authority.ts`,
and the committed evidence under `tests/plugin-runtime/evidence/`.
