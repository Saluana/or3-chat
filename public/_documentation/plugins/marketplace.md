# Native Marketplace

Developers publish through the central marketplace's **Developers → Submissions**
page. Select the built `.or3pkg` or `.zip` package and its matching source
`.tar.gz` or `.zip` archive, then create a draft. Ordinary ZIP directory
entries are accepted; selecting the same archive for both fields is rejected
with a specific error. If the page loses the create response after the draft
was saved, it refreshes **Your revisions** and opens the new draft; a retry
with the same finalized uploads returns that draft instead of creating a new
revision. Complete the draft's category and support/privacy links before
submitting it for review.

Dashboard > Marketplace is the user-facing place to find, install and manage plugins from the configured marketplace registry. It is a dashboard app like the Workspace manager: it reuses the existing navigation, theme and components, has no iframe and has no central-site sign-in.

Discover shows site-approved plugins, 24 matching plugins per page. Use **Next** and **Previous** to browse the rest; a new search starts on page one. An empty list means the site administrator has not approved a release for discovery yet.

Discovery works on any instance. Installing requires an OR3 Cloud profile with a configured registry — a static or local build shows that installation is unsupported instead of hiding the surface.

Admin > Plugins has a **Site catalog** for system administrators. Browse the configured registry, inspect a signed exact release, and choose **Approve for this site** before it appears in Dashboard > Marketplace. **Hide from catalog** removes it from discovery and blocks new acquisition or enablement; it does not disable workspaces already using it. Changing the approved version requires a fresh review. A buyer's Library purchase does not replace site approval or workspace permission review.

To restore discovery of an older version that is already installed, use **Review installed version for site catalog** on its Admin > Plugins card. The server verifies that exact signed release again. A damaged selected package can still be disabled for one workspace or through a reviewed workspace rollout; enablement waits until a verified version is selected.

Admin > Plugins also includes a **Browse Marketplace** link to the dashboard. Sign in
with a regular Chat account: the system admin login is a separate session and
does not make authenticated dashboard apps visible to a guest.
If you are signed in to Chat and separately signed in as system admin, Installed
shows the site management actions allowed by that admin session even if your
Chat account has no deployment-admin grant.

Installed V2 packages are detected across the instance, even in workspaces where
they are disabled. The package bytes and selected version are site-wide; the
**Enable** action and permission review are workspace-scoped. Use **Installed**
to activate an existing package in another workspace, then use **Admin > Plugins >
Review selected permissions** if that workspace has not reviewed the selected release.
If an update candidate is staged, **Review candidate permissions** reviews it separately.
The review checks the exact package digest and signed authority before approval.
Clicking Install again does not create a second copy. After installation, system administrators can choose **Enable workspaces** on the same plugin detail in Dashboard > Marketplace, or **Enable or disable workspaces** in Admin > Plugins. Preview a selected set, all existing workspaces, or new workspaces only. The preview shows the exact release, permission authority, setup blocks, and how many workspaces will change. Applying it records each workspace result in a resumable operation; reloading the page or closing the browser leaves the completed results intact. **Continue** advances remaining work, **Retry unresolved** rechecks blocked/failed workspaces, and **Cancel remaining** keeps already completed work. Use **Show blocked and failed** to find unresolved workspaces across the full rollout without paging through successful results. A future-workspace default is saved separately and remains saved if the existing-workspace batch is cancelled. A workspace needing setup stays disabled until configured.

If plugin setup fails while a workspace is created, creation still succeeds. The admin workspace page records the creation-time warning and links to the exact plugin rollout when one exists. A slow provider write also returns the created workspace after eight seconds with that rollout link; the write may still finish afterward. Check the rollout's current result before retrying; creating another workspace is not a repair step.

If a provider write takes more than eight seconds, the rollout shows that the batch is still applying. Use **Refresh progress** before continuing or cancelling. The server keeps the plugin operation lock until the write settles and then saves its result; a pending response does not mean the write was canceled. Refresh also reports a later request failure and re-enables recovery actions. A saved future default remains visible even if its rollout journal was interrupted before the workspace batch began.

