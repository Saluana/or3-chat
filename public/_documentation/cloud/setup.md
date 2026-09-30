# Set up Cloud

Use the managed `@or3/cloud` distribution for normal local or single-VPS deployments. It runs a versioned container with Basic Auth, SQLite sync, and filesystem storage. The canonical host installation guide, including firewall, Caddy, Cloudflare, and Tailscale details, is [Installation and operations](https://github.com/Saluana/or3-chat/blob/or3-cloud/docs/installation.md).

## Before you start

Install Docker Engine and Docker Compose v2. The operator CLI requires Node.js 20 or later to run through `npx`; the container owns the application dependencies. Supported container architectures are Linux amd64 and arm64, including those architectures through Docker on a local machine.

Use a directory dedicated to this deployment and run subsequent operator commands there. Do not install application dependencies or build OR3 source in that directory.

## Run locally

```bash
npx @or3/cloud init --local
```

The installer asks for your administrator email, generates the bootstrap password, and writes it to the owner-only `.or3-initial-credentials` file. Save it in a password manager, then remove that file. Open [the local app](http://127.0.0.1:3000) and sign in. If the port is occupied, use `--port 3100` at initialization.

Local mode binds to loopback and does not install Caddy. Keep it local unless you deliberately configure a supported exposure path.

## Run on a public domain

Use a Linux VPS with at least two CPU cores, 4 GB RAM, and 20 GB disk. Point your domain's DNS at the VPS and allow host ports 22, 80, and 443 through your existing firewall. The installer does not change firewall rules; follow the canonical installation guide before applying host-specific rules.

```bash
npx @or3/cloud init --public --domain cloud.example.com
```

Caddy handles HTTPS and proxies over the private Compose network. Do not expose OR3 port 3000 publicly. Sign in at your domain using the saved initial credentials. With Cloudflare, first obtain the origin certificate using DNS-only mode; any later proxy must use Full (strict).

## First login and invitations

Managed registration is invite-only. The bootstrap account is the initial owner; anonymous visitors cannot create accounts. Invite others through the in-product workspace/admin invitation flow. The OR3 account and the `/admin` panel initially use the bootstrap credentials, but their passwords and sessions are separate after setup.

Connect an OpenRouter account or paste an OpenRouter key to send AI messages. Cloud account credentials do not provide model access. See [accounts and access](/documentation/cloud/auth-system) for the distinction.

The managed image includes bundled plugins and themes. Custom trusted source upload/install controls are hidden because the immutable image cannot rebuild them. Use the editable source path for extensions you maintain.

## Verify the deployment

From the deployment directory:

```bash
npx @or3/cloud doctor
npx @or3/cloud status
```

Then use two browser profiles or devices signed into the same account and workspace:

1. In the first browser, create a conversation and send a short message. In the second, confirm that conversation and message appear.
2. Upload a small allowed file in the first browser. Open or download it in the second, confirming both metadata and file contents are available.
3. Temporarily disconnect the first browser, make a local change, reconnect, and confirm the change reaches the second browser without duplication.
4. If you have multiple workspaces, switch and confirm data stays in the correct workspace in both browsers.

Retain the doctor result, the test conversation ID, and the small test file so you can repeat this check after an update or recovery. Do not clear browser storage to fix sync while unsent changes remain.

## Back up before depending on it

Create a backup and list it:

```bash
npx @or3/cloud backup
npx @or3/cloud backup list
```

Backups contain protected credentials and private data. Store an encrypted off-host copy and keep the deployment's `.or3-cloud/backup-auth.key` separately in an encrypted secret store; the archive alone cannot authenticate a restore on a recovered host. Follow [operations](/documentation/cloud/deployment-operations) for export, restore confirmation, and recovery verification.

Use [Updating OR3](https://github.com/Saluana/or3-chat/blob/or3-cloud/docs/cloud-updates.md) for updates. Provider replacement is not a data migration: changing a provider ID does not copy accounts, memberships, conversations, or files.

## Editable source

Contributors use `bun run dev` for local-first development or `bun run dev:ssr` for the configured SSR application. For a custom Cloud stack, use the [source wizard](/documentation/cloud/or3-cloud-wizard), then read [Choose and wire providers](/documentation/cloud/providers) and [configuration](/documentation/cloud/configure). The source wizard and the managed operator have different responsibilities.
