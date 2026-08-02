# OR3 Runs for OpenClaw

This plugin exposes OpenClaw's normal agent lifecycle to OR3 Chat at the
Gateway's `/or3/` URL. It uses the Gateway's existing bearer token and adds no
relay, account, database, or second credential.

## Install

```bash
openclaw plugins install ./packages/openclaw-or3
openclaw plugins enable or3-runs
openclaw config set plugins.entries.or3-runs.config.allowedOrigins '["http://localhost:3000"]'
openclaw gateway restart
```

If `plugins.allow` is configured, add `or3-runs` to its existing array. Do not
replace the array, because doing so disables every plugin ID you omit.

After this package is published, the first command can instead be
`openclaw plugins install npm:@or3/openclaw@0.1.0 --pin`.

In OR3 Chat, open **Agents → Connection settings → Advanced**, then enter:

- URL: `http://127.0.0.1:18789/or3/` (replace the host when remote)
- Token: the existing OpenClaw Gateway bearer token

OR3 detects OpenClaw automatically. The plugin reuses a string-valued Gateway
token from `gateway.auth.token` (or `OPENCLAW_GATEWAY_TOKEN`). If the Gateway
uses a password, CLI-only token, or SecretRef, set the same bearer value at
`plugins.entries.or3-runs.config.token`.

The connection uses OpenClaw's configured model catalog and thinking levels,
and reads the live built-in/plugin/skill command catalog from the Gateway.
Commands with known options render safe follow-up buttons. `/models` uses a
provider picker followed by a paginated model picker; selecting a model sends
OpenClaw's normal `/model <provider/model>` command.
The existing OR3 attachment picker sends images, documents, audio, and video
directly to OpenClaw with the message. Attachment bytes are held only until the
authenticated request is dispatched; they are not uploaded to or stored by an
OR3 relay. Attachments can total up to 20 MB per message. Mode, isolation, and
workspace controls remain hidden because this channel bridge does not implement
those per-message settings. Restart the Gateway after upgrading the plugin so
streaming and discovery code is reloaded.

Replace `http://localhost:3000` with OR3's exact browser origin. The origin can
be configured in either `gateway.controlUi.allowedOrigins` or
`plugins.entries.or3-runs.config.allowedOrigins`. Wildcard origins are not
accepted.
Keep the Gateway behind HTTPS or a trusted private network when it is not bound
to loopback.

The package is tested against OpenClaw `2026.7.1-2` and declares compatibility
only with the `2026.7.x` line.