The selected package version is shared by all workspaces. **Updates** shows the working version alongside a proposed release, the number of enabled workspaces affected, changes in requested access, and the previous version available for a safety-checked restore. Deployment permission approval is bound to the enabled-workspace set measured at review; if that set changes, refresh the review. The approval covers every enabled workspace and the reviewing admin's workspace, even when that admin workspace is disabled; it does not enable a disabled workspace. The approval runs in bounded workspace groups and reports partial failures so the same release can be retried. A failed candidate check leaves the working version selected. A blocked promotion lists affected workspace IDs and links to their setup or review context. Approving a different site release pauses any new-workspace default; after the update, review and enable the default again with **Enable workspaces**. Reloading the page can resume a recorded install operation; the guide keeps its exact plugin, version and workspace context.

After enabling or updating, use **Run check** in Installed for the selected workspace. It refreshes server package status and observes the exact package digest in this browser for up to 30 seconds. “Enabled; browser check pending” means no matching activation was observed here; it does not undo installation or say anything about unopened workspaces. **Open** and **Run check** are recovery actions. The check does not run chat workflows or call a paid model. A failed required pane/sidebar contribution is shown as a failure; optional contribution problems are reported separately.

Open the plugin's **View details** page and choose **Restore previous version**. It first checks the retained release against current trust, dependency and setup rules, and checks every currently enabled workspace for permission, dependency and state compatibility. The review names the exact versions and can expand the affected workspace IDs. If the enabled set changes after review, the restore is refused and must be reviewed again. Restoring changes the shared code selection while preserving workspace enablement and plugin data. Runtime readiness still needs a browser check afterward. If the restore is refused, the current version stays selected. A workspace rollout completed before restore remains in its history; restore does not reverse those workspace choices.

Source-configured `extensions.plugins.defaultEnabled` still seeds source plugins in newly created
workspaces only; it does not change existing workspaces or bypass site policy for a marketplace plugin. Candidate preparation
also refuses the already-current package without changing its pointer.

For enabled portable packages, **Open** opens the plugin's running dashboard
surface. **Configure** opens the Marketplace dashboard's Configure page, with a
back button to the plugin detail, Installed, or Updates page that opened it; the direct `/plugins/<pluginId>/setup` route remains
available for deep links. A saved setup link stays bound to its workspace, release and pending install operation. If any of those changed, reopen Configure from Marketplace rather than using the old link. Permission approval and acquisition also check that the active workspace still matches the one displayed during review. Disabled packages must be enabled first.
The instance also needs `OR3_PLUGIN_MODULE_LOADER_V2_ENABLED=true` and the target
workspace must be included in `OR3_PLUGIN_MODULE_LOADER_V2_WORKSPACE_IDS` when that
allowlist is set. A stored or enabled package alone does not establish runtime
eligibility. The loader still enforces the package's approved workspace grants.

The current portable profile exposes dashboard and command-palette contributions.
It does not replace legacy sidebar, workspace-pane, chat-tool or reminder
integrations. Tasks 0.2.0 is a portable task-list surface, not a feature-complete
migration of the legacy Tasks plugin; legacy source and data remain separate.

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

- `GET /api/plugins/marketplace/catalog` — browse the locally approved catalog through the local server (search, category, tag, page, pageSize). Returns `{ configured, catalog }`; `configured: false` means this instance has no registry.
- `GET /api/plugins/marketplace/{pluginId}` — one published plugin's public detail.
- `POST /api/plugins/marketplace/preflight` — the install assessment: `{ pluginId, version?, clientEngine? }` (`clientEngine` is the browser engine the page detected, used for profile qualification).
- `POST /api/admin/plugins/acquisitions` — start the install (resource documented in [Trusted Registry Acquisition](./trusted-acquisition)).
- `GET /api/plugins/diagnostics` — the redacted support report (owner only).

