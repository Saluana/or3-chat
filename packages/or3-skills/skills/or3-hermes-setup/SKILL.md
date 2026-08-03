---
name: or3-hermes-setup
description: Install, configure, connect, and troubleshoot Hermes as a streaming external agent host for OR3 Chat.
license: GPL-3.0
metadata:
  author: OR3
  version: 0.1.0
  or3-product: or3-chat
---

# Set up Hermes for OR3 Chat

## Purpose

Connect Hermes directly to OR3 Chat through Hermes's built-in Runs-compatible
API server. No OR3 plugin is needed. The result supports streaming text and
tool activity, commands when Hermes advertises them, approvals, cancellation,
and any models/reasoning options exposed by the installed Hermes runtime.

Use [the shared Runs connection guide](../../shared/external-agent-runs.md)
for the common OR3-side connection and verification flow.

## Connect availability

The published `@or3/connect@0.1.0` bootstrap does not yet contain the Hermes
route. Do not instruct users to run an unversioned `npx @or3/connect hermes`
command until the release containing that route is published and qualified.
Use the manual URL-and-token connection below in the meantime.

## Required first steps

1. Read [repository navigation](../../shared/repository-navigation.md), the
   checkout's `AGENTS.md`, and Hermes's current API-server documentation before
   changing the user's installation.
2. Ask whether Hermes is already installed/configured, the exact OR3 browser
   origin, and whether the server must leave loopback.
3. Ask for approval before installing Hermes, generating/persisting an API
   credential, changing `~/.hermes` configuration, or opening network access.
   Never request an API key in chat or add it to the repository.

## Install and configure Hermes

If `hermes --version` is unavailable, use Hermes's supported installer, then
complete its model/provider setup before enabling the API:

```sh
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
hermes setup --portal
hermes doctor
```

`hermes model` and `hermes tools` are useful checks when setup is already done.
The API can connect successfully while usable providers/models are missing, so
resolve model setup before diagnosing OR3.

## Enable the API server safely

Create or update `~/.hermes/.env`, preserving unrelated entries. Set a
loopback-only API server, an approved high-entropy bearer key, and OR3's exact
browser origin:

```dotenv
API_SERVER_ENABLED=true
API_SERVER_HOST=127.0.0.1
API_SERVER_PORT=8642
API_SERVER_KEY=<long-random-secret>
API_SERVER_CORS_ORIGINS=http://localhost:3000
```

Generate the key only after approval, for example with `openssl rand -hex 32`,
and do not echo it into a transcript.

Prefer the documented environment variables when there is uncertainty about
configuration precedence. Do **not** rely on `hermes config set
API_SERVER_ENABLED true` or `hermes config set gateway.api_server.enabled true`
when Hermes warns that the key is unrecognized: those values may be saved as
custom metadata rather than enabling the API server.

`http://localhost:3000` and `http://127.0.0.1:3000` need separate allowlist
entries when both are used. Do not use a wildcard CORS origin. Keep the API on
loopback unless the user explicitly approves a hardened remote deployment.

## Run and verify Hermes

For foreground development, run:

```sh
hermes gateway run
```

For an installed macOS/Linux service, use Hermes's service commands:

```sh
hermes gateway install
hermes gateway start
hermes gateway status
```

After changing API/CORS configuration, restart the service:

```sh
hermes gateway restart
hermes gateway status
```

If the existing version documents a different gateway lifecycle, use its own
`hermes gateway --help` output rather than guessing. Confirm the authenticated
capabilities endpoint returns a Runs capability document before opening OR3.

## Connect it to OR3 Chat

In **Agents → Connection settings → Advanced**, create a host using:

- **Name:** a recognizable label such as `Hermes (local)`.
- **Host URL:** `http://127.0.0.1:8642/`.
- **Access token:** the `API_SERVER_KEY` bearer key.

Save and connect. OR3 detects the Runs protocol automatically. Multiple hosts
can remain unlocked; select Hermes in the Agents sidebar before creating a new
agent session. Sessions always remain with the host that created them.

## Verify streamed behavior

1. Send a short message; assistant text must become visible before the run
   completes.
2. Use a simple tool-capable prompt and confirm tool progress appears as Hermes
   emits it.
3. Cancel a running response; partial content should remain, the app should
   stay alive, and the composer should return to idle.
4. Type `/` and verify a command list only if Hermes advertises commands.
5. Inspect the model picker. It should show Hermes's actual advertised catalog;
   a default-only picker means the runtime has not exposed additional models.

Do not expect the OpenClaw attachment, command-option, or model-picker behavior
from Hermes unless Hermes's capabilities explicitly advertise equivalent
support.

## Hermes SSE CORS issue

Some Hermes versions, including a v0.19.1 installation encountered during OR3
testing, applied CORS to normal API responses but omitted it on
`/v1/runs/{id}/events`. The symptoms are: capabilities/connectivity work, OR3
shows **Generating**, then the complete response appears at once (or the event
request is blocked in the browser console).

First confirm `API_SERVER_CORS_ORIGINS` contains the exact OR3 origin and that
the gateway was restarted. If the SSE response still lacks
`Access-Control-Allow-Origin`, this is a Hermes runtime defect—not an OR3
heartbeat or polling problem. Prefer upgrading to a Hermes release that fixes
SSE CORS. If no upgrade is available, explain the risk and request approval
before applying this compatibility patch to the installed
`gateway/platforms/api_server.py`. First locate `_handle_run_events` and verify
its `sse_headers` block still matches the surrounding handler below; do not
blindly replace a version the agent has not inspected.

```python
sse_headers = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "X-Accel-Buffering": "no",
}
# Middleware cannot alter StreamResponse headers after prepare().
origin = request.headers.get("Origin", "")
cors = self._cors_headers_for_origin(origin) if origin else None
if cors:
    sse_headers.update(cors)
response = web.StreamResponse(status=200, headers=sse_headers)
await response.prepare(request)
```

This only reuses Hermes's existing, origin-specific CORS policy on its SSE
response. It must not broaden the allowlist or change authentication. Restart
Hermes and repeat the streamed-behavior checks. Record the local patch and
installed-file location because a Hermes upgrade may overwrite it; never work
around the defect with token-in-URL authentication or a wildcard origin.

## Troubleshoot precisely

- **Host unavailable:** verify `hermes gateway status`, API port `8642`, the
  base URL, and the `API_SERVER_KEY` bearer token.
- **HTTP works but browser streaming fails:** use browser Network/Console to
  inspect the event endpoint for CORS before changing OR3 behavior.
- **Response is final-only:** solve the SSE CORS/proxy buffering issue; a
  longer heartbeat cannot cause the browser to receive missing events.
- **No models or commands:** run Hermes model/provider setup and inspect its
  capabilities. OR3 hides unadvertised features intentionally.
- **Remote deployment:** require explicit approval, HTTPS or a trusted private
  network, narrow CORS origins, and a protected bearer key.

## Completion report

Follow the [completion contract](../../shared/completion-contract.md).
State the Hermes version, whether its gateway service is running, the non-secret
host URL, and the exact configured browser origin. Record if an upstream SSE
CORS patch was required and its installed-file location, so future upgrades can
revalidate it. Do not disclose the API key, chat contents, or user files.

## Official references

- [Hermes installation](https://hermes-agent.nousresearch.com/docs/getting-started/installation)
- [Hermes API server](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server)
- [Permissions and trust](../../shared/permissions-and-trust.md)
