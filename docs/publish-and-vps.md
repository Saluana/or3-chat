# Publish `create-or3-chat` and deploy it to a VPS

This guide covers the first `create-or3-chat` npm release and a public
single-server deployment using Docker Compose and Caddy.

## 1. Prepare npm

1. Sign in at [npmjs.com](https://www.npmjs.com/) and enable two-factor
   authentication for publishing.
2. Confirm that you can publish the unscoped `create-or3-chat` package and the
   scoped `@or3/intern-client` package. The npm account or organization must own
   those names.
3. Log in from the terminal and verify the account:

   ```bash
   npm login
   npm whoami
   ```

For GitHub Actions, add an npm granular access token as the repository secret
`NPM_TOKEN`. Restrict it to the packages being released and allow publishing
without an interactive one-time password. The release workflow also requests
an OpenID Connect token and publishes npm provenance.

For a tokenless workflow, configure each existing package on npm with
[GitHub Actions trusted publishing](https://docs.npmjs.com/trusted-publishers/),
then remove `NODE_AUTH_TOKEN` from its publish step. A package normally needs
one manual first publication before its npm trusted-publisher settings exist.

## 2. Publish the exact first-party dependencies

The generated project intentionally uses exact OR3 package versions. Every
entry in
[`packages/create-or3-chat/first-party-versions.json`](../packages/create-or3-chat/first-party-versions.json)
must exist on npm before the creator can generate clean npm and Bun lockfiles.

Check them from the `or3-chat` directory:

```bash
node packages/create-or3-chat/scripts/build-template.mjs
node scripts/release/check-create-or3-chat.mjs --registry
```

If the check names a missing package, publish that exact version from its
repository. In the sibling checkout used by this project, the package
directories are:

| Package | Directory |
|---|---|
| `@or3/intern-client` | `../or3-intern/clients/typescript` |
| `or3-provider-basic-auth` | `../or3-provider-basic-auth` |
| `or3-provider-clerk` | `../or3-provider-clerk` |
| `or3-provider-convex` | `../or3-provider-convex` |
| `or3-provider-fs` | `../or3-provider-fs` |
| `or3-provider-s3` | `../or3-provider-s3` |
| `or3-provider-sqlite` | `../or3-provider-sqlite` |
| `or3-scroll` | `../or3-vsc` |
| `or3-workflow-core` | `../or3-workflows/packages/workflow-core` |
| `or3-workflow-vue` | `../or3-workflows/packages/workflow-vue` |

Inspect each tarball before publishing it:

```bash
cd ../or3-intern/clients/typescript
npm pack --dry-run
npm publish --access public
```

Repeat only for versions that `npm view <package>@<version> version` does not
find. Never republish or silently change an existing version. These packages
currently use Bun in their prepack/build scripts, so install Bun on the release
machine or use their release workflows.

## 3. Qualify and publish `create-or3-chat`

Keep these three versions identical:

- The root `package.json`
- `packages/create-or3-chat/package.json`
- The embedded template, which is generated from the root version

Run the local qualification:

```bash
cd ../or3-chat
npm install
npm run type-check
npm run build
npm --prefix packages/create-or3-chat run check
npm run release:create:locks
npm run release:create:check -- --require-locks --registry
cd packages/create-or3-chat
npm pack --dry-run --ignore-scripts
```

Test the packed artifact before publishing:

```bash
npm pack --ignore-scripts
cd "$(mktemp -d)"
npm exec --yes \
  --package=/absolute/path/to/or3-chat/packages/create-or3-chat/create-or3-chat-0.1.1.tgz \
  -- create-or3-chat smoke-or3 --yes --skip-install --no-git
cd smoke-or3
npm install
npm run build
```

Replace the tarball version/path with the artifact printed by `npm pack`.

The recommended release path is the repository's **Release create-or3-chat**
GitHub Actions workflow:

1. Commit and push the qualified release.
2. Create and push a tag matching the package version exactly:

   ```bash
   git tag v0.1.1
   git push origin v0.1.1
   ```

3. Watch the workflow complete its Windows/macOS/Linux creator tests, registry
   checks, npm and Bun install/build smokes, and Docker persistence smoke.
4. Confirm the release:

   ```bash
   npm view create-or3-chat@0.1.1 version
   npm create or3-chat@latest -- --help
   ```

For a manual release after the same checks:

```bash
cd packages/create-or3-chat
npm publish --access public --provenance
```

Publishing is permanent for that name/version. Use `npm pack --dry-run` and
verify the version before the final command.

## 4. Prepare the VPS

Use a fresh Linux VPS with a public IPv4 address. Two CPU cores, 4 GB of memory,
and 20 GB of disk is a comfortable starting point for building the image on the
server. A smaller host may work, but image builds are the memory-heavy part.

Before connecting:

1. Create an `A` record such as `chat.example.com` pointing to the VPS IPv4
   address.
2. Add an `AAAA` record only when IPv6 is correctly routed to the VPS.
3. Open inbound TCP ports 22, 80, and 443 in the provider firewall. UDP 443 is
   optional for HTTP/3.

Connect with an SSH key, create a non-root sudo user if the image did not
provide one, and enable the host firewall:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp
sudo ufw enable
```

Install Docker Engine and the Compose plugin using Docker's
[official Ubuntu instructions](https://docs.docker.com/engine/install/ubuntu/).
Then allow the current user to run Docker and reconnect:

```bash
sudo usermod -aG docker "$USER"
exit
```

After reconnecting:

```bash
docker version
docker compose version
```

Install Node.js 24 or newer from a trusted distribution for the VPS, then
verify:

```bash
node --version
npm --version
```

## 5. Create and deploy OR3

On the VPS:

```bash
mkdir -p "$HOME/apps"
cd "$HOME/apps"
npm create or3-chat@latest my-chat -- \
  --mode self-hosted \
  --target docker \
  --domain chat.example.com \
  --cli
```

Replace the example domain with the DNS name prepared above. The SSH session
selects the terminal wizard automatically; `--cli` makes the choice explicit.
The recommended answers install Basic Auth, SQLite, and filesystem storage.
Choose a real admin email, save the generated password in a password manager,
review the configuration, and apply the deployment.

The deployer starts this public stack:

- OR3 on the private Compose network, with its host port bound only to
  `127.0.0.1`
- Caddy on public ports 80 and 443
- Project-scoped persistent storage mounted at `/data`
- Runtime secrets loaded from `.env`, not copied into the image

Caddy obtains and renews HTTPS certificates after the domain resolves to the
server. Do not create a separate public firewall rule for port 3000.

## 6. Verify and operate it

```bash
cd "$HOME/apps/my-chat"
docker compose -f compose.yaml -f compose.public.yaml ps
curl --fail --show-error "https://chat.example.com/api/health?deep=true"
```

Open `https://chat.example.com`, sign in with the generated administrator
credentials, send a test message, and upload a small file. Useful commands:

```bash
docker compose -f compose.yaml -f compose.public.yaml logs -f
docker compose -f compose.yaml -f compose.public.yaml restart or3
docker compose -f compose.yaml -f compose.public.yaml down
docker compose -f compose.yaml -f compose.public.yaml up --build -d
```

`down` removes containers and the network but retains the named data volume.
Do not add `--volumes` unless you intend to delete the installation's data.

## 7. Back it up

Back up before every upgrade:

```bash
cd "$HOME/apps/my-chat"
docker compose stop or3
docker compose run --rm --no-deps --user 0:0 \
  -v "$PWD:/backup" \
  --entrypoint sh or3 \
  -c 'tar czf /backup/or3-data-backup.tgz -C /data .'
docker compose start or3
chmod 600 or3-data-backup.tgz
```

Copy `or3-data-backup.tgz` and `.env` to encrypted storage outside the VPS.
Both contain sensitive data. Restore instructions are in
[Installation and operations](installation.md#backups).

## Troubleshooting

- Run `npm run doctor` inside the generated project.
- Check `docker compose -f compose.yaml -f compose.public.yaml logs -f` if deep
  health is not ready.
- Confirm DNS with `dig +short chat.example.com`.
- Confirm ports 80 and 443 are not occupied by another web server.
- If setup or an image build is interrupted, keep the directory and rerun
  `npm run setup`; the wizard session and `.env` merge are resumable.
- For a browser wizard over SSH, run `npm run setup -- --ui` and use the exact
  SSH tunnel command it prints. The wizard remains loopback-only.
