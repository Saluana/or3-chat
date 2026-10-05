# Runtime and architecture

This page explains implementation and lifecycle. Start with
[Themes overview](/documentation/themes/overview) for the user and author paths.

## Discovery and compilation

`app/theme/_shared/theme-manifest.ts` discovers `app/theme/*/theme.ts`, optional
icon configurations, and local stylesheets with Vite globs. Installing source
files therefore requires a new production build before they can be loaded.
Declarative installation generates a `theme.ts` from validated JSON.

The default is the valid runtime-config branding theme, then a theme marked
`isDefault`, then the `retro` fallback, then the first sorted entry. Multiple
manifest defaults are rejected. This deployment default is separate from a
persisted personal/workspace selection.

`compileThemeDefinition()` is shared by runtime, SSR, and tooling. It generates
CSS variables and compiles overrides; `RuntimeResolver` merges matched props.
The compiler writes metadata to `theme-manifest.generated.ts` and available
names/contexts/identifiers to `types/theme-generated.d.ts`. Do not edit these
outputs manually. Configuration validation is best-effort and does not validate
every Vue caller contract or perform a full TypeScript check.

## Activation

A theme activation loads its definition and required stylesheets before changing
the visible selection. A failed required stylesheet load preserves the previous
theme. The activation coordinator discards stale concurrent switches.

Successful application updates `data-theme`, theme variables, selector classes,
backgrounds, icon registration, component mappings, and effective Nuxt UI config.
Generic config starts from the immutable host baseline, then a compatibility
app-config patch, then the canonical definition's `ui`. New themes author `ui`
in the definition rather than a separate `app.config.ts`.

Loaded definitions/resolvers can remain cached. Inactive visual resources and
owned runtime classes are withdrawn so a switch does not carry the old theme's
appearance into the new one. Selector sessions observe added DOM, cancel stale
jobs, and remove only their owned classes. They do not require a global rerender
or the obsolete `useThemeClasses()` helper.

Packaged workspace profiles are registered as choices by
`92.workspace-profile-theme.client.ts`. Selecting a theme never silently applies
one; a recommendation is an explicit action. See
[Workspace profiles](/documentation/architecture/workspace-profiles).

## SSR and hydration

The server selects an available theme from the SSR cookie/default and prepares
its tokens, stylesheets, app config, and component map for rendering. The client
first reapplies the theme named by the server-rendered HTML, including its
component overrides. A different persisted client preference is applied after
Nuxt is ready. Changing component implementations before hydrating the rendered
tree would corrupt that boundary.

Missing or unsafe replacement paths fall back to core components. This fallback
is not proof a package's requested replacement worked. User style overrides are
client-applied; their browser-local values are not a complete SSR appearance
snapshot. See [Replace app components](/documentation/themes/component-overrides).

The client restores the server icon registry before loading theme definitions
or preloading workspace profiles. Later registry injection must not hydrate it
again: that would discard the newly registered icon maps for cached themes.

## Persistence

| State | Owner / key |
| --- | --- |
| Selected theme | Active workspace Dexie KV: `theme_selection` |
| SSR selection | `or3_active_theme` cookie |
| Deployment default tracking | `or3_previous_default_theme` cookie |
| Light/dark mode | Browser localStorage: `theme` |
| Theme selection cache/compatibility | Browser localStorage: `activeTheme` |
| Personal style overrides | Browser localStorage: `or3:user-theme-overrides:light` and `:dark` |
| Accessibility | Browser localStorage: `or3:user-theme-accessibility` |

`useThemeSelection()` captures the originating database during loads/saves so a
late completion cannot publish into a different active workspace. KV is the
selection repository; localStorage is compatibility/cache state and the cookie
supports SSR. Sync of KV depends on the workspace's configured sync.

Personal styles and accessibility currently persist in browser localStorage,
not a signed-in account preference repository. Style groups apply above the
active authored theme and are separate per mode. Disabling a group removes its
inline values and restores authored tokens while preserving its saved settings.
Density/elevation presets are per mode. Focus width and reduced motion are
global browser preferences. Read the user workflow in
[Customize your appearance](/documentation/themes/customize).

## Styling boundaries

| Mechanism | Vue props | DOM appearance | Code requirement |
| --- | --- | --- | --- |
| Tokens and `ui` | Nuxt UI recipes | Shared variables/recipes | Declarative |
| `useThemeOverrides()` with `v-bind` | Yes | Bound class/style props | Host source integration |
| `v-theme` | No | Owned decoration and annotations | Host source integration |
| `cssSelectors.style` | No | Build-generated scoped CSS | Declarative |
| `cssSelectors.class` | No | Runtime-owned classes | Declarative |
| `customComponents` | Caller contract | Replacement Vue tree | Trusted-code |

The directive detects only four built-in contexts and always supplies default
state. Explicit context and manual resolver state are separate features; native
hover/focus styling belongs in CSS. [Style your theme](/documentation/themes/styling)
shows examples.
