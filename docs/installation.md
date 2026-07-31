# Installation and operations

For the complete maintainer release and first public server walkthrough, see
[Publish `create-or3-chat` and deploy it to a VPS](publish-and-vps.md).

## Create a project

OR3 Chat requires Node.js 22 or newer. Use either package manager:

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

## Public Docker with HTTPS

Pass `--domain chat.example.com` to the initializer or choose **Public domain**
in the wizard. The deployment uses both Compose files:

```bash
docker compose -f compose.yaml -f compose.public.yaml up --build -d
```

Point the hostname's A/AAAA records at the server and allow inbound TCP 80 and
TCP/UDP 443. Caddy terminates HTTPS and proxies to the OR3 service over the
private Compose network. OR3 itself remains bound to loopback on the host.

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
- Check `docker compose logs -f` when `/api/health?deep=true` is not healthy.
- Free port 3000 or set `OR3_PORT` before starting private Docker.
- A public domain must be a hostname, not a URL, and its DNS must resolve to the
  server before Caddy can obtain a certificate.
- If a registry, install, or image build fails, do not delete the project.
  Correct the cause and rerun setup or the Docker command.
