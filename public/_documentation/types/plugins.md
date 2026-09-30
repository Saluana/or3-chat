# Plugin types

Use the type surface for the runtime you are building. The supported portable package contract comes from `@or3/plugin-sdk`; private host aliases and globals are source integration details.

| Runtime or feature | Source of truth |
| --- | --- |
| Portable plugin context, results, UI, storage, and contributions | `@or3/plugin-sdk`; [SDK reference](/documentation/plugins/plugin-sdk). |
| Package manifest, grants, and runtime declarations | [Manifest reference](/documentation/plugins/manifest). |
| Trusted source host integration | `~/composables/plugins/trusted-host-context` and its workspace registry adapter. |
| Pane app definitions | `~/composables/core/usePaneApps` (PaneAppDef). |
| Sidebar page definitions | `~/composables/sidebar/useSidebarPages` (SidebarPageDef). |
| Host pane/post actions | `~/plugins/pane-plugin-api.client` (PanePluginApi and Result). |
| Workspace contribution access policy | `~~/shared/plugins/access-policy`; [plugin access policy](/documentation/cloud/plugin-access-gating). |

The ambient `types/pane-plugin-api.d.ts` declaration describes the existing `window.__or3PanePluginApi` host handle; it is not the portable SDK entry point. `types/theme-plugin.d.ts` augments Nuxt/Vue's injected theme API. Import source types instead of maintaining copied declarations in a package.

SDK results and host pane results use different contracts. Narrow the result you actually receive before reading success data, and handle failure codes. Types and UI access policies do not replace server authorization.

For a complete example, use [Build your first plugin](/documentation/plugins/first-plugin). For source-only pane/sidebar integration, use [the source pane tutorial](/documentation/start/mini-app-tutorial).
