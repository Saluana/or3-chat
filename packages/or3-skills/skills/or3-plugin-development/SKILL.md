---
name: or3-plugin-development
description: Build, debug, validate, and package OR3 Chat plugins or source contributions such as panes, commands, tools, editor extensions, and integrations.
license: GPL-3.0
compatibility: Local browser development requires an OR3 Chat checkout and Bun. Installable packages use the current @or3/plugin-sdk contract.
metadata:
  author: OR3
  version: 0.1.0
  or3-product: or3-chat
  or3-plugin-api: "1,2"
---

# OR3 plugin development

Use existing registries or public SDK contracts for the requested behavior.
Consult the checkout's plugin overview, SDK support table, and defining types through [repository navigation](../../shared/repository-navigation.md).

## Runtime choice

- Source contributions run in the checkout and may use app composables and Nuxt imports.
- Installable packages use `@or3/plugin-sdk` and documented runtime subpaths, without app aliases or Nuxt auto-imports.
- Prefer portable `isolated-client` packages for supported host-rendered UI, storage, approved model calls, and client tools.
- Use reviewed `trusted-host` packages for supported Vue, hooks, chat/editor integration, or server routes; this is not a sandbox.
- Both client paths have production adapters, subject to package verification, grants, browser qualification, and workspace enablement.
- `isolated-server` is not a supported production installation mode on this host; typed SDK methods can also be unsupported.

## Boundaries

- Use stable IDs that satisfy the target registry's schema and retain owned cleanup for registrations and resources.
- Keep tool execution runtimes, server/client imports, originating workspace identity, and optional UI loading explicit.
- Request only necessary grants and network destinations; isolation must fail closed rather than silently use trusted execution.
- Version persisted settings and honor state compatibility; disable, uninstall, data deletion, and pointer rollback are distinct operations.
- Inspect actual SDK/types/examples rather than copying an API from an older skill.

Validate package imports and manifest/grants, then use the current CLI's `validate`, `test`, `build`, `pack`, and `inspect` operations.
For source edits, run affected canonical tests and type checks.
Successful packaging does not establish installation, browser activation, or promotion.

If the public surface cannot express the feature, route the missing capability to `or3-core-development` with the relevant evidence.
See [quality gates](../../shared/quality-gates.md), [permissions and trust](../../shared/permissions-and-trust.md), and [completion guidance](../../shared/completion-contract.md).

Checkout references: `public/_documentation/plugins/overview.md`, `first-plugin.md`, `plugin-sdk.md`, `manifest.md`, and `runtime-and-security.md` in that category.
