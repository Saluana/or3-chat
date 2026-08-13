# OR3 Cloud

Install and operate a supported OR3 container deployment without cloning the
application repository or installing its dependencies on the host.

## Quick start: local machine

You need Docker Engine with Docker Compose v2 and Node.js 20 or later.

```sh
npx @or3/cloud init --local
```

The installer asks for the owner email, generates a bootstrap password, and
saves both values in the mode-`0600`
`or3-cloud/.or3-initial-credentials` file. It does not print the password.
Save the file in a password manager, then delete it. Open
[http://127.0.0.1:3000](http://127.0.0.1:3000) and sign in.

The published Cloud image supports `linux/amd64` and `linux/arm64` and uses
Basic Auth + SQLite + filesystem storage. The CLI checks the image manifest,
source/version labels, and then writes a digest-qualified image reference; it
also verifies the image of the running container before committing state.

## Run it publicly on a VPS

Before starting, point a domain at the VPS and allow inbound TCP ports `80`
and `443` in its firewall. Then run:

```sh
npx @or3/cloud init --public --domain cloud.example.com
```

OR3 Cloud uses Caddy to obtain and renew HTTPS certificates. It does not
change your DNS, firewall, Cloudflare, or Tailscale settings.
The managed public profile forwards its proxy-trust setting into Nuxt runtime
configuration so HTTPS API requests are not redirected back to themselves.

## Day-to-day commands

Run these from the deployment directory created by `init`:

```sh
npx @or3/cloud doctor
npx @or3/cloud verify
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

Run `verify` after every update and before declaring a deployment healthy. It
checks the managed image digest, deep provider health, Basic Auth sign-in,
session hydration, SQLite sync, a disposable filesystem upload/download/delete
cycle, both SQLite databases, volume ownership, proxy runtime settings, and a
bounded window of serious container logs. On a public VPS, require the real
HTTPS path (with no redirects) using `npx @or3/cloud verify --public`.
After changing the owner password in the app, pass the current credential only
through an owner-only file:
`npx @or3/cloud verify --public --verification-email owner@example.com --verification-password-file /secure/current-owner-password`.
Verification rejects cross-origin filesystem grants and unexpected methods or
headers, validates the storage ID before uploading, deletes its probe, and
revokes its temporary session even when a later check fails.

Do not run `docker compose down --volumes` on a normal deployment: it deletes
the application data. Use `backup` before an update or any destructive action.
When an adopted legacy deployment used a different container UID, `update`
rebuilds the data from its checksummed pre-update backup as the hardened
runtime user. It does not recursively rewrite file ownership in place, and a
failed migration restores the recorded legacy root owner and snapshot.
Updates also replace the generated Compose/Caddy files from the target CLI.
Those files are checksummed into the pre-update backup and restored on a failed
update, rollback, restore, or interrupted-operation recovery. Backups also
carry a deployment-local authentication tag, so an altered or foreign archive
cannot supply configuration or executable Compose assets. Every mutating
command holds one deployment-wide lease; do not delete `.or3-cloud` lock or
recovery files by hand.
Backup artifacts are allocated in that journal before archiving, fully
revalidated before success is reported, and safely removed by `recover` if a
hard interruption leaves an incomplete artifact. A standalone backup and a
failed adoption preserve whether the original app was intentionally stopped.
Initialization and adoption also fail closed unless Docker explicitly confirms
that the target volumes, project containers, and networks do not exist.
Docker architecture checks query the selected daemon, remote daemons skip
misleading client-host port probes, every Docker command has a deadline, and
streaming archive children are terminated as a process group on timeout.
Lifecycle commits fsync files and parent directories before/after rename.
Restore refuses pre-authenticated-asset backups instead of mixing an old image
with current Compose/Caddy files, and failed asset rollback retains any
recovery copies it could not reinstall.
Use owner/admin password files for noninteractive credential rotation. TTY
prompts suppress input, Docker receives only environment variable names in its
argument vector, and the admin credential file is committed with
write/fsync/rename so journal replay cannot encounter a truncated JSON file.
A successful rotation removes the obsolete `.or3-initial-credentials` copy.

The authentication key is intentionally not embedded in an exported archive.
Escrow an owner-only copy of `.or3-cloud/backup-auth.key` separately in an
encrypted secret store; put that key back in the recovered deployment before
restoring an off-host archive.
When selecting an exact version, run the matching CLI package, for example
`npx --yes @or3/cloud@0.1.39 update --to 0.1.39`; the CLI refuses mismatched
package and image versions so their generated assets cannot drift.
For a destructive purge, export a fresh backup to a new directory on another
filesystem first; `remove --purge-data --yes` verifies that export before it
will delete anything.

## Dashboard updates

New managed Linux deployments expose a **Dashboard Update** card only when a
local Linux Docker socket passes the CLI's disposable, exact-mount bridge
probe. Click **Check for updates**, then approve the exact latest release. The
card uses the same managed updater as the CLI: it makes a verified backup,
waits for deep health, and restores the prior release and data if the update
fails. Hosts that do not pass the probe remain CLI-only.

Release-check results, including the last successful latest version and a
bounded failure or compatibility reason, persist across page reloads and
operator restarts. Accepted asynchronous starts return HTTP 202; corrupt or
unavailable operator responses are reported separately from unsupported hosts.
While an update is active, the card announces state changes and polls every two
seconds, backing off on connection failures and stopping after 15 minutes or a
terminal result.

Once an earlier protocol-compatible release exists, the tagged release gate
also upgrades a disposable installation from it through this Unix API, proves
concurrent starts serialize, checks persisted data and deep health, and rolls
the deployment back.

The application container never receives the Docker socket. A separate,
socket-only operator sidecar is the only container with Docker access, and it
accepts only status, release-check, and exact-version update requests. It runs
in a dedicated digest-pinned operator image—not the web application image.
Before running privileged release code, it installs with lifecycle scripts
disabled, verifies the npm registry signature and the exact SLSA bundle, and
requires that the signed package came from this repository's tagged
`release-cloud.yml` workflow. That authenticated package pins both qualified
GHCR image digests and the exact source revision carried by both images, so
moving or replacing a version tag—or mixing artifacts from different
commits—is rejected before an image can run. A stale dashboard-owned update is
recovered automatically with its exact target CLI; unrelated/manual operations
remain locked for host-side `recover`. Existing deployments gain the card after
one normal exact-version CLI update. Remote Docker hosts remain CLI-only.

Managed registration is invite-only: the bootstrap owner signs in first and
invites additional users from the in-product admin flow. Guest access and
anonymous registration stay disabled. Uploading/installing custom plugins or
themes is disabled in the immutable image because it cannot rebuild trusted
source; bundled extensions remain available.

Remote OR3 Connect is withheld from the managed Cloud release until its
Cloudflare/domain staging flow is proved. Local Intern is independently
supported through the coordinated published release:

```sh
npx @or3/connect@0.1.3 intern
```

See the [Connect release status](https://github.com/Saluana/or3-intern/blob/main/docs/connect-release-status.md).
Do not substitute a bare package command or paste a generic remote URL/token as
a workaround. The [Start Here guide](https://github.com/Saluana/or3-chat/blob/main/docs/start-here.md)
routes each supported setup path.

## More help

```sh
npx @or3/cloud --help
```

For VPS requirements, firewall guidance, updates, restores, and migration,
read the [installation guide](https://github.com/Saluana/or3-chat/blob/main/docs/installation.md).
