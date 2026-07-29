# OR3 Connect

OR3 Connect makes a computer running `or3-intern` available to the signed-in
OR3 Cloud account without a VPN or manual tunnel:

```bash
npx or3 connect
```

The command installs checksum-verified release binaries in `~/.or3/bin`, opens
OR3's browser device authorization, and asks once before installing a
launchd/systemd background service. The browser and terminal display the same
short phrase; approve only when they match.

## User commands

```bash
npx or3 connect
or3-intern connect status
or3-intern connect doctor
or3-intern connect disconnect
or3-intern connect uninstall
```

`--no-service` keeps the connection in the current terminal. `--no-browser`
prints the sign-in URL for headless systems.

Remote mode requires an OR3 Cloud account. Offline/local OR3 never requires an
account and does not contact this control plane.

## Cloud configuration

OR3 Cloud requires Convex plus a Cloudflare zone:

```bash
OR3_CONNECT_ENABLED=true
OR3_CONNECT_PUBLIC_URL=https://or3.chat
OR3_CONNECT_ENCRYPTION_KEY=<at-least-32-random-characters>
OR3_CONNECT_MAX_COMPUTERS=3
OR3_CONNECT_CLOUDFLARE_ACCOUNT_ID=...
OR3_CONNECT_CLOUDFLARE_ZONE_ID=...
OR3_CONNECT_CLOUDFLARE_API_TOKEN=...
OR3_CONNECT_HOSTNAME_SUFFIX=connect.or3.chat
```

The Cloudflare API token needs Tunnel Edit and DNS Edit for the selected
account/zone. It is server-only.

Deploy the updated Convex schema/functions before enabling the feature.

## Security model

- Device codes expire after ten minutes and can be redeemed only once. The
  long device secret is the authority; the readable phrase prevents approving
  the wrong terminal, while authenticated lookup attempts are rate limited.
- Device/control secrets are stored as domain-separated hashes.
- Credentials persisted in Convex are encrypted with AES-256-GCM.
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
