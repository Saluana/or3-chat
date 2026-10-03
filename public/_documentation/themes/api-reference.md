# Theme reference

Reference for the current OR3 theme system API, types, and tooling.

## ThemeDefinition

Trusted-code definitions live in `app/theme/<theme>/theme.ts` and use
`defineTheme()` from `app/theme/_shared/define-theme.ts`. Declarative packages
express the same configuration as JSON in `or3.theme.json`; the installer
generates the runtime adapter. Start with [Build your first theme](/documentation/themes/first-theme).

```ts
export interface ThemeDefinition {
  name: string;
  displayName?: string;
  description?: string;
  isDefault?: boolean;

  colors: ColorPalette;
  borderWidthSubtle?: string;
  borderWidth?: string;
  borderWidthStrong?: string;
  borderRadiusSmall?: string;
  borderRadius?: string;
  borderRadiusLarge?: string;
  density?: ThemeDensityTokens;
  focus?: ThemeFocusTokens;
  motion?: ThemeMotionTokens;
  elevation?: ThemeElevationTokens;
  fonts?: ThemeFonts;

  overrides?: Record<string, OverrideProps>;
  cssSelectors?: Record<string, CSSelectorConfig>;
  stylesheets?: string[];

  ui?: Record<string, unknown>;
  propMaps?: PropClassMaps;
  backgrounds?: ThemeBackgrounds;
  icons?: Record<string, string>;
  customComponents?: Partial<Record<AppThemeComponent, string>>;
  componentContractVersion?: 1;
  workspaceProfiles?: WorkspaceProfileV1[];
  recommendedWorkspaceProfileId?: string;
}
```

The middle width and radius fields remain the compatibility defaults. Omitted
outer tiers inherit from `borderWidth` or `borderRadius`, respectively.

The compiler emits `--md-border-width-subtle`, `--md-border-width`,
`--md-border-width-strong`, `--md-border-radius-small`, `--md-border-radius`, and
`--md-border-radius-large`. Source controls should consume these tokens with
their existing fallbacks instead of copying the current theme's numeric values.

- When `customComponents` is non-empty, `componentContractVersion` must match
  the current contract version (`1`). A missing version warns; an incompatible
  version fails validation. See [Replace app components](/documentation/themes/component-overrides).
- `workspaceProfiles` packages declarative workspace layouts with the theme.
  They are registered as choices only; activating a theme never applies one.
  See [Workspace profiles](/documentation/architecture/workspace-profiles).
- `recommendedWorkspaceProfileId` points at one of the packaged profiles as
  an explicit recommendation action, never an automatic selection.

For a practical guide to replacing app components, see
[Replace app components](/documentation/themes/component-overrides).

### AppThemeComponent

Theme component overrides are keyed by a strict union. Paths are relative to the
theme root directory, for example:
`customComponents: { 'chat-message': './components/MyChatMessage.vue' }`.

```ts
export type AppThemeComponent =
  | 'sidebar'
  | 'sidebar-collapsed'
  | 'chat-page'
  | 'chat-message'
  | 'chat-input'
  | 'document-editor'
  | 'dashboard-modal'
  | 'model-selector'
  | 'system-prompts-modal'
  | 'model-catalog-modal'
  | 'sidebar-auth-button'
  | 'documentation-shell'
  | 'workflow-status';
```

### ColorPalette

Required colors: `primary`, `secondary`, `surface`.

```ts
export interface ColorPalette {
  primary: string;
  secondary: string;
  surface: string;

  onPrimary?: string;
  onSecondary?: string;
  onSurface?: string;

  primaryContainer?: string;
  onPrimaryContainer?: string;
  secondaryContainer?: string;
  onSecondaryContainer?: string;
  tertiary?: string;
  onTertiary?: string;
  tertiaryContainer?: string;
  onTertiaryContainer?: string;
  error?: string;
  onError?: string;
  errorContainer?: string;
  onErrorContainer?: string;
  surfaceVariant?: string;
  onSurfaceVariant?: string;
  inverseSurface?: string;
  inverseOnSurface?: string;
  outline?: string;
  outlineVariant?: string;
  borderColor?: string;
  success?: string;
  warning?: string;
  info?: string;

  dark?: Partial<ColorPalette>;
  [customToken: string]: string | undefined | Partial<ColorPalette>;
}
```

