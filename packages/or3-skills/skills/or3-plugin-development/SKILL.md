---
name: or3-plugin-development
description: Build, modify, debug, test, package, and assess installation of OR3 Chat plugins. Use when a user requests a pane, dashboard item, sidebar feature, command, chat action, AI tool, editor extension, document action, or third-party integration.
license: GPL-3.0
compatibility: Local browser development requires an OR3 Chat checkout and Bun. Installable packages use the current @or3/plugin-sdk contract.
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

Choose **source development** when changing bundled checkout code through an
existing registry or composable. App aliases and Nuxt imports belong to that
checkout boundary, not to installable SDK packages.

Choose an **SDK package** for an installable plugin. Start with a portable
`isolated-client` worker for host-rendered UI, storage, approved model calls,
and client tools. Choose `trusted-host` for reviewed Vue, hooks, chat/editor
integrations, or server routes. Packages import `@or3/plugin-sdk` and documented
runtime subpaths, never app aliases or Nuxt auto-imports. Both client paths have
production adapters; package loading, grants, browser checks, and workspace
enablement still gate activation. Portable execution currently requires a
qualified Chromium browser. The manifest's `isolated-server` vocabulary is not
a supported production installation mode. Consult the SDK support table before
requesting a capability; typed methods can still be unsupported.

## Workflow

1. Confirm a plugin is the correct surface and identify the smallest supported
   contribution(s). Prefer an existing contract over a core change.
2. Use stable, namespaced IDs. Keep client/server boundaries explicit, load
   optional UI lazily, and register cleanup for every registration.
3. Request only grants necessary for the feature. State network domains,
   storage, server execution, and trust. `trusted-host` is not a sandbox;
   isolated descriptors must fail closed if isolation is unavailable.
4. Version settings and declare state compatibility before code that persists
   data. Explain what disable, uninstall, data deletion, and pointer rollback
   each do; they are not interchangeable.
5. Add or extend the canonical tests. Validate public imports and manifests at
   the package boundary; never hide an unsupported capability behind `any` or a
   private host import.
6. For an SDK package, run the checkout's actual CLI sequence:
   `validate`, `test`, `build`, `pack`, and `inspect`. For checkout changes, run the affected
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
- `public/_documentation/plugins/overview.md`
- `public/_documentation/plugins/first-plugin.md`
- `public/_documentation/plugins/manifest.md`
- `public/_documentation/plugins/plugin-sdk.md`
- `public/_documentation/plugins/runtime-and-security.md`
