# OR3 Connect

> **Managed Cloud status: withheld.** Remote Connect is not part of the
> supported managed Cloud launch. Its Cloudflare/domain/attestation flow and a
> disposable staging lifecycle must pass before the production UI or beginner
> docs can offer a runnable command.

Do not run a generic `npx @or3/connect` command against a managed Cloud
instance, and do not paste a URL or token as a workaround. For a local agent
computer, use the independently supported local Intern bootstrap once its
matching package and verified release assets are published. Check [Connect
release status](https://github.com/Saluana/or3-intern/blob/main/docs/connect-release-status.md)
first; the current registry package predates this command:

```bash
npx @or3/connect intern
```

The remainder of this page is an advanced source/operator reference for a
future or explicitly configured Connect deployment. It is not a managed Cloud
setup path and does not change the current withheld capability.

## Source/operator commands (not managed Cloud)

```bash
npx @or3/connect
npx @or3/connect status
npx @or3/connect doctor
npx @or3/connect disconnect
npx @or3/connect uninstall
```

`--no-service` keeps the connection in the current terminal. `--no-browser`
prints the sign-in URL for headless systems.

Remote mode requires an OR3 Cloud account and a separately configured control
plane. Offline/local OR3 never requires an account and does not contact it.

`OR3_CONNECT_PUBLIC_URL` must be the URL that the connecting computer can open
in its browser. If OR3 Chat is only running on your computer, do not enable
remote Connect just to connect a local runtime: leave `OR3_CONNECT_ENABLED`
false and connect directly to the local agent service. If the runtime is on a
different computer, first deploy OR3 Chat or expose the local development
server through a stable HTTPS tunnel; then use that HTTPS address here. A
`127.0.0.1` or `localhost` value only works when the connecting computer is
the same computer running OR3 Chat.

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
OR3_CONNECT_PUBLIC_URL=https://cloud.example.com
OR3_CONNECT_ENCRYPTION_KEY=<at-least-32-random-characters>
OR3_CONNECT_MAX_COMPUTERS=3
# Optional overrides; normally discovered from the hostname:
OR3_CONNECT_CLOUDFLARE_ACCOUNT_ID=...
OR3_CONNECT_CLOUDFLARE_ZONE_ID=...
OR3_CONNECT_CLOUDFLARE_API_TOKEN=...
OR3_CONNECT_HOSTNAME_SUFFIX=connect.or3.chat
```

You do not deploy the OR3 application to Cloudflare for this to work. The OR3
server calls the Cloudflare API to create and revoke per-computer named
tunnels, while `cloudflared` runs on the user's connected computer and only
proxies that computer's loopback service. The Cloudflare credentials below
belong in the OR3 server's secret environment (or deployment secret manager);
they are never entered into `npx @or3/connect` and are never sent to a runtime
host.

The OR3 setup wizard verifies the tunnel and DNS permissions and writes the
matching `OR3_CONNECT_CLOUDFLARE_VALIDATION_ATTESTATION`. When configuring a
strict production deployment by hand, preserve that attestation with the
other server secrets; it is a signed verification result, not a replacement
for the API token.

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

## Release operations (future/advanced only)

Tag `or3-intern` with `v*` to build macOS/Linux amd64/arm64 archives and publish
the `or3` npm bootstrap. Release assets must expose GitHub SHA-256 digests;
the bootstrap refuses unverified assets.

Before any future production enablement, run the canary from a network
different from the host and verify connect, reload hydration, agent streaming,
approval prompts, restart survival, revoke, and offline/local behavior. Until
that evidence exists, keep the managed Cloud capability disabled.

## Provider contract

Database providers register a `ConnectStore`; relay providers register a
`ConnectRelay`. Core owns authentication, encryption, rate limits, tunnel
policy, and HTTP behavior. Stores must make approval/limits atomic and consume
an approved device credential exactly once. Unknown or unregistered providers
fail closed instead of falling back to a different backend.