### ThemeFonts

```ts
export interface ThemeFonts {
  sans?: string;
  heading?: string;
  mono?: string;
  baseSize?: string;
  baseWeight?: string;
  dark?: ThemeFontSet;
}
```

### Appearance token groups

All appearance token groups are optional. Consumers must use local literal
fallbacks so themes that omit the contract retain their existing appearance.

```ts
export interface ThemeDensityTokens {
  controlHeightSmall?: string;
  controlHeightMedium?: string;
  controlHeightLarge?: string;
  spaceControl?: string;
  spaceSection?: string;
}

export interface ThemeFocusTokens {
  ringColor?: string;
  ringOffset?: string;
}

export interface ThemeMotionTokens {
  durationFast?: string;
  durationMedium?: string;
  durationSlow?: string;
  easingStandard?: string;
}

export interface ThemeElevationTokens {
  low?: string;
  medium?: string;
  high?: string;
}
```

The generated variables are:

| Group | Variables |
|---|---|
| Density | `--app-control-height-small`, `--app-control-height-medium`, `--app-control-height-large`, `--app-space-control`, `--app-space-section` |
| Focus | `--md-focus-ring`, `--app-focus-ring-offset` |
| Motion | `--app-motion-duration-fast`, `--app-motion-duration-medium`, `--app-motion-duration-slow`, `--app-motion-easing-standard` |
| Elevation | `--app-elevation-low`, `--app-elevation-medium`, `--app-elevation-high` |

The globally user-controlled `--app-focus-ring-width` is separate from the
theme DSL and is constrained to 1–4px.

### ThemeBackgroundLayer

Each background slot accepts these fields:

| Field | Behavior |
| --- | --- |
| `image` | URL, `internal-file://<hash>` token, or null |
| `color` | Optional CSS background color |
| `opacity` | Clamped to 0–1 at runtime |
| `repeat` | `repeat`, `no-repeat`, `repeat-x`, or `repeat-y` |
| `size` | CSS background size such as `150px` or `auto 100%` |
| `fit` | `cover` or `contain`; takes precedence over `size` |

