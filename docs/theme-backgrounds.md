# Theme Background System

The theme system supports custom background textures and gradients through the `backgrounds` property in theme definitions. This allows each theme to define its own visual treatment for content areas, sidebars, and UI chrome without modifying global CSS.

## Overview

Backgrounds are configured in `theme.ts` files and automatically applied when themes are switched. The system supports:

- Content area backgrounds (base layer + overlay)
- Sidebar backgrounds
- Header and bottom nav gradients
- Public image URLs or user-uploaded files via internal tokens
- Per-layer opacity, repeat, and size controls

## Theme DSL

### ThemeBackgroundLayer

Defines a single background layer with the following properties:

```typescript
interface ThemeBackgroundLayer {
    image?: string | null; // URL or internal-file:// token
    color?: string; // Optional background color
    opacity?: number; // 0-1, clamped at runtime
    repeat?: 'repeat' | 'no-repeat' | 'repeat-x' | 'repeat-y';
    size?: string; // CSS size value (e.g., '150px', 'cover')
    fit?: 'cover' | 'contain'; // Convenience shorthand for size
}
```

### ThemeBackgrounds

Container for all background layers in a theme:

```typescript
interface ThemeBackgrounds {
    content?: {
        base?: ThemeBackgroundLayer; // Primary content background
        overlay?: ThemeBackgroundLayer; // Secondary overlay pattern
    };
    sidebar?: ThemeBackgroundLayer; // Sidebar background
    headerGradient?: ThemeBackgroundLayer; // Top chrome gradient
    bottomNavGradient?: ThemeBackgroundLayer; // Bottom chrome gradient
}
```

## Usage Example

### Retro Theme

```typescript
export default defineTheme({
    name: 'retro',
    displayName: 'Retro (Default)',
    // ...colors, overrides, etc.
    
    backgrounds: {
        content: {
            base: {
                image: '/bg-repeat.webp',
                opacity: 0.08,
                repeat: 'repeat',
                size: '150px',
            },
            overlay: {
                image: '/bg-repeat-2.webp',
                opacity: 0.125,
                repeat: 'repeat',
                size: '380px',
            },
        },
        sidebar: {
            image: '/sidebar-repeater.webp',
            opacity: 0.1,
            repeat: 'repeat',
            size: '240px',
        },
        headerGradient: {
            image: '/gradient-x.webp',
            repeat: 'repeat-x',
            size: 'auto 100%',
        },
        bottomNavGradient: {
            image: '/gradient-x.webp',
            repeat: 'repeat-x',
            size: 'auto 100%',
        },
    },
});
```

### Minimal Theme

For a cleaner, texture-free appearance:

```typescript
export default defineTheme({
    name: 'minimal',
    displayName: 'Minimal',
    colors: {
        // ...Material color palette
    },
    // No backgrounds property = solid colors only
});
```

### Mixed Approach

Use gradients but skip content patterns:

```typescript
export default defineTheme({
    name: 'hybrid',
    displayName: 'Hybrid',
    colors: { /* ... */ },
    
    backgrounds: {
        headerGradient: {
            image: '/subtle-gradient.webp',
            repeat: 'repeat-x',
        },
        // sidebar and content layers omitted
    },
});
```

## CSS Variable Mapping

The theme system applies backgrounds by setting CSS custom properties on `document.documentElement`:

| Background Slot | CSS Variables |
|---|---|
| `content.base` | `--app-content-bg-1`, `--app-content-bg-1-opacity`, `--app-content-bg-1-repeat`, `--app-content-bg-1-size` |
| `content.overlay` | `--app-content-bg-2`, `--app-content-bg-2-opacity`, `--app-content-bg-2-repeat`, `--app-content-bg-2-size` |
| `sidebar` | `--app-sidebar-bg-1`, `--app-sidebar-bg-1-opacity`, `--app-sidebar-bg-1-repeat`, `--app-sidebar-bg-1-size` |
| `headerGradient` | `--app-header-gradient` |
| `bottomNavGradient` | `--app-bottomnav-gradient` |

Components like `ResizableSidebarLayout` and sidebar headers consume these variables automatically—no additional wiring required.

## User-Uploaded Backgrounds

Themes can reference user-uploaded files via the dashboard settings. When a user uploads a custom image:

1. The file is stored in IndexedDB with a unique hash.
2. The hash is encoded as `internal-file://{hash}`.
3. At runtime, the system creates an object URL and injects it into the CSS variable.

This mechanism allows dashboard theme customization to layer on top of theme defaults without conflicts.

## Dashboard Settings Integration

Theme backgrounds serve as **defaults**. The dashboard theme settings UI can override any layer:

- When a user selects a texture, it replaces the theme default for that slot.
- When a user clears a texture, the theme default is restored.
- User overrides persist across theme switches (stored separately).

The `buildBackgroundsFromSettings` helper converts legacy `ThemeSettings` into the new `ThemeBackgrounds` structure so both systems coexist during migration.

## Best Practices

1. **Asset Paths**: Use public folder URLs (`/images/texture.webp`) for bundled assets. Avoid hardcoding CDN links unless necessary.
2. **Opacity**: Keep content backgrounds subtle (0.05–0.15 range) to maintain readability. Sidebar textures can be slightly more pronounced (0.1–0.2).
3. **Repeat Modes**: Most pixel-art patterns work best with `repeat`. Gradients typically use `repeat-x` or `repeat-y`.
4. **Size**: Match texture size to its visual weight—smaller patterns (80-150px) tile more frequently, larger patterns (300-500px) create a more open feel.
5. **Gradients**: Use `size: 'auto 100%'` for horizontal chrome gradients to ensure they stretch correctly.
6. **Accessibility**: Test backgrounds in high-contrast mode. The system automatically reduces opacity when `reducePatternsInHighContrast` is enabled.

## Troubleshooting

**Backgrounds not appearing after theme switch:**  
- Verify the theme plugin is wired to call `applyThemeBackgrounds` on `setActiveTheme`.
- Check browser console for token resolution errors (e.g., missing files).

**Textures look stretched or squashed:**  
- Ensure `size` matches the source image dimensions.
- Use `fit: 'cover'` or `fit: 'contain'` instead of explicit pixel sizes if you want responsive scaling.

**User overrides ignored:**  
- Confirm `applyToRoot` (dashboard settings) invokes `applyThemeBackgrounds` after the theme defaults are set.
- Check local storage keys for persisted user settings.

## Related Documentation

- [Refined Theme System](./refined-theme-system/README.md)
- [Theme DSL Reference](./theme-dsl-reference.md)
- [Dashboard Theme Settings](./UI/theme-settings.md)
