# Personal Library link

Dashboard > Library connects one **local user** on this server to that person's marketplace account. It exists so a self-hosted OR3 can read a personal marketplace Library and download entitled releases without sharing a marketplace login, cookie or purchase history with anyone else on the host — including other local users.

While linked, the page lists the account's acquired releases (version, acquisition date and coverage window) and plugin update coverage read through this server's own credential. An administrator can select **Install or restore** for an exact acquired version, or review newer releases for a covered plugin. Both actions open Marketplace Discover and use its normal preflight, permission review, verified acquisition and quarantine checks; nothing is downloaded merely by viewing Library. An already installed plugin links onward to the Marketplace Updates page. A local user without installation authority selects **Request installation** on an acquired release. The server records that buyer's local user, linked marketplace account, exact release, archive digest and workspace in a credential-free request with a seven-day review window. The site administrator sees it in their own Library, switches to the requested workspace, then explicitly reviews the exact release in Marketplace and installs through the normal verified pipeline. The pipeline uses the buyer's server-held Library credential only for that request; the administrator never receives the token. A marketplace purchase a user already owns is shown as **In your Library** on the plugin page instead of a Buy action, matching the checkout rule that refuses a duplicate purchase.

The link belongs to the signed-in local user. Another local user reads a different binding and can never see or use the first user's link, and matching email addresses never merge two accounts. The Library clears old purchase results as soon as the local user or linked marketplace account changes, discards late responses from the old identity, and offers a retry if the current account's purchase fetch fails.

## Configuration

| Variable | Meaning |
| --- | --- |
| `OR3_MARKETPLACE_REGISTRY_ORIGIN` | Canonical marketplace origin. Must be `https://` with no path. Without it, linking is unavailable. |
| `OR3_LIBRARY_LINK_SECRET` | At least a strong random string; AES-256-GCM key for the stored polling secret and linked credential. Without it, linking is unavailable and nothing is stored. |

The key is a runtime secret: containers translate `OR3_LIBRARY_LINK_SECRET` into `NUXT_ADMIN_LIBRARY_LINK_SECRET` at startup, so a prebuilt image never bakes it into a layer. Rotating the key makes existing bindings undecryptable; the affected user is asked to reconnect, which is the intended failure mode.

Binding files live under `<OR3_ADMIN_DATA_DIR>/library-links/<localUserId>.json`, are owner-only (`0600`) and contain only ciphertext. The per-deployment binding identity is persisted once at `<OR3_ADMIN_DATA_DIR>/deployment-identity`, so recreating a container (a new hostname) does not invalidate links while the data volume survives.

## The pairing flow

1. The local user presses **Connect marketplace account**. The local server asks the marketplace for a pairing and keeps a high-entropy polling secret; the browser receives only the short comparison code, its expiry and the canonical verification link. Starting again replaces an earlier pending attempt only by presenting that attempt's polling secret, so one user of a host can never cancel another user's approval.
2. The user opens the marketplace, signs in there (top-level, on the canonical site) and approves the code. The marketplace shows the claimed host label and origin as *untrusted context* and lists exactly the two scopes below. It never contacts this server.
3. This server polls with its secret. Approval and secret possession are checked together, once, and the single successful poll receives an opaque credential with a fixed 90-day lifetime — never a refresh path, and no plaintext recovery if the response is lost (the user simply connects again).
4. The credential is encrypted locally, bound to the initiating local user and instance, and is never exposed to the browser, to plugin state or to logs.

## Authority

A link carries exactly:

- `library:read` — read the linked account's Library.
- `downloads:acquire` — download releases that account is already entitled to.

It never carries checkout, billing, publishing, review, payout, account-settings or local permission approval. Those handlers require a real marketplace session and reject a linked credential outright.

Installed plugins keep working when a link expires, is revoked or is unreachable: the link is acquisition authority, not execution authority.

## Covered (paid) acquisition

A paid release is never downloadable from the public catalog path: the marketplace refuses it with `coverage-required`. The host distinguishes that refusal from an expired signed URL and, in the same acquisition operation, asks the marketplace to record the acquisition for the exact release using the *initiating local user's* own encrypted link, then downloads the bytes from the entitled artifact path with the credential kept server-side — never in browser state, a URL or plugin state. Everything after the download is unchanged: the same signature, advisory, archive, tree, consent, setup and promotion checks run, and a covered install finishes through the ordinary pipeline.

* Acquisition is recorded idempotently, so a retry after a partial download or a page reload never asks the buyer to purchase again.
* Another local user cannot use someone else's link: the credential is per-user and per-instance, and an operation only ever resolves the acting user's own binding.
* Free and first-party releases keep installing anonymously on the public path; the linked route is only consulted for a release the marketplace actually refuses.
* Without a link (or with the credential unresolved) the operation stops with a retryable `coverage-required` failure that says to connect the Library account, instead of retrying a public URL forever.
* Bytes already acquired and installed keep working when the marketplace is unreachable.

## Disconnect, rotation and restore

- **Disconnect** in Dashboard > Library stops this server first (the local record is revoked immediately) and then asks the marketplace to revoke the credential. If the marketplace is unreachable the local stop still holds; while the page is open the confirmation is retried on its own schedule, and the pending state is reported until central confirms it. A credential is only forgotten once central has revoked it or proven it already unusable.
- **Connect again** rotates the credential: the replaced credential is revoked immediately and the new one has its own fixed lifetime.
- **Restore**: after the local server is restored from a backup, the first status check re-verifies a linked credential against the marketplace. A revoked, expired, restricted or deleted authority ends the link locally and asks the user to reconnect. A network failure never ends a working link.
- **Account deletion or restriction** on the marketplace revokes the links for that account; a later unban still requires a fresh pairing.

## Routes

All are authenticated and `no-store`, scoped to the signed-in local user.

- `GET /api/plugins/library/link` — the caller's own link state. Performs a due poll of a pairing attempt and a scheduled re-verification of a linked credential.
- `GET /api/plugins/library/entitlements` — the linked account's purchased releases (Plus status, coverage windows, acquired versions) for the Library page. An unlinked user gets an empty listing without a marketplace request; a credential central already refused ends the link locally.
- `POST /api/plugins/library/install-requests` — request administrator review of one exact acquired release in the caller's current workspace. The server checks the caller's current Library link and entitlements and stores only identifiers and a digest, never credentials.
- `GET /api/admin/plugins/library-install-requests` — site administrator's bounded queue of buyer requests and their recorded acquisition status.
- `POST /api/plugins/library/link` — start or restart pairing (rate limited per user).
- `POST /api/plugins/library/link/disconnect` — stop this server's use of the credential and confirm revocation.

Responses never contain the polling secret, the credential or any other secret material.

## Diagnostics

If linking is unavailable, the page names the missing configuration instead of failing silently. A failed pairing always leaves a terminal, explained state (`denied`, `expired`, `lost`) with a "connect again" action; nothing is retried forever.
