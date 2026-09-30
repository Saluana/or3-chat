# Plugins overview

Plugins add tools and apps to OR3: a task list in the workspace, a command in the
palette, a document utility, or an integration with an external service.

If you want to use a plugin, start with [Install and manage plugins](/documentation/plugins/install-and-manage).
If you want to make one, start with [Build your first plugin](/documentation/plugins/first-plugin).
You can develop and test locally before creating a marketplace account.

## Choose a development path

Installable workspace plugins use `@or3/plugin-sdk` and an `or3.manifest.json`
file. The host reviews the package's permissions before it runs.

| Path | Use it for | How it runs |
| --- | --- | --- |
| Portable plugin | Forms, lists, saved data, document utilities, approved model calls, and client chat tools | JavaScript in an isolated worker; OR3 renders its UI and mediates capabilities |
| Trusted-host plugin | Custom Vue components, pane registrations, chat renderers, editor extensions, hooks, and declared server routes | Reviewed code in the host page or server; it has no sandbox boundary |
| Admin plugin | Pages and overview widgets in the global administrator dashboard | A separate extension API with build-time discovery; see [Admin plugins](/documentation/plugins/admin-plugins) |

Start with a portable plugin unless your feature needs trusted-host integrations.
Portable plugins can appear in the sidebar, workspace tabs, and dashboard. They
can also expose chat tools under a reviewed permission. These surfaces do not
require transferring Vue components into the sandbox.

Editing `app/plugins/*.client.ts` directly is source development in OR3 itself.
Those files can use app composables and Nuxt imports; an installable SDK package
cannot. Examples intended for source development are not drop-in package entries.

## What works on this host

- Installing and running marketplace packages requires an SSR deployment,
  authentication, and operator-enabled package loading. Static builds retain
  their normal local-first behavior; they cannot run the mediated package runtime.
- Portable execution is currently qualified for Chromium browsers, including
  Chrome and Edge. Firefox and Safari may browse available documentation and
  listings, but portable execution is refused.
- The host supports `isolated-client` and `trusted-host` packages. The manifest
  type also names `isolated-server`; it is not an installable production mode on
  the current host.
- SDK types describe more operations than the host currently implements.
  Consult the [SDK support table](/documentation/plugins/plugin-sdk#supported-operations) before
  requesting permissions.
- This source tree's release workflows do not publish the SDK. The local
  development command packs it for you; manual setup uses a local tarball.

## Learn in order

1. [Build your first plugin](/documentation/plugins/first-plugin): create, render, interact, save,
   reload, and verify disable/re-enable behavior.
2. [Add features](/documentation/plugins/add-features): workspace UI, storage, chat tools, document
   context, model calls, and trusted-host commands.
3. [Publish your plugin](/documentation/plugins/publish): freeze the exact tested files and submit
   them for review.

Use [Manifest](/documentation/plugins/manifest), [SDK](/documentation/plugins/plugin-sdk), and [CLI](/documentation/plugins/plugin-sdk-cli) when
looking up an exact contract. [Connections](/documentation/plugins/connections) explains credential
custody. [Runtime and security](/documentation/plugins/runtime-and-security) covers operator setup,
permissions, safe mode, and recovery.

## Examples

The repository contains three ordinary portable packages under `official-plugins/`:

| Example | What to study |
| --- | --- |
| `or3-model-compare` | Approved model discovery, disclosed prices, and comparison results |
| `or3-prompt-workbench` | Forms, UI actions, persistent presets, and explicit field replacement |
| `or3-document-utilities` | Selected or sample document context, offline transformations, and approved writes |

They use the same permissions and installation pipeline as community packages.
Their presence in the source tree does not install them into your workspace.
Each package has its own README, source, fixtures, and tests. Workflows and
External Agents are separate trusted-host packages; their host-specific bridges
are not general SDK capabilities available to every plugin.
