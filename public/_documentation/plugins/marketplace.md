# Native Marketplace

Dashboard > Marketplace is the user-facing place to find, install and manage plugins from the configured marketplace registry. It is a dashboard app like the Workspace manager: it reuses the existing navigation, theme and components, has no iframe and has no central-site sign-in.

Discovery works on any instance. Installing requires an OR3 Cloud profile with a configured registry — a static or local build shows that installation is unsupported instead of hiding the surface.

## Configuration

The marketplace reads the same reviewed-acquisition configuration as the install pipeline:

| Variable | Meaning |
| --- | --- |
| `OR3_MARKETPLACE_REGISTRY_ORIGIN` | Registry origin. Must be `https://` with no path. |
| `OR3_MARKETPLACE_INSTALL_ENABLED` | Must be exactly `true` for installs to be allowed. |
| `OR3_MARKETPLACE_RELEASE_KEYS` | JSON array of trusted release keys (`keyId` + Ed25519 public JWK). |
| `OR3_MARKETPLACE_MAX_ARTIFACT_BYTES` | Per-acquisition download ceiling (default 128 MiB). |
| `OR3_MARKETPLACE_RESERVE_BYTES` | Free disk kept for the running instance (default 64 MiB). |

An instance with no origin or no release key still browses the public catalog if the origin is set, and reports `registry-unconfigured` for installs.

## Routes

All are authenticated, workspace-scoped and `no-store`; install actions are owner/super-admin only.

- `GET /api/plugins/marketplace/catalog` — browse the configured registry through the local server (search, category, tag, collection, page, pageSize). Returns `{ configured, catalog }`; `configured: false` means this instance has no registry.
- `GET /api/plugins/marketplace/{pluginId}` — one published plugin's public detail.
- `POST /api/plugins/marketplace/preflight` — the install assessment: `{ pluginId, version? }`.
- `POST /api/admin/plugins/acquisitions` — start the install (resource documented in [Trusted Registry Acquisition](./trusted-acquisition)).
- `GET /api/plugins/diagnostics` — the redacted support report (owner only).

The browser never talks to the registry: the local server is the configured trusted client, so a self-hosted instance does not need a generic URL proxy and the registry never sees a session cookie.

## Preflight block codes

Preflight answers with a list of actionable blocks rather than a boolean. Each block carries a code, a message and a recommended action.

| Code | Action | Meaning |
| --- | --- | --- |
| `registry-unconfigured` | `configure-registry` | No origin or no trusted release key is configured. |
| `registry-install-disabled` | `enable-install` | `OR3_MARKETPLACE_INSTALL_ENABLED` is not `true`. |
| `release-profile-unsupported` | `contact-admin` | This host does not declare the release's profile. |
| `release-trust-unsupported` | `contact-admin` | This host does not run the release's trust mode. |
| `release-key-untrusted` / `release-signature-invalid` | `browse-catalog` | The release is not signed by a trusted key. |
| `release-quarantined` | `browse-catalog` | A signed advisory quarantines this release. |
| `advisory-stale` / `catalog-stale` | `retry` | The registry served an older position than this host accepted. |
| `advisory-unverified` | `retry` | The advisory log could not be verified. |
| `storage-unavailable` | `free-space` | There is not enough free space to stage and verify the package. |
| `already-installed` | `use-installed` | The plugin is installed; use Installed or Updates. |

Local assessment governs execution. It is not an attestation to central commerce: a self-hosted server cannot be remotely attested by the marketplace flow.

## Install, update and canary

Installing goes through the durable acquisition operation (see [Trusted Registry Acquisition](./trusted-acquisition)). The UI follows the recorded stage and mirrors the operation's own retry/cancel rules.

A release that declares a contained client runtime needs a real browser canary. The host issues a single-use ticket bound to the plugin, package digest, workspace, client id and nonce; the admin's browser performs a hidden activation of the candidate's exact bytes in the contained sandbox, re-hashes them and reports the outcome. Until that evidence exists the operation stays pending with `client-canary-pending`, and the UI completes the check and retries the same operation. A server-side check alone never substitutes for it.

Updates are recorded candidates on the same lifecycle, and an update a previous install recorded is resumed rather than re-implemented: when a candidate is owned by an unfinished install operation, Updates continues that operation so the pipeline's preflight, setup readiness and browser canary all still apply. The promotion boundary enforces this for every caller: it refuses a candidate an unfinished install operation owns (answering with the operation id), and it runs the instance-wide workspace preflight for any promotion, whatever created the candidate. Expanded authority needs fresh workspace consent before the check can pass. Rollback, pin and uninstall keep their existing package operations, and plugin data is kept unless deletion is requested explicitly.

## Member access

Browsing needs only a workspace session. Installing needs an owner or super admin, so a member sees the detail and a copyable administrator request link instead of an install action. There is no ticket system and no misleading purchase step.

## Diagnostics

`GET /api/plugins/diagnostics` returns a redacted report for support: host and plugin API versions, mode, the capability declaration, marketplace configuration state and accepted advisory position, per-plugin digests/trust/startup status, installed extension versions and acquisition operation ids with failure codes. Plugin settings values, connection names and secrets, message and document content, credentials, headers and signed URLs are never included, and the report states what was omitted.

## Related

- [Trusted Registry Acquisition](./trusted-acquisition) — the install pipeline, advisories and recovery.
- [Portable Containment and Setup](./portable-containment-and-setup) — the sandbox the client packages run in.
- [Portable Profile](./portable-profile) — what a marketplace package may be.
