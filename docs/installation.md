# OR3 Cloud installation and operations

If you are choosing a setup route, start with [Start here](start-here.md).

The supported self-hosted distribution is `@or3/cloud`. It runs the same
versioned OR3 container on a local machine or on a single VPS, so the VPS does
not need an OR3 source checkout, application `node_modules`, or a local Docker
build.

The supported production profile is Basic Auth + SQLite sync + filesystem
storage. Basic Auth protects OR3 itself; each user still needs an OpenRouter
account or API key to use AI models.

Managed Cloud is intentionally a fixed profile. Optional Clerk, Convex, S3,
custom provider selection, source rebuilds, and remote Connect configuration
are advanced/source paths rather than setup steps for a managed deployment.

## Prerequisites

Install Docker Engine and Docker Compose v2. Node.js 20+ is needed only for
`npx` to download and invoke the operator CLI. Verify:

```bash
docker version
docker compose version
node --version
npx --version
```

The OR3 container owns application dependencies. Do not run `npm install` in
the deployment directory.

## Supported architectures

OR3 publishes container images for `linux/amd64` and `linux/arm64`. The CLI
checks the published image manifest against the host architecture before it
writes any deployment state, so an unsupported host fails with a plain-language
message instead of a half-initialized deployment. If your machine is not
supported, install on a supported machine or wait for a release that covers your
architecture.

## Run locally

This keeps OR3 private on the local machine and does not install Caddy:

```bash
npx @or3/cloud init --local
```

The command asks once for the administrator email, generates a bootstrap
password, and writes it to a mode-`0600`
`.or3-initial-credentials` file. Save it in a password manager, then remove
that file. The same credentials enable the OR3 admin panel at `/admin`. Open
`http://127.0.0.1:3000`; use `--port 3100` if needed.

For automation, pass `--admin-password-file /path/to/password` (preferred) or
`--admin-password 'A-valid-password'`. The file option avoids putting a secret
in shell history and the CLI never prints either value.

Useful commands run from the deployment directory:

```bash
npx @or3/cloud doctor
npx @or3/cloud backup
npx @or3/cloud update
npx @or3/cloud rollback --yes
npx @or3/cloud recover
npx @or3/cloud status
npx @or3/cloud logs --tail 200
npx @or3/cloud start
npx @or3/cloud stop
npx @or3/cloud restart
```

Registration is invite-only. The bootstrap owner is the only account created
on first sign-in; anonymous visitors cannot register. After signing in, invite
additional people through the in-product workspace/admin invitation flow. The
owner password and `/admin` password are separate credentials after setup.

The immutable managed image keeps bundled plugins and themes, but hides custom
upload/install controls because it cannot rebuild and restart trusted source.
Use the source-development path for extensions you own and can rebuild.

## Public VPS with Caddy

Use a Linux VPS with at least two CPU cores, 4 GB RAM, and 20 GB disk. Create
an `A` record such as `cloud.example.com` pointing at the VPS before starting
public mode. Open TCP 22, 80, and 443 in the VPS provider firewall; UDP 443 is
optional for HTTP/3.

The installer never changes the host firewall. Use exactly one firewall
manager. If the host uses nftables, add equivalent rules to the existing input
chain before its final drop/reject rule:

```nft
ct state established,related accept
iif lo accept
tcp dport 22 accept
tcp dport { 80, 443 } accept
udp dport 443 accept
```

Validate and apply your existing ruleset from a provider-console session:

```bash
sudo nft -c -f /etc/nftables.conf
sudo nft -f /etc/nftables.conf
```

If the host uses UFW instead, allow `OpenSSH`, `80/tcp`, `443/tcp`, and
optionally `443/udp`. Do not enable UFW alongside a directly managed nftables
policy.

Start the public deployment:

```bash
npx @or3/cloud init --public \
  --domain cloud.example.com
```

Caddy owns ports 80 and 443 and proxies to OR3 over the private Compose
network. OR3 remains bound to `127.0.0.1:3000`; there is no public firewall
rule for port 3000.

Verify:

```bash
npx @or3/cloud doctor
curl --fail --show-error 'https://cloud.example.com/api/health?deep=true'
```

Open the domain, sign in, send a test message, and upload a small file.

The Caddy proxy redirects HTTP to HTTPS and adds HSTS (HTTPS only),
`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and a minimal
`Permissions-Policy`. Local mode has no Caddy and remains usable over loopback
HTTP.

### Cloudflare

For the first deployment, use DNS-only (grey cloud) until Caddy has obtained a
certificate. If you enable the Cloudflare proxy afterward, set SSL/TLS mode to
**Full (strict)**. Do not use Flexible mode; it can create HTTPS redirect
loops. Keep origin TCP 80 available for Caddy redirects and ACME challenges.

If you later restrict the origin firewall, allow Cloudflare's current published
IP ranges rather than copying an old list into this guide.

### Tailscale

Local mode is already loopback-only. To expose it privately through Tailscale,
use your own Tailscale Serve configuration to proxy to
`http://127.0.0.1:3000`; do not expose OR3 directly on a Tailscale IP without
matching its trusted-origin and HTTPS settings. The Cloud CLI intentionally
does not modify Tailscale state.

