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
Basic Auth + SQLite + filesystem storage. The CLI checks the image manifest
before it writes deployment state.

## Run it publicly on a VPS

Before starting, point a domain at the VPS and allow inbound TCP ports `80`
and `443` in its firewall. Then run:

```sh
npx @or3/cloud init --public --domain cloud.example.com
```

OR3 Cloud uses Caddy to obtain and renew HTTPS certificates. It does not
change your DNS, firewall, Cloudflare, or Tailscale settings.

## Day-to-day commands

Run these from the deployment directory created by `init`:

```sh
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

Do not run `docker compose down --volumes` on a normal deployment: it deletes
the application data. Use `backup` before an update or any destructive action.
For a destructive purge, export a fresh backup to a new directory on another
filesystem first; `remove --purge-data --yes` verifies that export before it
will delete anything.

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
