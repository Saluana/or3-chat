# Native Marketplace

Dashboard > Marketplace is the user-facing place to find, install and manage plugins from the configured marketplace registry. It is a dashboard app like the Workspace manager: it reuses the existing navigation, theme and components, has no iframe and has no central-site sign-in.

Discovery works on any instance. Installing requires an OR3 Cloud profile with a configured registry — a static or local build shows that installation is unsupported instead of hiding the surface.

Admin > Plugins includes a **Browse Marketplace** link to this dashboard. Sign in
with a regular Chat account: the system admin login is a separate session and
does not make authenticated dashboard apps visible to a guest.

Installed V2 packages are detected across the instance, even in workspaces where
they are disabled. Use **Installed** to activate an existing package in another
workspace; clicking Install again does not create a second copy. Candidate
preparation also refuses the already-current package without changing its pointer.

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
- `POST /api/plugins/marketplace/preflight` — the install assessment: `{ pluginId, version?, clientEngine? }` (`clientEngine` is the browser engine the page detected, used for profile qualification).
- `POST /api/admin/plugins/acquisitions` — start the install (resource documented in [Trusted Registry Acquisition](./trusted-acquisition)).
- `GET /api/plugins/diagnostics` — the redacted support report (owner only).

The browser never talks to the registry: the local server is the configured trusted client, so a self-hosted instance does not need a generic URL proxy and the registry never sees a session cookie.

A release whose signed profile requires a contained client runtime is browser-scoped. The preflight request reports the engine the page detected, the host judges it against the same structured qualified-engine list the runtime enforces, and an unsupported or unknown engine gets no install action: discovery stays read-only with a copyable plugin link to open in a qualified browser. Chromium is the only qualified engine today; the runtime re-checks the engine before it fetches any bytes, so the CTA is a journey gate rather than the boundary.

## Preflight block codes

Preflight answers with a list of actionable blocks rather than a boolean. Each block carries a code, a message and a recommended action.

| Code | Action | Meaning |
| --- | --- | --- |
| `registry-unconfigured` | `configure-registry` | No origin or no trusted release key is configured. |
| `registry-install-disabled` | `enable-install` | `OR3_MARKETPLACE_INSTALL_ENABLED` is not `true`. |
| `release-profile-unsupported` | `contact-admin` | This host does not declare the release's profile. |
| `release-trust-unsupported` | `contact-admin` | This host does not run the release's trust mode. |
| `client-engine-unsupported` | `use-supported-browser` | The release's profile needs a client runtime this browser is not qualified for. |
| `release-key-untrusted` / `release-signature-invalid` | `browse-catalog` | The release is not signed by a trusted key. |
| `release-quarantined` | `browse-catalog` | A signed advisory quarantines this release. |
| `advisory-stale` / `catalog-stale` | `retry` | The registry served an older position than this host accepted. |
| `advisory-unverified` | `retry` | The advisory log could not be verified. |
| `storage-unavailable` | `free-space` | There is not enough free space to stage and verify the package. |
| `already-installed` | `use-installed` | The plugin is installed; use Installed or Updates. |

Local assessment governs execution. It is not an attestation to central commerce: a self-hosted server cannot be remotely attested by the marketplace flow.

## Install, update and canary

Installing goes through the durable acquisition operation (see [Trusted Registry Acquisition](./trusted-acquisition)). The UI follows the recorded stage and mirrors the operation's own retry/cancel rules. A first install enables the plugin for the installing workspace, so "installed" means the package is actually running; an update never changes enablement, so a workspace that deliberately disabled a plugin keeps it disabled.

A release that declares a contained client runtime needs a real browser canary. The host issues a single-use ticket bound to the plugin, package digest, workspace, client id and nonce; the admin's browser performs a hidden activation of the candidate's exact bytes in the contained sandbox, re-hashes them and reports the outcome. Until that evidence exists the operation stays pending with `client-canary-pending`, and the UI completes the check and retries the same operation. A server-side check alone never substitutes for it.

Updates shows two things: staged candidates, and newer published releases found by an explicit, bounded catalog check ("Check for updates"). The check resolves each newer release through the same trust pipeline as acquisition, so a quarantined or unresolvable release is reported as blocked instead of advertised. Reviewing an available update starts the ordinary acquisition operation for that exact release — it never promotes directly — which is what surfaces the authority and setup differences. Checking for updates never stages anything by itself.

Updates are recorded candidates on the same lifecycle, and an update a previous install recorded is resumed rather than re-implemented: when a candidate is owned by an unfinished install operation, Updates continues that operation so the pipeline's preflight, setup readiness and browser canary all still apply. The promotion boundary enforces this for every caller: it refuses a candidate an unfinished install operation owns (answering with the operation id), and it runs the instance-wide workspace preflight for any promotion, whatever created the candidate. Expanded authority needs fresh workspace consent before the check can pass. Rollback, pin and uninstall keep their existing package operations, and plugin data is kept unless deletion is requested explicitly.