## Updates

Run updates from the managed deployment directory:

```bash
npx @or3/cloud update
```

The CLI records the exact image version and digest, stops OR3 briefly to make a
consistent `/data` backup, pulls the new image, waits for Compose and deep
health, and keeps the previous image/data snapshot as the immediate rollback
point. If the new version fails deep health, it restores the previous version
and snapshot automatically.

To target a specific published version:

```bash
npx @or3/cloud update --to <exact-version>
```

Do not use `docker compose down --volumes` during normal operation or upgrades;
that deletes the authentication database, SQLite data, and uploaded files.

## Backups and recovery

Create a verified archive:

```bash
npx @or3/cloud backup
```

The archive contains account, conversation, uploaded-file data, and protected
credential state. Treat it like a password database: keep it owner-only and
copy it to encrypted, access-controlled off-host storage (for example an
encrypted backup volume or an access-controlled object store). A same-host
snapshot does not protect against disk loss. Restore requires explicit
confirmation:

```bash
npx @or3/cloud restore <backup-id> --yes
npx @or3/cloud rollback --yes
```

Rollback restores the data snapshot associated with the previous version and
can discard writes made after that update. After either operation, verify
login, a conversation, and a previously uploaded file.

Before destroying a deployment, make one verified export on a different
filesystem (for example, an attached backup disk). The destination must be a
new directory so OR3 cannot merge secrets into unrelated files:

```bash
npx @or3/cloud backup list
npx @or3/cloud backup export <backup-id> /mnt/or3-backups/<backup-id>
```

OR3 rechecks that export and its checksums before it allows an irreversible
purge. A same-filesystem copy is useful but cannot authorize data deletion.

```bash
npx @or3/cloud remove --purge-data --yes
```

Normal retention never removes a rollback or recovery backup. If you truly
need to override that protection, name the force explicitly:

```bash
npx @or3/cloud backup prune --keep 1 --force --yes
```

To rotate the owner and admin passwords, run
`npx @or3/cloud credentials reset --yes`. The operation is journaled before
it changes data; if the host is interrupted, run `npx @or3/cloud recover` to
replay and verify the intended credentials entirely inside the deployment.
The command rotates the owner and admin credentials separately and invalidates
their existing sessions; save the new values in a password manager.

If a command is interrupted, the deployment is intentionally locked. Review
`doctor` and the printed logs, then run `npx @or3/cloud recover`; it resumes the
recorded operation (or restores its recorded backup) and only clears the lock
after deep health passes. If the `.env` no longer matches the recorded target,
recovery refuses to guess and leaves the operation record for manual review.

## Adopt an existing generated deployment

Existing `create-or3-chat` projects are not overwritten. For the documented
Basic Auth + SQLite + filesystem profile, create a separate managed deployment:

```bash
npx @or3/cloud adopt \
  --from "$HOME/apps/or3-cloud" \
  "$HOME/apps/or3-cloud-managed"
```

Adoption inspects the source first, backs up `.env` and `/data`, preserves the
source directory, transfers data into a new named volume, and verifies deep
health before reporting success. Custom, Clerk/Convex, S3, or modified
provider layouts are refused before the source is stopped.

## Remote Connect scope

Remote OR3 Connect is withheld from this managed Cloud release. The
Cloudflare/domain/attestation operator flow and a disposable staging lifecycle
must pass before the production UI or beginner docs can offer it. Do not run a
generic `npx @or3/connect` command against a managed Cloud instance and do not
paste a URL/token workaround. To use an agent locally, run
`npx @or3/connect intern` on that computer once the matching package and
verified Intern release assets are published (see the [Connect release
status](https://github.com/Saluana/or3-intern/blob/main/docs/connect-release-status.md)).
Until then, do not substitute the older registry package; use the source
development path for Intern work. Add the resulting local Intern host through
Agents → Connection settings. The advanced source/operator reference is
[OR3 Connect](../public/_documentation/cloud/or3-connect.md).

## Troubleshooting

```bash
npx @or3/cloud doctor
```

The doctor checks Docker, Compose, file permissions, image/state consistency,
deep health, loopback binding, public DNS, and Caddy ports. It reports the
required nftables/UFW rules but never changes them.

If Docker cannot resolve `registry.npmjs.org` or GHCR while the host can, test
Docker DNS first:

```bash
docker run --rm busybox nslookup registry.npmjs.org
```

Correct Docker's resolver and retry. Do not delete the managed directory or its
named volume when a pull fails. Keep the `.or3-cloud/operations` record and
run the diagnostics command printed by the CLI.

## Developer/source installation

If you need editable application source, custom providers, or a non-default
backend, clone the repository and use the existing source-local wizard. That
path is for contributors and advanced deployments; normal local/VPS operation
should use `@or3/cloud`.
