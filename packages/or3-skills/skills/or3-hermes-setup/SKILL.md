---
name: or3-hermes-setup
description: Configure and troubleshoot Hermes as an external streaming Runs host for OR3 Chat.
license: GPL-3.0
metadata:
  author: OR3
  version: 0.1.0
  or3-product: or3-chat
---

# Hermes for OR3 Chat

Hermes exposes a built-in Runs-compatible API; this integration does not require an OR3 plugin.
Use [repository navigation](../../shared/repository-navigation.md) and [the shared Runs guide](../../shared/external-agent-runs.md).
Determine the installed version, exact OR3 browser origin, and intended network exposure from available context.

Software installation, persistent credentials, `~/.hermes` changes, and remote exposure require user authorization; reuse authorization already given and ask when missing.
Never request an API key in chat or add it to the repository.

## Configure the existing runtime

Use Hermes's supported installer/onboarding if installation is authorized and needed; complete model/provider setup before diagnosing OR3 connectivity.
Consult current Hermes docs or local help for installation and service lifecycle rather than guessing commands.

Preserve unrelated entries in `~/.hermes/.env`; the API configuration uses:

```dotenv
API_SERVER_ENABLED=true
API_SERVER_HOST=127.0.0.1
API_SERVER_PORT=8642
API_SERVER_KEY=<approved-high-entropy-secret>
API_SERVER_CORS_ORIGINS=http://localhost:3000
```

Use the user's exact browser origin, without wildcard CORS.
Use documented environment keys; unrecognized `hermes config set` keys can be saved as metadata without enabling the API.
Keep local use on loopback; remote exposure requires approved HTTPS/private networking and protected credentials.

Foreground development uses `hermes gateway run`.
For an installed service, use the version's supported gateway lifecycle; restart after API/CORS changes and verify health.
An authenticated `GET /v1/capabilities` must return the Runs document.

## Connect and verify

In **Agents → Connection settings → Advanced**, add the host URL `http://127.0.0.1:8642/` and enter the bearer key through the credential field.
Confirm a published bootstrap route is released and qualified before recommending a guided Connect command; otherwise use this manual connection.

Verify incremental text, advertised tool activity/commands/models, and cancellation that preserves partial content and returns the composer to idle.
Do not infer OpenClaw features from a successful Hermes connection.

## Streaming failures

Some Hermes versions omit CORS headers on `/v1/runs/{id}/events` even when normal API calls work.
Check the exact origin, restart status, and actual SSE response headers before changing OR3.
Prefer an upstream fix; an installed-file compatibility patch needs authorization and inspection of the installed handler.
Any patch must reuse the existing origin-specific CORS policy before the stream is prepared, preserve authentication, and be rechecked after upgrades.
Do not mask missing SSE delivery with polling, longer heartbeats, wildcard origins, or token-in-URL authentication.

Report version, service/connection status, non-secret URL/origin, verification, and any local patch using [completion guidance](../../shared/completion-contract.md).
Keep keys, conversation content, and user files out of the report.

## References

- [Hermes installation](https://hermes-agent.nousresearch.com/docs/getting-started/installation)
- [Hermes API server](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server)
- [Permissions and trust](../../shared/permissions-and-trust.md)
