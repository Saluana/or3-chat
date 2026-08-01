---
name: or3-plugin-development
description: Build, modify, debug, test, package, and assess installation of OR3 Chat plugins. Use when a user requests a pane, dashboard item, sidebar feature, command, chat action, AI tool, editor extension, document action, or third-party integration.
license: GPL-3.0
compatibility: Requires an OR3 Chat checkout; Bun is required for plugin-runtime commands. V2 authoring requires the checkout's @or3/plugin-sdk contract.
metadata:
  author: OR3
  version: 0.1.0
  or3-product: or3-chat
  or3-plugin-api: "1,2"
---

# OR3 plugin development

## Purpose

Implement the smallest functional OR3 extension through an existing registry,
hook, or public SDK contract; test it; and report its grants, trust boundary,
artifact status, and removal path honestly.

## When to use

Use for new behavior: panes, pages, commands, actions, tools, integrations,
and supported editor or document extensions. Do not use for colors/spacing,
installation, provider implementation, or a missing public contract. Route
those using the [extension decision tree](../../shared/extension-decision-tree.md).

## Required first steps

1. Read [repository navigation](../../shared/repository-navigation.md), then
   the plugin pages selected by the docmap.
2. Inspect the matching public type, SDK contract, example, and canonical test
   before implementation. Do not select a contribution kind from an old skill.
3. State the intended contribution IDs, runtime, state/settings need, grants,
   trust tier, target distribution, and rollback before writing code.

## Runtime selection

Choose **V1** when the feature must run in the present product workspace, is a
bundled/check-out extension, or needs a capability exposed only by the current
V1 registry. Follow the local registry and cleanup conventions; V1 is not a
portable public-SDK boundary.

Choose **V2** for a public-SDK package or a validation/packaging artifact. V2
code imports only `@or3/plugin-sdk` and documented subpaths, never `~/`,
`~~/`, `#imports`, Nuxt auto-imports, or application internals. The currently
supported V2 production path is reviewed `trusted-host` server routes: package,
canary, promote, enable the workspace, then serve authorized SSR requests.
Client-entry packages remain blocked by the host ABI gate. Package and inspect
the artifact, and report the exact activation path rather than claiming browser
activation or isolation.

## Workflow

1. Confirm a plugin is the correct surface and identify the smallest supported
   contribution(s). Prefer an existing contract over a core change.
2. Use stable, namespaced IDs. Keep client/server boundaries explicit, load
   optional UI lazily, and register cleanup for every V1 registration.
3. Request only grants necessary for the feature. State network domains,
   storage, server execution, and trust. `trusted-host` is not a sandbox;
   isolated descriptors must fail closed if isolation is unavailable.
4. Version settings and declare state compatibility before code that persists
   data. Explain what disable, uninstall, data deletion, and pointer rollback
   each do; they are not interchangeable.
5. Add or extend the canonical tests. Validate public imports and manifests at
   the package boundary; never hide an unsupported capability behind `any` or a
   private host import.
6. For V2, run the checkout's actual CLI sequence:
   `validate`, `test`, `build`, `pack`, and `inspect`. For V1, run the affected
   test and typecheck required by the touched registry or types.
7. Do not claim installation, promotion, or isolation solely from a successful
   build or package command.

## Failure handling

If no supported public extension point exists, stop and route to
`or3-core-development` with the requested capability, closest existing surface,
and evidence that the surface is insufficient. Do not add a one-off core path.

## Completion output

Follow the [completion contract](../../shared/completion-contract.md). Include
runtime choice and reason, contribution IDs, exact grants/trust, checks,
artifact digest/path when present, activation status, disable/remove steps, and
actual residual risks.

## References to load

- [Quality gates](../../shared/quality-gates.md)
- [Permissions and trust](../../shared/permissions-and-trust.md)
- `public/_documentation/plugins/runtime-v2-overview.md`
- `public/_documentation/plugins/v1-support-and-migration.md`
- `public/_documentation/plugins/manifest-v2.md`
- `public/_documentation/plugins/plugin-sdk.md`
- `public/_documentation/plugins/trust-and-safe-mode.md`