System-admin routes under `/api/admin/plugins/site-catalog` browse and approve signed releases. Routes under `/api/admin/plugins/rollouts` preview, start, continue, retry, cancel and inspect a bounded workspace operation. These routes require the separate system-admin session. The selected version is shared by all workspaces; enablement and consent remain workspace-specific.

The browser never talks to the registry: the local server is the configured trusted client, so a self-hosted instance does not need a generic URL proxy and the registry never sees a session cookie.

An administrator approving a buyer's Library install request supplies its `installRequestId` with the exact plugin, version and target workspace. The server rechecks that the request has not expired, the buyer still belongs to the live workspace, and the buyer's original Library link still names the same marketplace account. The resulting operation records only request/account/link identifiers. Once the administrator starts the operation within the seven-day window, that recorded operation may be retried, including after a cancellation or request expiry, only while the buyer still belongs to its original live workspace. Retry uses the same buyer binding and revalidates the original live link before any covered artifact fetch; disconnecting or changing the link prevents further covered downloads. Ordinary administrator installs continue to use the acting administrator's own Library link.

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

Installing goes through the durable acquisition operation (see [Trusted Registry Acquisition](./trusted-acquisition)). The UI follows the recorded stage and mirrors the operation's own retry/cancel rules. A first install enables the plugin for the installing workspace; an update never changes enablement, so a workspace that deliberately disabled a plugin keeps it disabled.

Installed and running are separate facts. **Installed** is the instance-selected
package (version plus exact package digest, shown in expandable details).
**Running** means this browser and workspace actually observed that exact
package start, with its sidebar, pane and tool registrations settled. A
matching version with a different digest never counts as running. After an
install or update completes, the UI reconciles the runtime and observes the
activation for up to 30 seconds before reporting success: when nothing
confirms in time it shows **Installed; activation not confirmed**, keeps the
server installation intact, and offers confirmation retry plus diagnostics
instead of reinstalling. When the activation itself fails (blocked or
stopped), the status names the failure instead of claiming running, with the
same retry and diagnostics. A late matching activation may still update the
visible status; it never starts another acquisition.

A release that declares a contained client runtime needs a real browser canary. The host issues a single-use ticket bound to the plugin, package digest, workspace, client id and nonce; the admin's browser performs a hidden activation of the candidate's exact bytes in the contained sandbox, re-hashes them and reports the outcome. Until that evidence exists the operation stays pending with `client-canary-pending`, and the UI completes the check and retries the same operation. A server-side check alone never substitutes for it.

Updates shows two things: staged candidates, and a newer site-approved release found by an explicit catalog check ("Check for updates"). A newer public version first needs approval in Admin > Plugins. The check resolves the approved exact release through the same trust pipeline as acquisition, so a quarantined, changed or unresolvable release is reported as blocked instead of advertised. The review shows the current and proposed versions, the number of enabled workspaces affected and the current version that becomes the potential restore target. Reviewing an available update starts the ordinary acquisition operation for that exact release — it never promotes directly — which is what surfaces the authority and setup differences. Checking for updates never stages anything by itself.

Updates are recorded candidates on the same lifecycle, and an update a previous install recorded is resumed rather than re-implemented: when a candidate is owned by an unfinished install operation, Updates continues that operation so the pipeline's preflight, setup readiness and browser canary all still apply. The promotion boundary enforces this for every caller: it refuses a candidate an unfinished install operation owns (answering with the operation id), and it runs the instance-wide workspace preflight for any promotion, whatever created the candidate. The selected code version is shared across enabled workspaces. The check lists new access from the signed authority; unchanged access needs no repeated approval, while expanded access takes one explicit site-administrator approval for every enabled workspace. If a workspace cannot complete setup or state checks, the update stops before promotion, names the workspace and leaves the selected version running. Switch to that workspace and complete its candidate setup; its values are saved under the same pending update, and Continue rechecks every affected workspace. Rollback reviews the exact current and previous releases and checks consent, setup and state readability in every enabled workspace before changing the shared selection. A changed pointer or enabled-workspace set makes the review stale; refresh and resolve the named blocker. It preserves plugin data and workspace enablement. Pin and uninstall keep their existing package operations. Uninstall disables the plugin in every live workspace before clearing the instance-wide selection; plugin data is kept unless deletion is requested explicitly. If a workspace write fails, the pointer remains selected and any workspaces already disabled stay disabled; retry after fixing the failing store.

