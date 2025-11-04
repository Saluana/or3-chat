# Theming Documentation

Complete guide to creating, customizing, and managing themes in your application. The theming system provides a flexible, Material Design 3-based approach to styling with full TypeScript support.

## 📚 Documentation Overview

### 🚀 Getting Started
- **[Theming Quick Start](./theming-quickstart.md)** - Create your first theme in under 10 minutes
- **[CSS Variables Reference](./css-variables-reference.md)** - Complete reference for all available CSS custom properties
- **[Component Overrides](./component-overrides.md)** - Customize Nuxt UI components with theme-specific configurations

### 🎨 Theme System Features

- **Multi-theme Support**: Switch between themes dynamically
- **Material Design 3**: Built on Google's modern design system
- **CSS Custom Properties**: Leverage native CSS variables for theming
- **Component Integration**: Seamless Nuxt UI component customization
- **TypeScript Support**: Full type safety and IDE autocomplete
- **Accessibility**: High contrast and medium contrast variants included
- **Retro Styling**: Built-in retro aesthetic with pixel-perfect design

### 📁 Theme Structure

```
app/theme/
├── your-theme/
│   ├── light.css          # Light mode colors
│   ├── dark.css           # Dark mode colors
│   ├── main.css           # Optional: Global utilities
│   ├── theme.ts           # Optional: Component overrides
│   ├── light-hc.css       # Optional: High contrast light
│   ├── dark-hc.css        # Optional: High contrast dark
│   ├── light-mc.css       # Optional: Medium contrast light
│   └── dark-mc.css        # Optional: Medium contrast dark
└── default/               # Built-in default theme
    ├── light.css
    ├── dark.css
    ├── main.css
    └── theme.ts
```

## 🎯 Quick Start

1. **Create Theme Directory**
   ```bash
   mkdir app/theme/my-custom-theme
   ```

2. **Add Required Files**
   ```bash
   touch app/theme/my-custom-theme/light.css
   touch app/theme/my-custom-theme/dark.css
   ```

3. **Define Colors** (in both light.css and dark.css)
   ```css
   :root {
     --md-primary: #6366f1;
     --md-on-primary: #ffffff;
     --md-surface: #ffffff;
     --md-on-surface: #1e293b;
     /* ... all required variables */
   }
   ```

4. **Activate Theme**
   - Use Dashboard → Settings → Theme Selector
   - Or programmatically: `await $theme.switchTheme('my-custom-theme')`

## 🔧 Advanced Features

### Component Customization

```typescript
// app/theme/my-theme/theme.ts
export default defineAppConfig({
  ui: {
    button: {
      variant: {
        retro: {
          class: 'border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
        }
      }
    }
  }
})
```

### Theme API

```typescript
// Access theme provider
const { $theme } = useNuxtApp()

// Switch themes
await $theme.switchTheme('my-theme')

// Toggle light/dark mode
$theme.toggle()

// Get available themes
console.log($theme.availableThemes.value)

// Check for errors
console.log($theme.errors.value)
```

### CSS Variable Usage

```css
.my-component {
  background-color: var(--md-primary);
  color: var(--md-on-primary);
  border: 2px solid var(--md-outline);
}

.my-component:hover {
  background-color: var(--md-primary-container);
  color: var(--md-on-primary-container);
}
```

## 🎨 Design Principles

### Material Design 3 Integration

- **Color System**: Semantic color roles with automatic contrast calculation
- **Typography**: Material Design typography scale
- **Motion**: Consistent animations and transitions
- **Accessibility**: WCAG AA compliance with built-in contrast variants

### Retro Aesthetic

- **Pixel Perfect**: Sharp borders and hard shadows
- **Font Stack**: VT323 for body text, Press Start 2P for headings
- **Color Palette**: Carefully curated retro color schemes
- **Interactive States**: Classic button press effects

### Performance Considerations

- **CSS Variables**: Native browser performance
- **Minimal Overrides**: Only override what's necessary
- **Tree Shaking**: Unused theme variants are not included
- **Hot Reload**: Instant theme updates during development

## 🧪 Testing

### Theme Validation

The theme system automatically validates themes:

```typescript
// Check theme health
const { $theme } = useNuxtApp()

if ($theme.errors.value.length > 0) {
  console.error('Theme has critical errors:', $theme.errors.value)
}

if ($theme.warnings.value.length > 0) {
  console.warn('Theme has warnings:', $theme.warnings.value)
}
```

### Test Coverage

- ✅ Theme switching functionality
- ✅ CSS variable validation
- ✅ Component override testing
- ✅ Accessibility compliance
- ✅ Performance benchmarks

## 🔍 Debugging

### Common Issues

| Issue | Solution |
|-------|----------|
| Theme not appearing | Check theme directory structure and restart dev server |
| Colors not applying | Verify all required CSS variables are defined |
| Component styles not working | Check theme.ts syntax and component variant names |
| TypeScript errors | Ensure proper type definitions and imports |

### DevTools Integration

Use browser dev tools to:
- Inspect current CSS variable values
- Debug component class application
- Test theme switching in real-time
- Validate accessibility compliance

## 📖 Additional Resources

### External Documentation
- [Material Design 3](https://m3.material.io/) - Official design system documentation
- [Nuxt UI Documentation](https://ui.nuxt.com/) - Component library reference
- [CSS Custom Properties](https://developer.mozilla.org/en-US/docs/Web/CSS/Using_CSS_custom_properties) - MDN guide

### Internal Resources
- [Theme Plugin Source Code](../../app/plugins/theme.client.ts) - Core theming implementation
- [Theme Loader](../../app/theme/_shared/theme-loader.ts) - Theme discovery and validation
- [Default Theme](../../app/theme/default/) - Reference implementation

## 🤝 Contributing

### Adding New Themes

1. Create theme directory in `app/theme/`
2. Implement required CSS files with all Material Design variables
3. Add optional component overrides in `theme.ts`
4. Test across all color modes (light, dark, high contrast)
5. Update documentation with examples

### Extending Component Support

1. Update theme loader to discover new component types
2. Add TypeScript definitions in `types/nuxt.d.ts`
3. Document new component override patterns
4. Add test coverage for new components

---

**🎉 Ready to create amazing themes!** Start with the [Theming Quick Start](./theming-quickstart.md) guide and explore the full documentation for advanced customization options.
