# Theming Quick Start Guide

Create custom themes for your application in under 10 minutes! This guide walks you through creating your first theme with light and dark variants.

## 🎯 What You'll Create

A complete theme with:
- Light mode with custom colors
- Dark mode with matching dark variants  
- Component overrides for buttons and inputs
- Retro styling that matches the application aesthetic

## 📁 Creating Your First Theme (Step-by-Step)

### Step 1: Create Theme Directory

Create a new directory in `app/theme/` with your theme name:

```bash
mkdir app/theme/my-custom-theme
```

### Step 2: Create Required CSS Files

Create the essential files for your theme:

```bash
touch app/theme/my-custom-theme/light.css
touch app/theme/my-custom-theme/dark.css
```

### Step 3: Add Basic Color Variables

Edit `app/theme/my-custom-theme/light.css`:

```css
:root {
  /* Primary colors - main brand colors */
  --md-primary: #6366f1;
  --md-on-primary: #ffffff;
  --md-primary-container: #e0e7ff;
  --md-on-primary-container: #1e1b4b;

  /* Secondary colors - accent colors */
  --md-secondary: #64748b;
  --md-on-secondary: #ffffff;
  --md-secondary-container: #e2e8f0;
  --md-on-secondary-container: #1e293b;

  /* Surface colors - backgrounds and cards */
  --md-surface: #ffffff;
  --md-on-surface: #1e293b;
  --md-surface-variant: #f8fafc;
  --md-on-surface-variant: #475569;

  /* Background colors */
  --md-background: #ffffff;
  --md-on-background: #0f172a;

  /* Error colors */
  --md-error: #ef4444;
  --md-on-error: #ffffff;
  --md-error-container: #fecaca;
  --md-on-error-container: #991b1b;
}
```

Edit `app/theme/my-custom-theme/dark.css`:

```css
:root {
  /* Primary colors - darker variants for dark mode */
  --md-primary: #818cf8;
  --md-on-primary: #1e1b4b;
  --md-primary-container: #2e2a5e;
  --md-on-primary-container: #e0e7ff;

  /* Secondary colors - adjusted for dark backgrounds */
  --md-secondary: #94a3b8;
  --md-on-secondary: #1e293b;
  --md-secondary-container: #334155;
  --md-on-secondary-container: #e2e8f0;

  /* Surface colors - dark backgrounds */
  --md-surface: #1e293b;
  --md-on-surface: #f8fafc;
  --md-surface-variant: #334155;
  --md-on-surface-variant: #cbd5e1;

  /* Background colors */
  --md-background: #0f172a;
  --md-on-background: #f8fafc;

  /* Error colors - slightly muted for dark mode */
  --md-error: #f87171;
  --md-on-error: #1e1b4b;
  --md-error-container: #7f1d1d;
  --md-on-error-container: #fecaca;
}
```

### Step 4: Create Component Overrides (Optional)

Create `app/theme/my-custom-theme/theme.ts`:

```typescript
export default defineAppConfig({
  ui: {
    button: {
      variant: {
        retro: {
          size: 'sm',
          color: 'primary',
          variant: 'solid',
          class: 'retro-btn border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] active:shadow-[0px_0px_0px_0px_rgba(0,0,0,1)] active:translate-x-[2px] active:translate-y-[2px] transition-all'
        }
      }
    },
    input: {
      variant: {
        retro: {
          class: 'retro-input border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] focus:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] focus:translate-x-[1px] focus:translate-y-[1px] transition-all'
        }
      }
    }
  }
})
```

### Step 5: Add Utility Styles (Optional)

Create `app/theme/my-custom-theme/main.css`:

```css
/* Retro utility classes */
.retro-btn {
  font-family: 'Press Start 2P', monospace;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.retro-input {
  font-family: 'VT323', monospace;
  font-size: 1.125rem;
}

/* Custom scrollbar for retro feel */
::-webkit-scrollbar {
  width: 12px;
  height: 12px;
}

::-webkit-scrollbar-track {
  background: var(--md-surface-variant);
  border: 1px solid var(--md-outline);
}

::-webkit-scrollbar-thumb {
  background: var(--md-primary);
  border: 1px solid var(--md-outline);
}

::-webkit-scrollbar-thumb:hover {
  background: var(--md-primary-container);
}
```

## 📋 Required Files

Every theme must include these files:

| File | Purpose | Required Variables |
|------|---------|-------------------|
| `light.css` | Light mode color scheme | All `--md-*` variables |
| `dark.css` | Dark mode color scheme | All `--md-*` variables |

### Required CSS Variables

These variables **must** be defined in both light.css and dark.css:

