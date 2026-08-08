# OR3 Cloud

Install and operate a supported OR3 container deployment without cloning the
application repository or installing its dependencies on the host.

## Quick start: local machine

You need Docker Engine with Docker Compose v2 and Node.js 24 or later.

```sh
npx @or3/cloud init --local --admin-email you@example.com
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). The installer prints a
bootstrap password and saves the credentials in
`or3-cloud/.or3-initial-credentials`. Save them in a password manager, then
delete that file.

## Run it publicly on a VPS

Before starting, point a domain at the VPS and allow inbound TCP ports `80`
and `443` in its firewall. Then run:

```sh
npx @or3/cloud init --public \
  --domain cloud.example.com \
  --admin-email you@example.com
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
```

Do not run `docker compose down --volumes` on a normal deployment: it deletes
the application data. Use `backup` before an update or any destructive action.

## More help

```sh
npx @or3/cloud --help
```

For VPS requirements, firewall guidance, updates, restores, and migration,
read the [installation guide](https://github.com/Saluana/or3-chat/blob/main/docs/installation.md).