A durable operation outlives the page: opening a plugin's detail restores the unfinished operation the server recorded (matching version first, otherwise the newest), so an operator who reloaded or stepped away can continue or cancel it instead of losing it. Watching is not resuming: a paused, blocked or retryable-failed operation is advanced through the owner-authorized retry (which revalidates setup, consent and evidence server-side) before the UI polls again, and a running operation is only watched. Failures that cannot progress show their message instead of a spinning check. A setup pause is reported as `resumable` and rendered as Continue, and completed operations reconcile the running plugin runtime so enabled code starts, disabled code stops and an update replaces the sandbox.

Every mutation the views perform — enabling, disabling, removing, rolling back and completing an install — emits the workspace plugin reconciliation signal the runtime already listens to. The UI never leaves a mutation's effect waiting for the next reload.

Resuming an installation runs its browser canary in the operation's recorded workspace, even when the administrator's Chat session currently uses another workspace. Permission review and runtime evidence remain bound to that installation's workspace.

## Installation failures and support reports

Failed and blocked results are saved history: refreshing does not retry them.
Cancel is offered only for pending, running or paused operations; a running
cancellation shows **Cancel requested**, and request failures appear in the view.
Older failures are no longer restored after a newer successful installation in
the same workspace. Retry/Continue remains available when the server allows it.

Portable sidebar surfaces display the main plugin view when the package does not
provide separate navigation. An empty active view offers **Restart plugin**, which
starts a fresh contained activation and reports startup failures.

Discover and Updates explain recorded acquisition failures with recovery guidance,
the plugin version and target workspace. Retry/Continue is offered only when the
server marks the operation retryable; setup pauses link to the setup page. Use
**Manage installed plugins** to check the selected package and workspace activation.
Successful acquisition means the package was installed, not that its first action
has been exercised successfully.

On **Installed**, choose **Run check** for the current workspace. The check
reconciles the plugin runtime and waits up to 30 seconds for this browser to
observe the exact selected package digest. It reports the checked workspace,
time, package readiness, workspace enablement, permission and setup state, and
browser activation separately. “Not observed” means this browser did not see
the plugin start in time; it does not claim the plugin failed in every
workspace. Run check never submits a workflow or paid model request. Optional
contribution failures are listed without hiding a successful activation.

**Technical details → Copy diagnostic report** copies an explicit allowlist:
operation ID, plugin ID, version, workspace ID, status, stage, failure code,
release digests (release, archive, package tree, manifest, authority),
observed runtime state and digest, retry/setup flags and timestamp. It excludes
raw exception messages, URLs, credentials, settings, activation handles and
plugin content. Review the identifiers before sharing.
If clipboard access fails, the displayed report can be copied manually.

Recovery limits: an update that fails before promotion leaves the previous
package selected; a failure after promotion shows the actual selected and
observed identities rather than assuming a rollback happened. Roll back is
offered only when a previous selection exists. **Restore previous version**
first reviews the exact current and previous version and all enabled
workspaces, then rechecks consent, setup and state compatibility before the
shared package selection changes. It preserves plugin data and workspace
enablement; an incompatible workspace blocks the restore instead of silently
switching it to old code.
Cancelling is impossible after promotion has committed.

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