```css
/* Core Material Design Variables */
--md-primary                    /* Main brand color */
--md-on-primary                 /* Text on primary color */
--md-primary-container          /* Lighter primary variant */
--md-on-primary-container       /* Text on primary container */

--md-secondary                  /* Secondary/accent color */
--md-on-secondary               /* Text on secondary color */
--md-secondary-container        /* Lighter secondary variant */
--md-on-secondary-container     /* Text on secondary container */

--md-surface                    /* Card/surface background */
--md-on-surface                 /* Text on surface */
--md-surface-variant            /* Alternative surface */
--md-on-surface-variant         /* Text on surface variant */

--md-background                 /* Main app background */
--md-on-background              /* Main app text */

--md-error                      /* Error color */
--md-on-error                   /* Text on error color */
--md-error-container            /* Light error background */
--md-on-error-container         /* Text on error container */
```

## 📁 Optional Files

Enhance your theme with these optional files:

| File | Purpose | When to Use |
|------|---------|-------------|
| `main.css` | Global utility styles, custom scrollbars, animations | For app-wide styling enhancements |
| `theme.ts` | Component configuration, Nuxt UI overrides | For custom component variants and behavior |
| `light-hc.css` | High contrast light mode | Accessibility compliance |
| `dark-hc.css` | High contrast dark mode | Accessibility compliance |
| `light-mc.css` | Medium contrast light mode | Reduced contrast needs |
| `dark-mc.css` | Medium contrast dark mode | Reduced contrast needs |

## 🚀 Activating Your Theme

### Method 1: Dashboard UI (Recommended)

1. Open your application
2. Go to **Dashboard** → **Settings** → **Theme Selector**
3. Select your theme from the list
4. The page will reload with your new theme

### Method 2: Programmatic Activation

```typescript
// In any component or composable
const { $theme } = useNuxtApp()

// Switch to your theme
await $theme.switchTheme('my-custom-theme')

// Check current active theme
console.log($theme.activeTheme.value) // 'my-custom-theme'

// Get available themes
console.log($theme.availableThemes.value) // Array of theme manifests
```

### Method 3: Direct Theme Mode Toggle

```typescript
// Toggle between light and dark modes
$theme.set('dark')        // Force dark mode
$theme.set('light')       // Force light mode
$theme.set('dark-hc')     // High contrast dark
$theme.toggle()           // Toggle light/dark
$theme.system()           // Use system preference
```

## 🎨 Testing Your Theme

### Local Development

1. Start your development server: `bun run dev`
2. Navigate to your application
3. Use the Dashboard Theme Selector to activate your theme
4. Test all theme modes (light, dark, high contrast)

### Theme Validation

The theme system automatically validates your theme:

```typescript
// Check for theme errors
const { $theme } = useNuxtApp()

console.log($theme.errors.value)   // Critical errors that prevent loading
console.log($theme.warnings.value) // Missing variables that still work
```

### Common Validation Issues

| Warning | Cause | Fix |
|---------|-------|-----|
| "Missing required CSS variable: --md-primary" | Variable not defined in light.css or dark.css | Add the missing variable to both files |
| "Theme has critical errors" | Required files missing or invalid | Check that light.css and dark.css exist and are valid CSS |

## 📸 Screenshots

### Before: Default Theme
![Default theme appearance](/screenshots/default-theme.png)

### After: Custom Theme
![Custom theme with retro styling](/screenshots/custom-theme.png)

## 🎯 Next Steps

- **Reference Guide**: See [CSS Variables Reference](./css-variables-reference.md) for complete variable documentation
- **Component Overrides**: Learn [Component Override System](./component-overrides.md) for advanced customization
- **Example Themes**: Browse `app/theme/` directory for more examples

## 💡 Pro Tips

1. **Start Simple**: Begin with just light.css and dark.css, then add optional files
2. **Use DevTools**: Browser dev tools help you inspect current variable values
3. **Test Contrast**: Use contrast checkers to ensure accessibility
4. **Version Control**: Commit your theme files to track changes
5. **Reuse Variables**: Define base colors and derive variants from them

## 🆘 Troubleshooting

**Theme not appearing in Dashboard?**
- Check that your theme directory is in `app/theme/`
- Ensure both `light.css` and `dark.css` exist
- Restart the development server

**Colors not applying?**
- Verify all required CSS variables are defined
- Check for CSS syntax errors in your files
- Use browser dev tools to inspect variable values

**Component overrides not working?**
- Ensure `theme.ts` exports a default object with `ui` property
- Check Nuxt UI component documentation for correct syntax
- Restart the development server after adding theme.ts

---

**🎉 Congratulations!** You've created your first custom theme. The theming system is now ready for your creative customization!
