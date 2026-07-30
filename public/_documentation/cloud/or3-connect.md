# OR3 Connect

OR3 Connect makes a computer running `or3-intern` available to the signed-in
OR3 Cloud account without a VPN or manual tunnel:

```bash
npx @or3/connect
```

The command installs checksum-verified release binaries in `~/.or3/bin`, opens
OR3's browser device authorization, and asks once before installing a
launchd/systemd background service. The browser and terminal display the same
short phrase; approve only when they match.

## User commands

```bash
npx @or3/connect
npx @or3/connect status
npx @or3/connect doctor
npx @or3/connect disconnect
npx @or3/connect uninstall
```

`--no-service` keeps the connection in the current terminal. `--no-browser`
prints the sign-in URL for headless systems.

Remote mode requires an OR3 Cloud account. Offline/local OR3 never requires an
account and does not contact this control plane.

## Server configuration

OR3 Connect uses two independent provider contracts:

- **Persistence provider** stores device requests and connected computers. It
  defaults to the configured sync provider. SQLite and Convex are supported.
- **Relay provider** makes the computer reachable without opening a port.
  Cloudflare Tunnel is the built-in production adapter; other relays can
  register the same provision/revoke contract.

The normal self-hosted stack uses the same SQLite file as OR3 sync. It does not
require Convex or create another database:

```bash
SSR_AUTH_ENABLED=true
OR3_SYNC_PROVIDER=sqlite
OR3_SQLITE_DB_PATH=.data/or3-sync.sqlite

OR3_CONNECT_ENABLED=true
OR3_CONNECT_PROVIDER=sqlite
OR3_CONNECT_RELAY_PROVIDER=cloudflare
OR3_CONNECT_PUBLIC_URL=https://or3.chat
OR3_CONNECT_ENCRYPTION_KEY=<at-least-32-random-characters>
OR3_CONNECT_MAX_COMPUTERS=3
# Optional overrides; normally discovered from the hostname:
OR3_CONNECT_CLOUDFLARE_ACCOUNT_ID=...
OR3_CONNECT_CLOUDFLARE_ZONE_ID=...
OR3_CONNECT_CLOUDFLARE_API_TOKEN=...
OR3_CONNECT_HOSTNAME_SUFFIX=connect.or3.chat
```

`OR3_CONNECT_PROVIDER` is optional and defaults to `OR3_SYNC_PROVIDER`.
`OR3_CONNECT_RELAY_PROVIDER` defaults to `cloudflare`.

The Cloudflare API token needs Tunnel Edit, DNS Edit, and Zone Read for the
selected account/zone. It is server-only. Account and zone IDs are optional:
OR3 selects the longest zone matching `OR3_CONNECT_HOSTNAME_SUFFIX`. Operators
who do not grant Zone Read can provide both IDs explicitly.

SQLite migrations run automatically at server startup. When using
`OR3_CONNECT_PROVIDER=convex`, deploy the updated Convex schema/functions before
enabling the feature.

Local-only/offline mode remains unchanged:

```bash
SSR_AUTH_ENABLED=false
OR3_CONNECT_ENABLED=false
```

It requires no OR3 account, relay, or Connect configuration.

## Security model

- Device codes expire after ten minutes and can be redeemed only once. The
  long device secret is the authority; the readable phrase prevents approving
  the wrong terminal, while authenticated lookup attempts are rate limited.
- Device/control secrets are stored as domain-separated hashes.
- Credentials persisted by any Connect store are encrypted with AES-256-GCM
  before they reach the provider.
- `cloudflared` reads its token from a `0600` file, not a process argument.
- The tunnel can reach only OR3's loopback service; unmatched hostnames return
  404 and every OR3 service request still requires its bearer credential.
- Disconnect deletes DNS/tunnel resources, revokes the environment, and removes
  local state/service files.

## Release operations

Tag `or3-intern` with `v*` to build macOS/Linux amd64/arm64 archives and publish
the `or3` npm bootstrap. Release assets must expose GitHub SHA-256 digests;
the bootstrap refuses unverified assets.

Before production, run the canary from a network different from the host and
verify connect, reload hydration, agent streaming, approval prompts, restart
survival, revoke, and offline/local behavior.

## Provider contract

Database providers register a `ConnectStore`; relay providers register a
`ConnectRelay`. Core owns authentication, encryption, rate limits, tunnel
policy, and HTTP behavior. Stores must make approval/limits atomic and consume
an approved device credential exactly once. Unknown or unregistered providers
fail closed instead of falling back to a different backend.
