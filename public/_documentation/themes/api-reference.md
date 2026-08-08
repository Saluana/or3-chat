# API Reference: Theme System

Reference for the current OR3 theme system API, types, and tooling.

## ThemeDefinition

Theme definitions live in `app/theme/<theme>/theme.ts` and use
`defineTheme()` from `app/theme/_shared/define-theme.ts`.

```ts
export interface ThemeDefinition {
  name: string;
  displayName?: string;
  description?: string;
  isDefault?: boolean;

  colors: ColorPalette;
  borderWidth?: string;
  borderRadius?: string;
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

- `componentContractVersion` must match the current contract version (`1`);
  incompatible versions fail validation. See `/themes/component-overrides`.
- `workspaceProfiles` packages declarative workspace layouts with the theme.
  They are registered as choices only; activating a theme never applies one.
  See `/architecture/workspace-profiles`.
- `recommendedWorkspaceProfileId` points at one of the packaged profiles as
  an explicit recommendation action, never an automatic selection.

For a practical guide to replacing app components, see
`/themes/component-overrides`.

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

### useThemeClasses

**Deprecated.** This helper used to apply `cssSelectors.class` for lazy-loaded
components:

```ts
import { useThemeClasses } from '~/composables/core/useThemeClasses';
useThemeClasses();
```

It is now a no-op that logs a warning in dev. The active theme's runtime
classes are applied automatically: a DOM observer watches for newly added
elements and applies matching classes. You do not need to call it.

### useIcon

Resolves a semantic icon token to a concrete icon name for the active theme:

```ts
import { useIcon } from '~/composables/useIcon';
const icon = useIcon('chat.send'); // computed<string>
```

### useThemeSelection

Reads and writes the user's theme selection. The source of truth is the Dexie
KV store (`theme_selection`), which syncs across devices. A legacy
`localStorage.activeTheme` value is migrated once. The `or3_active_theme`
cookie supplies the first SSR paint.

```ts
const { selectedTheme, selectionSource, setSelectedTheme } = useThemeSelection();
await setSelectedTheme('cyberpunk');
```

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

The client keeps this map on the default component set through hydration, then
swaps in theme overrides after mount. That behavior is intentional and prevents
SSR hydration mismatches when a theme override renders a different root
structure than the core component.

## CLI Commands

- `bun run theme:create` scaffold a theme in `app/theme/<name>` (writes
  `theme.ts` and a `README.md`).
- `bun run theme:validate [name]` validate themes and regenerate
  `types/theme-generated.d.ts` and the metadata manifest
  (`app/theme/_shared/theme-manifest.generated.ts`).
- `bun run theme:build-css` build `/public/themes/<name>.css` from
  `cssSelectors.style`.
- `bun run theme:switch` update `OR3_DEFAULT_THEME` in `.env`
  (does not change the current runtime theme).

During development, the theme compiler also runs as a Vite plugin
(`plugins/vite-theme-compiler.ts`). It validates themes on build start and
recompiles types and CSS on theme file changes (HMR).

## Generated Types

`types/theme-generated.d.ts` provides:

- `ThemeName` (available theme names)
- `ThemeContext` (known context names)
- `ThemeIdentifier` (available identifiers from overrides)
- `ThemeDirective` / `ThemeDirectiveValue` (directive binding types)
