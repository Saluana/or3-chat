# Start here

Choose the one path that matches what you want to do. The normal Cloud and
Intern paths do not require a source checkout, a Compose command, an `.env`
file, or hand-written `OR3_*` values.

## I want a private Cloud on this computer

Run this once from an empty directory:

```bash
npx @or3/cloud init --local
```

The operator starts the supported Basic Auth + SQLite + filesystem profile,
prints the local URL, and saves the bootstrap credentials in a private file.
Open the URL, sign in as the owner, and remove the credentials file after
saving it in a password manager. Continue with [Cloud installation and
operations](installation.md) for updates, backups, and recovery.

## I want a public Cloud on a VPS

Point a DNS record at the VPS, allow TCP 80 and 443, then run:

```bash
npx @or3/cloud init --public --domain cloud.example.com
```

The operator provisions the version-matched image and Caddy HTTPS proxy. It
prints the public URL and stores bootstrap credentials privately. Follow
[Cloud installation and operations](installation.md) for firewall, DNS,
backup, restore, rollback, and safe removal guidance.

## I want a local Intern computer

The supported one-command bootstrap uses the coordinated package and verified
Intern release assets. Pin the published version so a copied command cannot
silently select a different release; see the [Connect release status](https://github.com/Saluana/or3-intern/blob/main/docs/connect-release-status.md):

```bash
npx @or3/connect@0.1.3 intern
```

This opens the guided local `or3-intern` setup. It stays on the computer until
you explicitly add it to an OR3 Chat instance through the advanced local-host
connection settings. See the [Intern getting-started guide](https://github.com/Saluana/or3-intern/blob/main/docs/getting-started.md)
for the local runtime and runner steps.

## I want remote Connect

Remote Connect is **withheld from the managed Cloud launch**. The public
Cloud image does not show a runnable Connect command, because the managed
Cloudflare/domain/attestation flow has not completed its staging proof. An
administrator must finish that operator flow before remote Connect can be
enabled. Do not paste a generic URL or token as a workaround.

Local Intern remains the supported path.
For source-only Connect development, use the
[advanced Connect reference](../public/_documentation/cloud/or3-connect.md)
and treat its environment settings as operator documentation, not a beginner
setup path.

## I want to develop OR3 Chat

Clone the repository, install dependencies, and run the offline development
server:

```bash
bun install
bun run dev:offline
```

This is the editable source path. It is the right place for custom providers,
plugins, themes, and server changes; it is not required for a managed Cloud
deployment. See [source wizard documentation](../public/_documentation/cloud/or3-cloud-wizard.md)
when you need the advanced provider wizard.

## What to do next

- Cloud owners: read [installation and operations](installation.md).
- Intern users: read the [activity and external agents](activity-external-agents.md)
  contract after the local runtime is ready.
- Contributors: read [testing](testing/custom-pane-apps.md) and
  [releasing OR3 Cloud](releasing.md).