Signed-in members can also view the packages installed on the instance and see
whether each is enabled and available in their workspace. This read-only list
uses the workspace-scoped runtime manifest. Administrators with the required
grant can enable or disable packages for a workspace; site administrators can
also uninstall or roll back packages. If the installed list cannot load, the
Marketplace shows a padded error with a retry action and plain-language
session guidance instead of an API error.

Discover shows one retryable message when the catalog and installed-state
requests fail together. A missing HTTP response is described as a connection
problem because account access could not be checked; 401 and 403 responses
instead explain session or workspace access. Failed catalog requests do not
show the empty-results message or raw API URLs.

The request link is a supported deep link: `/chat?dashboard=marketplace&plugin=<pluginId>`. Opening it opens the dashboard's Marketplace app and selects that plugin, so the administrator lands on the request instead of the catalog. Internal Installed and Updates links also bind the workspace; a link opened in another workspace pauses its review until the administrator switches back. The admin setup action adds `setup=1` and opens Configure for that plugin after the workspace check.

## Diagnostics

`GET /api/plugins/diagnostics` returns a redacted report for support: host and plugin API versions, mode, the capability declaration, marketplace configuration state and accepted advisory position, per-plugin digests/trust/startup status, installed extension versions and acquisition operation ids with failure codes. Plugin settings values, connection names and secrets, message and document content, credentials, headers and signed URLs are never included, and the report states what was omitted.

## Related

- [Trusted Registry Acquisition](./trusted-acquisition) — the install pipeline, advisories and recovery.
- [Portable Containment and Setup](./portable-containment-and-setup) — the sandbox the client packages run in.
- [Portable Profile](./portable-profile) — what a marketplace package may be.
- [Local Development Candidates](./local-development) — testing unpublished candidates without publishing.

## Update checks and version pins

Updates discovers newer releases before staging them, in semantic version order. It checks signed engine compatibility and quarantine state, then the signed-in user's linked Library coverage for paid releases. Acquisition rechecks authority, coverage and setup before promotion.

From an installed plugin's detail, **View updates** opens the Updates page. **Check for updates** runs the check and requires a separate system-administrator session. Missing administrator access and connection failures show a recovery message without exposing the underlying API request.

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

## Recovery and management safety

Discover restores operations only for the active workspace. An unfinished operation
owned by another workspace is labelled with that workspace; switch there to resume
or cancel it. Changing selection detaches browser polling and canary follow-up
without cancelling the server operation. Catalog results belong to the latest search.

Interrupted operations offer Continue and Cancel. Transient activation transport,
server and malformed-response failures offer **Retry plugin startup** on the open
surface. Retry refreshes the server manifest, repeats authorization and verifies
package identity before starting. Policy and digest refusals remain blocked.
Typed drafts survive a temporary missing view during restart, but a different logical
view or workspace clears them.

A saved management change whose list refresh fails is reported as saved with a
refresh error. Retained rows are stale and further mutations are refused until refresh
succeeds. Authorization loss clears the protected cached list.

Uninstall first asks to remove the named version from **every workspace**. Cancel
and use Disable for a workspace-only change. Confirmation binds the selected package
digest; the server refuses a changed selection before disabling or removing it.
Package bytes and saved data remain retained.

The uninstall API requires `expectedPackageDigest` in the body of
`POST /api/admin/plugins/packages/{pluginId}/uninstall`. A changed selection
returns HTTP 409 without disabling the workspace or clearing the pointer.


## Marketplace release history

The public marketplace plugin page shows 100 releases at a time. Select **Load
older releases** to continue through history. Exact-version signed metadata and
source retrieval are independent of this page limit. Releases are ordered by
publication time, with strict SemVer precedence breaking ties; build metadata
does not affect precedence. Publisher support and privacy links show their
external destination hostname and open without sending a referrer.

For catalog API consumers, detail responses include `nextReleaseCursor`.
Request `GET /api/v1/catalog/:pluginId/releases?after=<cursor>` to receive
`releases` and `nextCursor`; a null cursor marks the end.
