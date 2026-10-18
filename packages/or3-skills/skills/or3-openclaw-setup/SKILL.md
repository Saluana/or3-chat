---
name: or3-openclaw-setup
description: Configure and troubleshoot OpenClaw's OR3 Runs plugin as an external streaming host for OR3 Chat.
license: GPL-3.0
metadata:
  author: OR3
  version: 0.1.0
  or3-product: or3-chat
---

# OpenClaw for OR3 Chat

Use the existing OpenClaw Gateway and `@or3/openclaw` Runs plugin rather than adding a second server/proxy.
Read [repository navigation](../../shared/repository-navigation.md), [the shared Runs guide](../../shared/external-agent-runs.md), and the checkout's `packages/openclaw-or3/README.md`.
Determine installed/runtime status, exact OR3 origin, and local/remote scope from available context.

Installation, plugin enablement, credential creation, and Gateway configuration changes require user authorization; reuse authorization already given and ask when missing.
Never request bearer tokens in chat or include them in reports or URLs.

## Runtime and plugin

If installation is authorized and needed, use OpenClaw's supported installer/onboarding and its documented Node requirement.
Configure a usable model/provider and check `openclaw gateway status --deep --require-rpc`.

For local plugin development from an OR3 checkout:

```sh
openclaw plugins install ./packages/openclaw-or3
openclaw plugins enable or3-runs
```

For distribution, use the exact released package/version documented by the plugin README.
If `plugins.allow` exists, add `or3-runs` without replacing other entries.
Verify the running registration with `openclaw plugins inspect or3-runs --runtime --json`.

## Origin and credentials

Configure `plugins.entries.or3-runs.config.allowedOrigins` or the documented Gateway origin setting with the exact OR3 browser origin.
`localhost` and `127.0.0.1` are different origins; do not use wildcard CORS.
The plugin can reuse a string-valued `gateway.auth.token` or `OPENCLAW_GATEWAY_TOKEN`.
For password/CLI-only/SecretRef configurations, use an approved dedicated plugin bearer credential as documented.
Preserve unrelated config and restart the Gateway after installation, upgrades, or config changes.
Remote exposure requires approved HTTPS/private networking and protected bearer authentication.

## Connect and verify

In **Agents → Connection settings → Advanced**, use `http://127.0.0.1:18789/or3/` for the default local Gateway and enter the bearer token through the credential field.
Retain `/or3/` for an approved remote host.
Confirm a published bootstrap route is released and qualified before recommending a guided Connect command; otherwise use the manual URL/token connection.

Verify incremental text/tool activity, the advertised command/model/thinking choices, supported attachments within advertised bounds, and cancellation that preserves partial output.
Do not fabricate per-message mode, isolation, or workspace controls that this bridge does not implement.

For stale/missing features, inspect runtime registration and restart before changing OR3.
For final-only responses, inspect SSE CORS/proxy buffering rather than hiding the problem with polling or longer timeouts.
Model/provider setup and advertised capabilities belong to OpenClaw.

Report runtime/plugin versions, service status, non-secret URL/origin, verification, and material limitations using [completion guidance](../../shared/completion-contract.md).

## References

- [OpenClaw installation](https://docs.openclaw.ai/getting-started)
- [OpenClaw Gateway](https://docs.openclaw.ai/gateway)
- [OpenClaw plugins](https://docs.openclaw.ai/tools/plugin)
- [Plugin README](../../../openclaw-or3/README.md)
- [Permissions and trust](../../shared/permissions-and-trust.md)
