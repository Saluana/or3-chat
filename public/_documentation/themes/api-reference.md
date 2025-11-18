# API Reference: Refined Theme System

Complete reference for OR3's refined theme system APIs, types, and functions.

## Table of Contents

-   [Theme Definition](#theme-definition)
-   [defineTheme()](#definetheme)
-   [v-theme Directive](#v-theme-directive)
-   [RuntimeResolver](#runtimeresolver)
-   [CLI Commands](#cli-commands)
-   [TypeScript Types](#typescript-types)

---

## Theme Definition

### ThemeDefinition

The core interface for defining themes.

```typescript
interface ThemeDefinition {
    name: string;
    displayName?: string;
    description?: string;
    isDefault?: boolean;
    colors: ColorPalette;
    borderWidth?: string;
    borderRadius?: string;
    overrides?: Record<string, OverrideProps>;
    cssSelectors?: Record<string, CSSelectorConfig>;
    stylesheets?: string[];
    ui?: Record<string, unknown>;
    propMaps?: PropClassMaps;
    backgrounds?: ThemeBackgrounds;
    fonts?: ThemeFonts;
}
```

#### Properties

-   **`name`** (required): Unique theme identifier (kebab-case)
-   **`displayName`** (optional): Human-readable name shown in UI
-   **`description`** (optional): Brief description of the theme
-   **`isDefault`** (optional): Whether this is the default theme
-   **`colors`** (required): Material Design 3 color palette
-   **`borderWidth`** (optional): Default border width (e.g., '2px')
-   **`borderRadius`** (optional): Default border radius (e.g., '3px')
-   **`overrides`** (optional): Component-specific prop overrides
-   **`cssSelectors`** (optional): Direct DOM targeting configuration
-   **`stylesheets`** (optional): External CSS files to load
-   **`ui`** (optional): Nuxt UI config extensions
-   **`propMaps`** (optional): Custom semantic prop-to-class mappings
-   **`backgrounds`** (optional): Background layer configuration
-   **`fonts`** (optional): Font family definitions

---

## Theme Backgrounds

Configuration for app background layers.

### Interface

```typescript
interface ThemeBackgrounds {
    content?: {
        base?: ThemeBackgroundLayer;
        overlay?: ThemeBackgroundLayer;
    };
    sidebar?: ThemeBackgroundLayer;
    headerGradient?: ThemeBackgroundLayer;
    bottomNavGradient?: ThemeBackgroundLayer;
}

interface ThemeBackgroundLayer {
    image?: string | null;
    color?: string;
    opacity?: number;
    repeat?: 'repeat' | 'no-repeat' | 'repeat-x' | 'repeat-y';
    size?: string;
    fit?: 'cover' | 'contain';
}
```

---

## Theme Fonts

Font family definitions.

### Interface

```typescript
interface ThemeFonts {
    sans?: string;
    heading?: string;
    mono?: string;
    baseSize?: string; // e.g. '16px'
    baseWeight?: string; // e.g. '400'
    dark?: ThemeFontSet; // Dark mode overrides
}
```

---

## Prop Class Maps

Map semantic props to CSS classes for non-Nuxt UI components.

### Interface

```typescript
interface PropClassMaps {
    variant?: Record<string, string>;
    size?: Record<string, string>;
    color?: Record<string, string>;
}
```

---

## defineTheme()

````

#### Properties

- **`name`** (required): Unique theme identifier (kebab-case)
- **`displayName`** (required): Human-readable name shown in UI
- **`description`** (optional): Brief description of the theme
- **`colors`** (required): Material Design 3 color palette
- **`overrides`** (optional): Component-specific prop overrides
- **`extends`** (optional): Base theme to inherit from

---

## defineTheme()

Factory function for creating type-safe themes.

### Signature

```typescript
function defineTheme(definition: ThemeDefinition): ThemeDefinition
````

### Parameters

-   **`definition`**: `ThemeDefinition` - The theme configuration object

### Returns

`ThemeDefinition` - The validated theme definition

### Example

```typescript
import { defineTheme } from '~/theme/_shared/define-theme';

export default defineTheme({
    name: 'my-theme',
    displayName: 'My Theme',
    colors: {
        primary: '#6366f1',
        onPrimary: '#ffffff',
        secondary: '#ec4899',
        onSecondary: '#ffffff',
        surface: '#ffffff',
        onSurface: '#1f2937',
    },
    overrides: {
        button: { variant: 'solid' },
    },
});
```

### Validation

`defineTheme()` performs compile-time validation:

-   Required colors: `primary`, `onPrimary`, `secondary`, `onSecondary`, `surface`, `onSurface`
-   Valid selector syntax in overrides
-   Type-safe override props

---

## ColorPalette

Material Design 3 color system.

### Interface

```typescript
interface ColorPalette {
    // Primary
    primary: string;
    onPrimary: string;
    primaryContainer?: string;
    onPrimaryContainer?: string;

    // Secondary
    secondary: string;
    onSecondary: string;
    secondaryContainer?: string;
    onSecondaryContainer?: string;

    // Surface
    surface: string;
    onSurface: string;
    surfaceVariant?: string;
    onSurfaceVariant?: string;

    // Background
    background?: string;
    onBackground?: string;

    // App-specific
    success?: string;
    warning?: string;
    error?: string;
    info?: string;

    // Dark mode overrides
    dark?: Partial<ColorPalette>;
}
```

### Color Requirements

#### Required Colors (Light Mode)

-   `primary`, `onPrimary`
-   `secondary`, `onSecondary`
-   `surface`, `onSurface`

#### Optional Colors

All container colors are auto-calculated if omitted using Material Design 3 algorithms.

#### Dark Mode

Define `dark: {}` to override colors for dark mode:

```typescript
colors: {
    primary: '#6366f1',
    // ... other light colors

    dark: {
        primary: '#818cf8',  // Lighter shade for dark mode
        surface: '#1f2937',
        onSurface: '#f9fafb',
    }
}
```

---

## v-theme Directive

Vue directive for applying theme overrides to components.

### Usage

```vue
<template>
    <!-- Auto-detect context -->
    <UButton v-theme>Click</UButton>

    <!-- Explicit identifier (string) -->
    <UButton v-theme="'chat.send'">Send</UButton>

    <!-- Full options (object) -->
    <UButton v-theme="{ identifier: 'chat.send', theme: 'ocean' }">
        Send
    </UButton>
</template>
```

### Binding Types

#### 1. No Binding (Auto-detect)

```vue
<UButton v-theme>Click</UButton>
```

Automatically detects:

-   Component name from VNode
-   Context from nearest provider or route
-   Uses active theme from localStorage

#### 2. String Binding (Identifier)

```vue
<UButton v-theme="'chat.send'">Send</UButton>
```

Parses identifier as `context.id`:

-   `'chat.send'` → context: `chat`, id: `send`
-   `'send'` → context: auto-detect, id: `send`

#### 3. Object Binding (Full Control)

```vue
<UButton v-theme="{ identifier: 'chat.send', theme: 'ocean', context: 'chat' }">
    Send
</UButton>
```

**Options:**

-   `identifier?: string` - Full identifier (overrides context/id)
-   `context?: string` - Theme context
-   `id?: string` - Component identifier
-   `theme?: string` - Specific theme name (overrides active theme)

### Directive Lifecycle

The directive:

1. **Mounted**: Resolves overrides and applies to component instance
2. **Updated**: Re-applies when binding value changes
3. **Unmounted**: Cleans up watchers (automatic)

### SSR Compatibility

The directive is SSR-safe:

-   No-op during SSR rendering
-   `getSSRProps()` returns empty object
-   Hydrates correctly on client

---

## RuntimeResolver

Resolves theme overrides at runtime with <1ms performance.

### Class: RuntimeResolver

```typescript
class RuntimeResolver {
    constructor(overrides: Record<string, OverrideProps>);

    resolve(
        component: string,
        context?: string,
        identifier?: string,
        state?: string
    ): OverrideProps | null;
}
```

### Methods

#### `constructor(overrides)`

Creates a resolver instance with compiled overrides.

**Parameters:**

-   `overrides`: Theme overrides object from `ThemeDefinition`

**Example:**

```typescript
const resolver = new RuntimeResolver({
    button: { variant: 'solid' },
    'button.chat': { variant: 'ghost' },
});
```

#### `resolve(component, context?, identifier?, state?)`

Resolves the best matching override for a component.

**Parameters:**

-   `component`: Component name (e.g., `'button'`, `'input'`)
-   `context?`: Theme context (e.g., `'chat'`, `'sidebar'`)
-   `identifier?`: Component ID (e.g., `'send'`, `'new-chat'`)
-   `state?`: Component state (e.g., `'hover'`, `'focus'`)

**Returns:**
`OverrideProps | null` - Merged props or `null` if no match

**Example:**

```typescript
const props = resolver.resolve('button', 'chat', 'send');
// Returns: { variant: 'solid', color: 'primary', size: 'lg' }
```

### Specificity Algorithm

Selectors are matched by specificity (higher wins):

```typescript
// Specificity calculation:
- Element:    +1    (e.g., 'button')
- Context:    +10   (e.g., '.chat')
- Identifier: +20   (e.g., '#send')
- State:      +10   (e.g., ':hover')
- Attribute:  +10   (e.g., '[type="submit"]')
```

**Example:**

```typescript
'button'                     → specificity: 1
'button.chat'                → specificity: 11
'button#send'                → specificity: 21
'button.chat#send:hover'     → specificity: 41
```

### Performance

-   **Selector parsing**: ~0.1ms per selector (build-time cached)
-   **Resolution**: <1ms per component (runtime)
-   **Memory**: ~50KB per theme with 100 overrides

---

## CLI Commands

### `bun run theme:create`

Interactive wizard to create a new theme.

**Prompts:**

-   Theme name (kebab-case)
-   Display name
-   Description

**Creates:**

```
app/theme/<name>/
  ├── theme.ts
  └── styles.css
```

**Usage:**

```bash
bun run theme:create
```

---

### `bun run theme:validate [name]`

Validates theme definition(s).

**Arguments:**

-   `name` (optional): Specific theme to validate (validates all if omitted)

**Checks:**

-   Required colors present
-   Valid selector syntax
-   No specificity conflicts
-   TypeScript type errors

**Usage:**

```bash
# Validate all themes
bun run theme:validate

# Validate specific theme
bun run theme:validate ocean
```

**Output:**

```
✓ Theme 'ocean' is valid
  - 8/8 required colors defined
  - 12 overrides parsed successfully
  - No specificity conflicts
```

---

### `bun run theme:switch`

Interactive theme switcher.

**Prompts:**

-   Select theme from list

**Updates:**

-   `localStorage.activeTheme`
-   Reloads page to apply

**Usage:**

```bash
bun run theme:switch
```

---

### `bun run theme:compile`

Compiles all themes and generates TypeScript types.

**Generates:**

-   `types/theme-generated.d.ts` - TypeScript declarations
-   Compiled CSS variables in `app/theme/*/compiled.css`

**Usage:**

```bash
bun run theme:compile
```

**Runs automatically:**

-   During `bun run dev`
-   Before `bun run build`

---

## TypeScript Types

### ThemeName

Union type of all available theme names.

```typescript
type ThemeName = 'light' | 'dark' | 'ocean' | 'forest' | ...;
```

**Usage:**

```typescript
const theme: ThemeName = 'ocean';
```

---

### ThemeContext

Valid context values for theme overrides.

```typescript
type ThemeContext = 'chat' | 'sidebar' | 'dashboard' | 'header' | 'global';
```

---

### ThemeIdentifier

Full identifier string (context.id format).

```typescript
type ThemeIdentifier = `${ThemeContext}.${string}` | string;
```

**Examples:**

```typescript
const id1: ThemeIdentifier = 'chat.send';
const id2: ThemeIdentifier = 'sidebar.new-chat';
const id3: ThemeIdentifier = 'send'; // context auto-detected
```

---

### OverrideProps

Props that can be overridden for components.

```typescript
interface OverrideProps {
    variant?: 'solid' | 'outline' | 'ghost' | 'soft' | 'link';
    color?: 'primary' | 'secondary' | 'success' | 'error' | 'warning';
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
    class?: string;
    style?: Record<string, string>;
    ui?: Record<string, any>;
    [key: string]: any;
}
```

---

### ParsedSelector

Internal type for compiled CSS selectors.

```typescript
interface ParsedSelector {
    element: string;
    context?: string;
    identifier?: string;
    state?: string;
    attributes?: AttributeMatcher[];
}

interface AttributeMatcher {
    name: string;
    operator: '=' | '^=' | '$=' | '*=' | '~=' | '|=';
    value?: string;
}
```

---

## Hook: useTheme()

Composable for theme management.

### Signature

```typescript
function useTheme(): {
    current: Ref<ThemeName>;
    set: (theme: ThemeName) => void;
    toggle: () => void;
    available: ThemeName[];
};
```

### Returns

-   **`current`**: Reactive ref to active theme
-   **`set(theme)`**: Switch to a specific theme
-   **`toggle()`**: Toggle between light/dark
-   **`available`**: Array of all available themes

### Example

```vue
<script setup lang="ts">
const { current, set, toggle, available } = useTheme();

function switchTheme(name: ThemeName) {
    set(name);
}
</script>

<template>
    <div>
        <p>Current: {{ current }}</p>
        <button @click="toggle">Toggle Light/Dark</button>
        <select @change="switchTheme($event.target.value)">
            <option v-for="theme in available" :value="theme">
                {{ theme }}
            </option>
        </select>
    </div>
</template>
```

---

## Hook: useRuntimeResolver()

Composable for accessing the RuntimeResolver instance.

### Signature

```typescript
function useRuntimeResolver(): RuntimeResolver | null;
```

### Returns

`RuntimeResolver | null` - Active theme's resolver, or `null` if no theme loaded

### Example

```typescript
const resolver = useRuntimeResolver();

if (resolver) {
    const props = resolver.resolve('button', 'chat', 'send');
    console.log('Resolved props:', props);
}
```

---

## Advanced: Custom Selector Parsing

### parseSelector(selector: string)

Parses a CSS-like selector into structured format.

```typescript
function parseSelector(selector: string): ParsedSelector;
```

**Example:**

```typescript
const parsed = parseSelector('button.chat#send:hover[type="submit"]');

// Result:
{
    element: 'button',
    context: 'chat',
    identifier: 'send',
    state: 'hover',
    attributes: [
        { name: 'type', operator: '=', value: 'submit' }
    ]
}
```

### calculateSpecificity(parsed: ParsedSelector)

Calculates CSS specificity score.

```typescript
function calculateSpecificity(parsed: ParsedSelector): number;
```

**Example:**

```typescript
const specificity = calculateSpecificity({
    element: 'button',
    context: 'chat',
    identifier: 'send',
    state: 'hover',
});

// Result: 41 (1 + 10 + 20 + 10)
```

---

## Error Handling

### Theme Validation Errors

```typescript
// Missing required color
ThemeValidationError: Theme 'my-theme' missing required color: 'primary'

// Invalid selector syntax
ThemeValidationError: Invalid selector 'button..chat' (double dots)

// Specificity conflict
ThemeValidationError: Selectors 'button.chat' and 'input.chat' have equal specificity (11)
```

### Runtime Errors

```typescript
// Theme not found
ThemeNotFoundError: Theme 'invalid-theme' does not exist

// Resolver not initialized
ThemeResolverError: RuntimeResolver not available (theme not loaded)
```

---

## Migration from Old System

See [Migration Guide](./migration-guide.md) for detailed migration instructions.

### Quick Comparison

**Old System:**

```typescript
// Hard-coded component props
<UButton variant="solid" color="primary" />
```

**Refined System:**

```typescript
// Theme-driven with v-theme
<UButton v-theme="'chat.send'" />
```

---

## Performance Tips

1. **Minimize overrides**: Only override what's necessary
2. **Use specific selectors**: Avoid broad selectors like `button`
3. **Cache resolver instances**: Don't create new resolvers per component
4. **Leverage build-time compilation**: Let the compiler pre-parse selectors

See [Best Practices](./best-practices.md) for more optimization techniques.
