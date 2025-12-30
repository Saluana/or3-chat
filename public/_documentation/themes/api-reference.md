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
}
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

### Attributes added

The directive sets `data-v-theme` and may add `data-id`,
`data-theme-color`, `data-theme-variant`, and `data-theme-size`
on the rendered element.

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

Applies `cssSelectors.class` for lazy-loaded components:

```ts
import { useThemeClasses } from '~/composables/core/useThemeClasses';
useThemeClasses();
```

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

## CLI Commands

- `bun run theme:create` scaffold a theme in `app/theme/<name>`.
- `bun run theme:validate [name]` validate themes and generate
  `types/theme-generated.d.ts`.
- `bun run theme:build-css` build `/public/themes/<name>.css` from
  `cssSelectors.style`.
- `bun run theme:switch` update the default theme in app config
  (does not change the current runtime theme).

## Generated Types

`types/theme-generated.d.ts` provides:

- `ThemeName` (available theme names)
- `ThemeContext` (known context names)
- `ThemeIdentifier` (available identifiers from overrides)
- `ThemeDirective` / `ThemeDirectiveValue` (directive binding types)
