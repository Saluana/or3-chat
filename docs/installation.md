# Installation and operations

This is the primary guide for running OR3 Chat locally or on a single VPS. For
maintainers publishing `create-or3-chat`, see
[Publish `create-or3-chat` and deploy it to a VPS](publish-and-vps.md).

## Create a project

OR3 Chat requires Node.js 24 or newer. Use either package manager:

```bash
npm create or3-chat@latest
bun create or3-chat@latest
```

Both commands create the same versioned, editable application source. The
initializer detects the invoking package manager; `--pm npm` and `--pm bun`
override detection.

The complete non-interactive interface is:

```text
create-or3-chat [directory]
  --mode personal|self-hosted|custom
  --target dev|docker|configure
  --ui | --cli
  --pm npm|bun
  --domain <hostname>
  --yes
  --skip-install
  --no-git
  --no-open
```

The initializer refuses to overwrite a non-empty directory. Once the generated
directory is handed to you, an interrupted dependency install or setup is
resumed in place with `npm run setup` or `bun run setup`.

## Personal local

Personal mode stores conversations and settings in the browser. It does not
configure server authentication, sync, or file storage. The initializer applies
the defaults, starts OR3 on `http://127.0.0.1:3000`, waits for
`/api/health`, and opens the browser when a graphical session is available.

## Private Docker

The recommended self-hosted stack is Basic Auth, SQLite, and filesystem
storage. Apply and deploy from the wizard, or use the generated scripts:

```bash
npm run docker:up
npm run docker:logs
npm run docker:down
```

The application binds to `127.0.0.1:3000`. Persistent authentication, sync, and
upload data is mounted at `/data` in a project-scoped named volume (usually
`<project-folder>_or3-data`). Secrets are read from `.env` when the container
starts and are not copied into the image.

## Public VPS with HTTPS and Caddy

This is the recommended single-server deployment. It uses Docker Compose and
the generated Caddy service: Caddy owns public ports 80 and 443, terminates
HTTPS, and proxies to OR3 on its private Compose network. Do not install a
second Caddy or another web server on the host, and do not expose port 3000
publicly.

### Before you connect

Use a Linux VPS with a public IPv4 address. Two CPU cores, 4 GB of RAM, and
20 GB of disk is a comfortable starting point because the initial Docker image
build can use substantial memory.

1. Create an `A` record, such as `chat.example.com`, pointing to the VPS IPv4
   address. Add an `AAAA` record only if IPv6 is correctly routed to the host.
2. Open inbound TCP ports 22, 80, and 443 in the VPS provider firewall. UDP
   443 is optional and enables HTTP/3.
3. Connect with an SSH key and use a non-root sudo user.

Install Docker Engine and the Compose plugin using Docker's
[official Ubuntu instructions](https://docs.docker.com/engine/install/ubuntu/).
Then let your user run Docker and reconnect:

```bash
sudo usermod -aG docker "$USER"
exit
```

After reconnecting, install Node.js 24 or newer from a trusted distribution
and confirm the prerequisites:

```bash
docker version
docker compose version
node --version
npm --version
```

### Host firewall

Use one firewall manager. If you manage nftables directly, do not enable UFW
as well. Your existing input chain needs loopback and established-connection
rules plus access for SSH, HTTP, and HTTPS:

```nft
ct state established,related accept
iif lo accept
tcp dport 22 accept
tcp dport { 80, 443 } accept
udp dport 443 accept
```

Adjust this to match your host's existing nftables table, chain, and SSH port.
The UDP rule is optional. If you use UFW instead, allow `OpenSSH`, `80/tcp`,
`443/tcp`, and optionally `443/udp`.

### Create and launch OR3

On the VPS, run:

```bash
mkdir -p "$HOME/apps"
cd "$HOME/apps"
npm create or3-chat@latest my-chat -- \
  --mode self-hosted \
  --target docker \
  --domain chat.example.com \
  --cli
```

Replace `chat.example.com` with the DNS name you created. The wizard selects
the remaining configuration. For a straightforward self-hosted installation,
choose Basic Auth, SQLite, and filesystem storage; use a real administrator
email and save the generated password in a password manager.

The wizard creates `.env`, `compose.yaml`, `compose.public.yaml`, and a
`Caddyfile`, then starts the stack. Runtime secrets stay in `.env`; persistent
authentication, sync, and upload data is stored in a project-scoped Docker
volume mounted at `/data`.

If the initializer was run without applying the deployment, start it manually:

```bash
cd "$HOME/apps/my-chat"
docker compose -f compose.yaml -f compose.public.yaml up --build -d
```

Caddy obtains and renews HTTPS certificates after the domain resolves to the
server. A public domain is a hostname, not a URL. Caddy needs TCP 80 and 443;
there is no separate firewall rule for port 3000.

### Verify and operate

```bash
cd "$HOME/apps/my-chat"
docker compose -f compose.yaml -f compose.public.yaml ps
curl --fail --show-error "https://chat.example.com/api/health?deep=true"
```

Open the hostname in a browser, sign in, send a test message, and upload a
small file. Useful operational commands:

```bash
docker compose -f compose.yaml -f compose.public.yaml logs -f
docker compose -f compose.yaml -f compose.public.yaml restart or3
docker compose -f compose.yaml -f compose.public.yaml up --build -d
```

`docker compose down` removes containers and the network but retains data.
Do not add `--volumes` unless you intend to delete the installation's data.

## SSH

SSH and other headless sessions default to the terminal wizard:

```bash
npm run setup -- --cli
```

To use the browser wizard remotely:

```bash
npm run setup -- --ui
```

The command prints a loopback port and an SSH forwarding command in this form:

```bash
ssh -L 4173:127.0.0.1:4173 user@server
```

Run the tunnel on your computer, then open the printed `127.0.0.1` wizard URL.

## Backups

Stop the application, then use the Compose service to archive its own `/data`
volume without needing to know Docker's generated volume name:

```bash
docker compose stop or3
docker compose run --rm --no-deps --user 0:0 \
  -v "$PWD:/backup" \
  --entrypoint sh or3 \
  -c 'tar czf /backup/or3-data-backup.tgz -C /data .'
docker compose start or3
```

Restore into an empty project volume before starting OR3:

```bash
docker compose down
docker compose run --rm --no-deps --user 0:0 \
  -v "$PWD:/backup:ro" \
  --entrypoint sh or3 \
  -c 'find /data -mindepth 1 -delete && tar xzf /backup/or3-data-backup.tgz -C /data'
docker compose up -d
```

Protect the archive: it contains account, conversation, and uploaded-file data.

## Troubleshooting

- Run `npm run doctor` or `bun run doctor` for configuration and path checks.
- Check `docker compose -f compose.yaml -f compose.public.yaml logs -f` when
  `/api/health?deep=true` is not healthy.
- Free port 3000 or set `OR3_PORT` before starting private Docker.
- A public domain must be a hostname, not a URL, and its DNS must resolve to the
  server before Caddy can obtain a certificate.
- Confirm that ports 80 and 443 are not occupied by another web server or
  host-installed Caddy.
- If a registry, install, or image build fails, do not delete the project.
  Correct the cause and rerun setup or the Docker command.