The source contract is `app/theme/_shared/types.ts`. See
[Background layers](/documentation/themes/styling#background-layers) for authoring
and [personal background images](/documentation/themes/customize#background-images)
for user uploads.

### ThemeBackgrounds

```ts
export interface ThemeBackgrounds {
  content?: {
    base?: ThemeBackgroundLayer;
    overlay?: ThemeBackgroundLayer;
  };
  sidebar?: ThemeBackgroundLayer;
  headerGradient?: ThemeBackgroundLayer;
  bottomNavGradient?: ThemeBackgroundLayer;
}
```

### OverrideProps

```ts
export interface OverrideProps {
  variant?: string;
  size?: string;
  color?: string;
  class?: string;
  style?: Record<string, string>;
  ui?: Record<string, unknown>;
  [key: string]: unknown;
}
```

### CSSelectorConfig

```ts
export interface CSSelectorConfig {
  style?: Record<string, string>;
  class?: string;
}
```

## defineTheme()

Factory for type-safe theme definitions with runtime validation (dev-only).

```ts
import { defineTheme } from '~/theme/_shared/define-theme';

export default defineTheme({
  name: 'blank',
  colors: {
    primary: '#086db8',
    secondary: '#ff6b6b',
    surface: '#ffffff',
  },
});
```

## v-theme Directive

Registered in `app/plugins/00.theme-directive.ts` (SSR no-op) and
`app/plugins/91.auto-theme.client.ts` (client implementation).

### Usage

```vue
<UButton v-theme>Click</UButton>
<UButton v-theme="'chat.send'">Send</UButton>
<UButton v-theme="{ identifier: 'chat.send', theme: 'blank', context: 'chat' }">
  Send
</UButton>
```

### Binding values

- No value: auto-detect component name + context.
- String: treated as `identifier` (no parsing into context).
- Object: `{ identifier?, theme?, context? }`.

### Context detection

The directive walks DOM ancestry and matches these containers:

- `#app-chat-container` or `[data-context="chat"]`
- `#app-sidebar` or `[data-context="sidebar"]`
- `#app-dashboard-modal` or `[data-context="dashboard"]`
- `#app-header` or `[data-context="header"]`
- fallback: `global`

For manual bindings (`v-theme="{ context: '...' }"`), the known context set is:

- `chat`
- `sidebar`
- `dashboard`
- `header`
- `global`
- `settings`
- `shell`
- `message`
- `modal`
- `document`
- `image-viewer`
- `images`
- `prompt`
- `docs`
- `ui`

These values come from the shared context list used by the theme runtime (`app/theme/_shared/contexts.ts`).

### Attributes added

The directive sets `data-v-theme` and may add `data-id`,
`data-theme-color`, `data-theme-variant`, and `data-theme-size`
on the rendered element. It also applies resolved `class` and `style` values
and removes only the DOM state it owns when the theme changes or the directive
unmounts.

The directive does **not** mutate Vue component props. For component props,
bind the reactive result from `useThemeOverrides()`:

```vue
<script setup lang="ts">
const sendTheme = useThemeOverrides({
  component: 'button',
  context: 'chat',
  identifier: 'chat.send',
  isNuxtUI: true,
});
</script>

<template><UButton v-bind="sendTheme">Send</UButton></template>
```

## RuntimeResolver

`app/theme/_shared/runtime-resolver.ts`

```ts
export interface ResolveParams {
  component: string;
  context?: string;
  identifier?: string;
  state?: string;
  element?: HTMLElement;
  isNuxtUI?: boolean;
}

export interface ResolvedOverride {
  props: Record<string, unknown>;
}

class RuntimeResolver {
  constructor(compiledTheme: CompiledTheme);
  resolve(params: ResolveParams): ResolvedOverride;
}
```

Notes:
- `element` enables attribute selector matching.
- `state` is only used if you pass it in manually.
- Non-Nuxt UI components map `variant`/`size`/`color` to classes via `propMaps`.

## Composables

### useThemeResolver

`app/composables/useThemeResolver.ts`

```ts
const { resolveOverrides, activeTheme, setActiveTheme } = useThemeResolver();
```

### useThemeOverrides (reactive)

```ts
const overrides = useThemeOverrides({
  component: 'button',
  context: 'chat',
  identifier: 'chat.send',
  isNuxtUI: true,
});
```

### useIcon

Resolves a semantic icon token to a concrete icon name for the active theme:

```ts
import { useIcon } from '~/composables/useIcon';
const icon = useIcon('chat.send'); // computed<string>
```

Create the computed during component setup. Read `icon.value` in script and
bind `icon` in a Vue template, where top-level refs are unwrapped. Tokens are
typed by `IconToken` in `app/config/icon-tokens.ts`; add a host token there before
using it in source controls. Theme maps use `IconMap` from
`app/theme/_shared/icon-registry.ts` and fall back to `DEFAULT_ICONS` for omitted
tokens. Let the theme loader register maps; theme authors do not need a second
registration plugin. See [icon authoring](/documentation/themes/styling#icons).

### useUserThemeOverrides

`app/core/theme/useUserThemeOverrides.ts` manages browser-local personal
appearance. Create it during client component setup or client Nuxt plugin
initialization: its first browser call resolves the Nuxt theme plugin. It is a
shared browser store, not request-scoped SSR state or a portable SDK API.

| Member | Behavior |
| --- | --- |
| `overrides` | Computed overrides for the active light/dark mode |
| `light`, `dark`, `activeMode` | Shared refs; use the methods below to change preferences |
| `set(patch)` | Validates and deep-merges a partial `UserThemeOverrides` into the active mode |
| `reset(mode?)`, `resetAll()` | Discards the chosen mode's customizations or both modes |
| `switchMode(mode)` | Changes the active mode and asks the theme plugin to apply it |
| `reapply()` | Schedules merged appearance application and persistence |

`UserThemeOverrides` is defined in `app/core/theme/user-overrides-types.ts`.
Colors, backgrounds, shape, density, and elevation have `enabled` switches;
setting their values alone does not enable those groups. Typography values apply
directly. For example, inside a client component's setup:

```ts
import { useUserThemeOverrides } from '~/core/theme/useUserThemeOverrides';

const personalTheme = useUserThemeOverrides();
function increaseFont() {
  const current = personalTheme.overrides.value.typography?.baseFontPx ?? 20;
  personalTheme.set({
    typography: { baseFontPx: Math.min(current + 1, 24) },
  });
}
```

Appearance application is batched and localStorage persistence is delayed by
50ms. A successful `set()` call does not confirm durable storage; quota failures
can still prevent saving. Light/dark override keys are listed in
[persistence](/documentation/themes/architecture#persistence). Global focus
width and motion preferences have a separate accessibility owner. The store's
HMR teardown stops its watcher/observer and revokes owned background URLs.

`ui.reducePatternsInHighContrast` caps explicitly configured workspace
base/overlay and sidebar opacities at 0.04 while a high-contrast mode is active.
Saved background preferences use `internal-file://<hash>` tokens; the runtime
owns their temporary object URLs. See
[background images](/documentation/themes/customize#background-images).

### useThemeSelection

Reads and writes the active workspace's theme selection. The source of truth is
its Dexie KV store (`theme_selection`); cross-device propagation depends on
the configured workspace sync provider. A legacy
`localStorage.activeTheme` value is migrated once. The `or3_active_theme`
cookie supplies the first SSR paint.

```ts
const { selectedTheme, selectionSource, setSelectedTheme } = useThemeSelection();
await setSelectedTheme('cyberpunk');
```

`setSelectedTheme()` persists the preference; activate the appearance through
`useThemeResolver().setActiveTheme()` or `$theme.setActiveTheme()`.

`getThemeSelectionSync()` returns the current selection synchronously (with a
localStorage fallback) for plugin initialization.

### Typed override helpers

`app/composables/useTypedThemeOverrides.ts` provides type-safe wrappers around
`useThemeOverrides()` for common Nuxt UI components. Each merges base props
with theme overrides and returns a computed:

- `useButtonOverrides(params, baseProps)`
- `useInputOverrides(params, baseProps)`
- `useTextareaOverrides(params, baseProps)`
- `useModalOverrides(params, baseProps)`
- `usePlainOverrides(params, baseProps)` (plain HTML elements)

## Theme plugin ($theme)

Injected by `app/plugins/90.theme.client.ts` and
`app/plugins/90.theme.server.ts`.

Key APIs:

- `set(name)` / `toggle()` / `get()` / `system()` for light/dark mode classes
- `activeTheme` ref
- `setActiveTheme(themeName)`
- `getResolver(themeName)`
- `getTheme(themeName)`
- `loadTheme(themeName)`
- `resolversVersion` ref
- `activeComponents` ref

### activeComponents

`activeComponents` is the runtime map of resolved app component targets.

It always contains every supported `AppThemeComponent` key. Any key not
overridden by the active theme points to the core default component.

SSR resolves components for the cookie/default theme. The client applies that
server-rendered theme before hydration. If the persisted client selection differs,
it switches after `onNuxtReady`, preserving the server-rendered structure during
hydration. See [Runtime and architecture](/documentation/themes/architecture).

## CLI Commands

- `bun run theme:create` scaffold a theme in `app/theme/<name>` (writes
  `theme.ts` and a `README.md`).
- `bun run theme:validate [name]` validate themes and regenerate
  `types/theme-generated.d.ts` and the metadata manifest
  (`app/theme/_shared/theme-manifest.generated.ts`). The compiler processes all
  themes before filtering the requested report. This is configuration validation,
  not a full TypeScript or component conformance check.
- `bun run theme:build-css` build `/public/themes/<name>.css` from
  `cssSelectors.style`.
- `bun run theme:switch` update `OR3_DEFAULT_THEME` in `.env`
  (restart the host to pick up the new deployment default; this does not change
  the current browser selection).

During development, the theme compiler also runs as a Vite plugin
(`plugins/vite-theme-compiler.ts`). It validates themes on build start and
recompiles types and CSS on theme file changes (HMR).

## Generated Types

`types/theme-generated.d.ts` provides:

- `ThemeName` (available theme names)
- `ThemeContext` (known context names)
- `ThemeIdentifier` (available identifiers from overrides)
- `ThemeDirective` / `ThemeDirectiveValue` (directive binding types)
