# Your Library

**Dashboard → Library** shows plugin releases acquired by your marketplace
account. Connect that account to the local OR3 user you are signed in as, then
install an acquired release or request an administrator to install it.

The marketplace account and the local Chat account are separate. Connecting
Library links them for purchases and downloads; matching email addresses do
not merge accounts.

## Connect your account

1. Sign in to Chat and open **Dashboard → Library**.
2. Choose **Connect marketplace account**. Note the comparison code and open
   the verification link.
3. Sign in on the marketplace and compare the code before approving the link.
4. Return to OR3. When pairing completes, your acquired releases and update
   coverage appear.

Approval happens on the configured marketplace site. Your local server stores
an encrypted download credential; plugins and the browser never receive it.
Each local user has their own link. Another workspace member cannot use yours.

## Install an acquired version

Choose **Install or restore** on an exact acquired release. An administrator
reviews it through the ordinary Marketplace flow: site approval, compatibility,
permissions, setup, verification, and package checks still apply. Viewing Library
alone does not download or activate a plugin.

For an installed plugin, follow its link to **Updates** to see available covered
releases. A version's coverage window and acquisition date help explain which
updates the account can obtain. The marketplace shows **In your Library** for
an existing purchase instead of offering the same purchase again.

## Request installation

If you do not have installation authority, choose **Request installation** on
an acquired release. The request names the exact version and digest in your
current workspace and has a seven-day review window.

The site administrator sees the request in their Library, switches to the
requested workspace, and reviews the release in Marketplace. They never receive
your credential. The server uses your encrypted Library binding for that request
and rechecks your workspace membership and account binding before fetching paid
bytes. Keep the link connected until any covered download is complete.

An operation started within the review window can later be retried under the
same recorded request while the buyer still belongs to that live workspace and
the original link remains valid. A purchase never grants local installation
permission or bypasses the site's catalog policy.

## Disconnect or reconnect

Choose **Disconnect** to stop this server using the link immediately. If the
marketplace is unreachable, OR3 reports central revocation as pending and retries
confirmation while the page is open. Local access remains stopped.

A link lasts 90 days. Reconnect after expiry, revocation, or changing marketplace
accounts. Old purchase results clear when the local user or linked account
changes. Already installed plugins keep running when the link expires or is
unavailable: download authority and runtime permission are separate.

## Troubleshooting

| Problem | What to do |
| --- | --- |
| Linking unavailable | Ask the operator to configure the registry origin and Library encryption secret |
| Pairing denied, expired, or lost | Connect again and approve the new comparison code |
| Wrong purchases displayed | Check both the local Chat user and linked marketplace account |
| Purchase listing could not load | Use Retry; a connection failure does not remove an otherwise valid link |
| Coverage required during install | Connect the account that owns that release, then retry the same operation |
| Link stopped after backup restore | Reconnect if the marketplace reports it revoked or expired |
| Link stopped after secret rotation | Reconnect; the previous ciphertext can no longer be decrypted |

## Operator configuration

| Variable | Purpose |
| --- | --- |
| `OR3_MARKETPLACE_REGISTRY_ORIGIN` | Canonical HTTPS marketplace origin, with no path |
| `OR3_LIBRARY_LINK_SECRET` | Strong random secret used to encrypt pairing and download credentials |

Preserve the secret and the admin data volume across restarts. Containers map
it to `NUXT_ADMIN_LIBRARY_LINK_SECRET` at startup. Changing the key requires
users to reconnect. Encrypted user bindings live under
`<OR3_ADMIN_DATA_DIR>/library-links/`; the deployment binding identity is stored
under the same admin data root.

A Library link carries only `library:read` and `downloads:acquire`. It cannot
purchase, publish, review, approve local permissions, or manage billing.
[Runtime and security](/documentation/plugins/runtime-and-security) covers the installation trust
boundary; [Install and manage plugins](/documentation/plugins/install-and-manage) covers everyday use.