A durable operation outlives the page: opening a plugin's detail restores the unfinished operation the server recorded (matching version first, otherwise the newest), so an operator who reloaded or stepped away can continue or cancel it instead of losing it. Watching is not resuming: a paused, blocked or retryable-failed operation is advanced through the owner-authorized retry (which revalidates setup, consent and evidence server-side) before the UI polls again, and a running operation is only watched. Failures that cannot progress show their message instead of a spinning check. A setup pause is reported as `resumable` and rendered as Continue, and completed operations reconcile the running plugin runtime so enabled code starts, disabled code stops and an update replaces the sandbox.

Every mutation the views perform — enabling, disabling, removing, rolling back and completing an install — emits the workspace plugin reconciliation signal the runtime already listens to. The UI never leaves a mutation's effect waiting for the next reload.

Resuming an installation runs its browser canary in the operation's recorded workspace, even when the administrator's Chat session currently uses another workspace. Permission review and runtime evidence remain bound to that installation's workspace.

## Installation failures and support reports

Discover and Updates explain recorded acquisition failures with recovery guidance,
the plugin version and target workspace. Retry/Continue is offered only when the
server marks the operation retryable; setup pauses link to the setup page. Use
**Manage installed plugins** to check the selected package and workspace activation.
Successful acquisition means the package was installed, not that its first action
has been exercised successfully.

**Technical details → Copy diagnostic report** copies an explicit allowlist:
operation ID, plugin ID, version, workspace ID, status, stage, failure code,
retry/setup flags and timestamp. It excludes raw exception messages, URLs,
credentials, settings and plugin content. Review the identifiers before sharing.
If clipboard access fails, the displayed report can be copied manually.

Server acquisition logs include the same operation ID and structured failure code.
Unexpected step failures log exception type and stack frames, omitting exception
text, and return a generic support message. `already-installed` and
`grant-review-required` identify expected duplicate and permission-review failures.

Requests rejected before an operation is available show session, administrator
access or rate-limit guidance instead of raw HTTP exception text.

## Permission consent

A release that asks for authority cannot install, canary or be promoted until the workspace has recorded explicit consent. The detail view lists the exact `requestedGrants` from the signed release metadata, requires an explicit approval, and persists it with `POST /api/admin/plugins/packages/{pluginId}/grants` before the install operation starts. The server never takes the requested set from the caller: it reads the staged candidate's own manifest when one exists and otherwise re-derives it from the signed release metadata, so approval can only narrow what the release asked for. An update that expands authority leaves the existing review stale, which blocks the promotion until consent is recorded again.

## Member access

Browsing needs only a workspace session. Installing needs an owner or super admin, so a member sees the detail and a copyable administrator request link instead of an install action. There is no ticket system and no misleading purchase step.

The request link is a supported deep link: `/?dashboard=marketplace&plugin=<pluginId>`. Opening it opens the dashboard's Marketplace app and selects that plugin, so the administrator lands on the request instead of the catalog.

## Diagnostics

`GET /api/plugins/diagnostics` returns a redacted report for support: host and plugin API versions, mode, the capability declaration, marketplace configuration state and accepted advisory position, per-plugin digests/trust/startup status, installed extension versions and acquisition operation ids with failure codes. Plugin settings values, connection names and secrets, message and document content, credentials, headers and signed URLs are never included, and the report states what was omitted.

## Related

- [Trusted Registry Acquisition](./trusted-acquisition) — the install pipeline, advisories and recovery.
- [Portable Containment and Setup](./portable-containment-and-setup) — the sandbox the client packages run in.
- [Portable Profile](./portable-profile) — what a marketplace package may be.

## Update checks and version pins

Updates discovers newer releases before staging them, in semantic version order. It checks signed engine compatibility and quarantine state, then the signed-in user's linked Library coverage for paid releases. Acquisition rechecks authority, coverage and setup before promotion.

An administrator can pin discovery to an exact release with `POST /api/admin/plugins/update-pin`, using `{ "pluginId": "or3.model-compare", "version": "1.0.0" }`; send `version: null` to remove it. Pins apply across the instance and persist under the extensions directory. This controls update discovery; an explicitly requested manual acquisition still requires its normal approval.

## Publisher listing help

The central marketplace submission editor provides information buttons beside
listing labels. Hover, focus with the keyboard, or tap to read an explanation.
Support URL is a public HTTPS help page; Privacy URL explains the plugin’s data
use and removal, including when it does not collect data. External costs names
any required paid services outside the marketplace price.

Reviewed releases declare their SPDX license in the V2 manifest’s `license`
field. The host preserves this bounded publisher metadata while continuing to
reject undeclared V2 fields; the registry checks the license expression when
reviewing the submission.
