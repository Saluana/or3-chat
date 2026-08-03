---
name: or3-openclaw-setup
description: Install, configure, connect, and troubleshoot OpenClaw as a streaming external agent host for OR3 Chat.
license: GPL-3.0
metadata:
  author: OR3
  version: 0.1.0
  or3-product: or3-chat
---

# Set up OpenClaw for OR3 Chat

## Purpose

Connect an existing or new OpenClaw Gateway directly to OR3 Chat through the
`@or3/openclaw` plugin. The result supports streaming text and tool activity,
slash commands and bounded option buttons, approvals, cancellation, model and
thinking selection, and attachments without routing conversation data through
OR3 Cloud.

Use [the shared Runs connection guide](../../shared/external-agent-runs.md)
for the common OR3-side connection and verification flow.

## Required first steps

1. Read [repository navigation](../../shared/repository-navigation.md), the
   checkout's `AGENTS.md`, and the current `packages/openclaw-or3/README.md`
   before editing configuration.
2. Ask whether OpenClaw is already installed, whether the Gateway is already
   running, which OR3 browser origin is in use, and whether this is local-only
   or intentionally reachable from another machine.
3. Ask for approval before installing software, enabling a plugin, creating a
   token, or changing Gateway configuration. Never ask the user to paste a
   bearer token into chat.

## Install and initialize OpenClaw

If `openclaw --version` is unavailable, use OpenClaw's supported installer:

```sh
curl -fsSL https://openclaw.ai/install.sh | bash
openclaw onboard --install-daemon
```

The current OpenClaw installer requires a supported Node.js release; prefer the
version recommended by OpenClaw's installation guide. Complete onboarding and
configure at least one model/provider before continuing. Check the local
installation with:

```sh
openclaw gateway status --deep --require-rpc
```

If the Gateway is not running, install/start it through OpenClaw's normal
service workflow or run it in the foreground for development. Do not invent a
second server or proxy.

## Install the OR3 Runs plugin

From the OR3 Chat repository, install the local plugin during development:

```sh
openclaw plugins install ./packages/openclaw-or3
openclaw plugins enable or3-runs
```

For a published release, use the exact released package/version documented in
`packages/openclaw-or3/README.md`, for example:

```sh
openclaw plugins install npm:@or3/openclaw@<released-version> --pin
openclaw plugins enable or3-runs
```

If `plugins.allow` is configured, add `or3-runs` to its existing array; never
replace the array and accidentally disable other plugins. Verify that the
running Gateway—not merely the config file—loaded it:

```sh
openclaw plugins inspect or3-runs --runtime --json
```

## Configure origin and authentication

Set the plugin's browser allowlist to OR3's exact browser origin. For local OR3
development, that is commonly `http://localhost:3000`:

```sh
openclaw config set plugins.entries.or3-runs.config.allowedOrigins '["http://localhost:3000"]'
```

The same origin can instead live in `gateway.controlUi.allowedOrigins`. Do not
use wildcard origins. `localhost` and `127.0.0.1` are different origins.

The plugin normally reuses the Gateway bearer token from a string-valued
`gateway.auth.token` or `OPENCLAW_GATEWAY_TOKEN`. If the Gateway instead uses a
password, CLI-only token, or SecretRef, configure the plugin with an approved
dedicated bearer token at `plugins.entries.or3-runs.config.token`. Do not print
the value or put it in a URL.

Restart after every install, upgrade, or configuration change so the Gateway
reloads streaming and discovery code:

```sh
openclaw gateway restart
openclaw gateway status --deep --require-rpc
```

## Connect it to OR3 Chat

In **Agents → Connection settings → Advanced**, create a host using:

- **Name:** a recognizable label such as `OpenClaw (local)`.
- **Host URL:** `http://127.0.0.1:18789/or3/` for the default local Gateway.
  Replace the host only for an approved remote deployment; retain `/or3/`.
- **Access token:** the Gateway/plugin bearer token.

Save and connect. OR3 discovers the Runs capability document automatically.
Select the host in the sidebar's connected-host selector before creating a new
agent session.

## Validate the user-facing features

1. Send a short message and verify text appears incrementally.
2. Use `/` in the composer and confirm OpenClaw's live command catalog appears.
3. Send `/models`; choose a provider button, then choose a model button. OR3
   should send OpenClaw's normal `/model <provider/model>` command.
4. Select a model that advertises thinking levels and confirm the composer
   offers only those levels.
5. Send an image or small document (up to the documented 20 MB total) and
   confirm the OpenClaw session receives it.
6. Run a harmless slow/tool-using prompt, observe streamed tool activity, and
   stop it. The session should show the partial result as cancelled and the
   composer should return to idle.

Mode, isolation, and workspace controls should remain absent: this channel
bridge does not implement per-message versions of those settings.

## Troubleshoot precisely

- **Plugin seems installed but OR3 lacks streaming or commands:** run
  `openclaw plugins inspect or3-runs --runtime --json`; restart the Gateway if
  its runtime registration is missing or stale.
- **OR3 connects but requests fail:** check the Gateway/plugin CORS allowlist
  against the browser's exact origin, then restart.
- **Response arrives only at the end:** inspect the `/or3/` event stream and
  any reverse proxy buffering. Do not mask the problem by adding client polling
  or extending a timeout.
- **No models or thinking levels:** fix the OpenClaw provider/model setup first;
  OR3 only presents the catalog advertised by the Gateway.
- **No attachment button:** confirm the selected host is OpenClaw and the
  connection's capabilities loaded. The control intentionally stays hidden for
  runtimes that do not advertise attachment support.
- **Remote Gateway:** preserve bearer authentication, use HTTPS or a trusted
  private network, and allow only the intended OR3 origins.

## Completion report

Follow the [completion contract](../../shared/completion-contract.md).
State the installed OpenClaw version, plugin package/version, whether the
Gateway is running, the non-secret host URL, and the exact configured origin.
Report which verification steps passed and any remaining runtime-owned
limitation. Never include tokens, token-derived values, user messages, or file
contents in the report.

## Official references

- [OpenClaw installation](https://docs.openclaw.ai/getting-started)
- [OpenClaw Gateway](https://docs.openclaw.ai/gateway)
- [OpenClaw plugins](https://docs.openclaw.ai/tools/plugin)
- [OR3 OpenClaw plugin README](../../../openclaw-or3/README.md)
- [Permissions and trust](../../shared/permissions-and-trust.md)
