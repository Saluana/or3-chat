# CSS Variables Reference

Complete reference for all CSS custom properties available in the theming system. Variables are organized by category with descriptions, usage examples, and default values.

## 🎨 Material Design Core Variables

These variables follow Material Design 3 color system and are **required** for all themes.

### Primary Colors

| Variable | Description | Light Default | Dark Default | Usage Example |
|----------|-------------|---------------|--------------|---------------|
| `--md-primary` | Main brand color for primary actions | `#6366f1` | `#818cf8` | Primary buttons, links |
| `--md-on-primary` | Text color on primary backgrounds | `#ffffff` | `#1e1b4b` | Button text, icon text |
| `--md-primary-container` | Lighter variant for primary containers | `#e0e7ff` | `#2e2a5e` | Cards, chips, badges |
| `--md-on-primary-container` | Text on primary container backgrounds | `#1e1b4b` | `#e0e7ff` | Card titles, labels |

```css
/* Usage in components */
.primary-button {
  background-color: var(--md-primary);
  color: var(--md-on-primary);
}

.primary-card {
  background-color: var(--md-primary-container);
  color: var(--md-on-primary-container);
}
```

### Secondary Colors

| Variable | Description | Light Default | Dark Default | Usage Example |
|----------|-------------|---------------|--------------|---------------|
| `--md-secondary` | Secondary/accent color for less prominent actions | `#64748b` | `#94a3b8` | Secondary buttons, tabs |
| `--md-on-secondary` | Text color on secondary backgrounds | `#ffffff` | `#1e293b` | Secondary button text |
| `--md-secondary-container` | Lighter variant for secondary containers | `#e2e8f0` | `#334155` | Secondary cards, tags |
| `--md-on-secondary-container` | Text on secondary container backgrounds | `#1e293b` | `#e2e8f0` | Secondary card text |

```css
/* Usage in components */
.secondary-button {
  background-color: var(--md-secondary);
  color: var(--md-on-secondary);
}

.secondary-tag {
  background-color: var(--md-secondary-container);
  color: var(--md-on-secondary-container);
}
```

### Surface Colors

| Variable | Description | Light Default | Dark Default | Usage Example |
|----------|-------------|---------------|--------------|---------------|
| `--md-surface` | Main surface background for cards and panels | `#ffffff` | `#1e293b` | Cards, modals, dropdowns |
| `--md-on-surface` | Primary text color on surfaces | `#1e293b` | `#f8fafc` | Card content, modal text |
| `--md-surface-variant` | Alternative surface for subtle variation | `#f8fafc` | `#334155` | Hover states, secondary cards |
| `--md-on-surface-variant` | Text color on surface variants | `#475569` | `#cbd5e1` | Secondary text, captions |

```css
/* Usage in components */
.card {
  background-color: var(--md-surface);
  color: var(--md-on-surface);
}

.card-hover {
  background-color: var(--md-surface-variant);
  color: var(--md-on-surface-variant);
}
```

### Background Colors

| Variable | Description | Light Default | Dark Default | Usage Example |
|----------|-------------|---------------|--------------|---------------|
| `--md-background` | Main application background | `#ffffff` | `#0f172a` | Page background, body |
| `--md-on-background` | Primary text on background | `#0f172a` | `#f8fafc` | Headings, body text |

```css
/* Usage in layout */
body {
  background-color: var(--md-background);
  color: var(--md-on-background);
}
```

### Error Colors

| Variable | Description | Light Default | Dark Default | Usage Example |
|----------|-------------|---------------|--------------|---------------|
| `--md-error` | Error color for destructive actions | `#ef4444` | `#f87171` | Error buttons, alerts |
| `--md-on-error` | Text color on error backgrounds | `#ffffff` | `#1e1b4b` | Error button text |
| `--md-error-container` | Light error background for notifications | `#fecaca` | `#7f1d1d` | Error banners, toasts |
| `--md-on-error-container` | Text on error container backgrounds | `#991b1b` | `#fecaca` | Error message text |

```css
/* Usage in error components */
.error-button {
  background-color: var(--md-error);
  color: var(--md-on-error);
}

.error-banner {
  background-color: var(--md-error-container);
  color: var(--md-on-error-container);
}
```

## 🎯 Application-Specific Variables

These variables are specific to this application and provide additional customization options.

### Content Backgrounds

| Variable | Description | Light Default | Dark Default | Usage Example |
|----------|-------------|---------------|--------------|---------------|
| `--app-content-bg-1` | Primary content area background | `#ffffff` | `#1e293b` | Main content panels |
| `--app-content-bg-2` | Secondary content background | `#f8fafc` | `#334155` | Sidebar, secondary panels |
| `--app-content-bg-3` | Tertiary content background | `#f1f5f9` | `#475569` | Nested content, code blocks |
| `--app-content-border` | Content area borders | `#e2e8f0` | `#475569` | Panel borders, dividers |

```css
/* Usage in layout components */
.main-content {
  background-color: var(--app-content-bg-1);
  border: 1px solid var(--app-content-border);
}

.sidebar {
  background-color: var(--app-content-bg-2);
}

.code-block {
  background-color: var(--app-content-bg-3);
}
```

### Interactive Elements

| Variable | Description | Light Default | Dark Default | Usage Example |
|----------|-------------|---------------|--------------|---------------|
| `--app-hover-bg` | Hover state background | `#f1f5f9` | `#334155` | Button hover, card hover |
| `--app-active-bg` | Active/pressed state background | `#e2e8f0` | `#475569` | Button active, selected items |
| `--app-focus-ring` | Focus outline color | `#6366f1` | `#818cf8` | Keyboard focus indicators |

```css
/* Usage in interactive components */
.button:hover {
  background-color: var(--app-hover-bg);
}

.button:active {
  background-color: var(--app-active-bg);
}

.button:focus {
  outline: 2px solid var(--app-focus-ring);
}
```

### Typography

| Variable | Description | Light Default | Dark Default | Usage Example |
|----------|-------------|---------------|--------------|---------------|
| `--app-text-primary` | Primary text color | `#0f172a` | `#f8fafc` | Headings, important text |
| `--app-text-secondary` | Secondary text color | `#64748b` | `#94a3b8` | Body text, descriptions |
| `--app-text-muted` | Muted text color | `#94a3b8` | `#64748b` | Captions, helper text |

```css
/* Usage in typography */
h1, h2, h3 {
  color: var(--app-text-primary);
}

p {
  color: var(--app-text-secondary);
}

.caption {
  color: var(--app-text-muted);
}
```

## 🔧 Nuxt UI Token Variables

These variables are auto-generated from the theme configuration and are **read-only**. They provide direct access to Nuxt UI component styling.

### Button Tokens

| Variable | Description | Generated From | Usage |
|----------|-------------|----------------|-------|
| `--ui-button-primary` | Primary button background | `--md-primary` | Nuxt UI Button component |
| `--ui-button-secondary` | Secondary button background | `--md-secondary` | Nuxt UI Button component |
| `--ui-button-ghost` | Ghost button background | `--md-surface-variant` | Nuxt UI Button component |

### Input Tokens

| Variable | Description | Generated From | Usage |
|----------|-------------|----------------|-------|
| `--ui-input-bg` | Input background color | `--md-surface` | Nuxt UI Input component |
| `--ui-input-border` | Input border color | `--md-outline` | Nuxt UI Input component |
| `--ui-input-text` | Input text color | `--md-on-surface` | Nuxt UI Input component |

### Card Tokens

| Variable | Description | Generated From | Usage |
|----------|-------------|----------------|-------|
| `--ui-card-bg` | Card background color | `--md-surface` | Nuxt UI Card component |
| `--ui-card-border` | Card border color | `--md-outline` | Nuxt UI Card component |
| `--ui-card-text` | Card text color | `--md-on-surface` | Nuxt UI Card component |

> **Note**: These variables are automatically generated and should not be manually overridden. Use the base Material Design variables instead.

## 🎨 Usage Examples by Category

### Complete Button Styling

```css
.custom-button {
  /* Primary button with theme colors */
  background-color: var(--md-primary);
  color: var(--md-on-primary);
  border: 2px solid var(--md-primary);
  
  /* Interactive states */
  transition: all 0.2s ease;
}

.custom-button:hover {
  background-color: var(--md-primary-container);
  color: var(--md-on-primary-container);
}

.custom-button:focus {
  outline: 2px solid var(--app-focus-ring);
  outline-offset: 2px;
}

.custom-button:disabled {
  background-color: var(--md-surface-variant);
  color: var(--md-on-surface-variant);
  opacity: 0.6;
}
```

### Complete Card Styling

```css
.custom-card {
  /* Card background and text */
  background-color: var(--md-surface);
  color: var(--md-on-surface);
  border: 1px solid var(--app-content-border);
  
  /* Shadow and spacing */
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  border-radius: 8px;
  padding: 1rem;
}

.custom-card:hover {
  background-color: var(--md-surface-variant);
  transform: translateY(-1px);
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

.custom-card .card-title {
  color: var(--app-text-primary);
  font-weight: 600;
  margin-bottom: 0.5rem;
}

.custom-card .card-content {
  color: var(--app-text-secondary);
  line-height: 1.6;
}
```

### Form Input Styling

```css
.custom-input {
  /* Input background and border */
  background-color: var(--md-surface);
  border: 2px solid var(--app-content-border);
  color: var(--md-on-surface);
  
  /* Typography and spacing */
  font-family: inherit;
  font-size: 1rem;
  padding: 0.75rem 1rem;
  border-radius: 6px;
  
  /* Focus state */
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.custom-input:focus {
  border-color: var(--md-primary);
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
  outline: none;
}

.custom-input::placeholder {
  color: var(--app-text-muted);
}
```

### Alert/Error Styling

```css
.error-alert {
  /* Error background and text */
  background-color: var(--md-error-container);
  color: var(--md-on-error-container);
  border: 1px solid var(--md-error);
  
  /* Layout */
  padding: 1rem;
  border-radius: 6px;
  margin: 1rem 0;
}

.error-alert .alert-title {
  color: var(--md-error);
  font-weight: 600;
  margin-bottom: 0.5rem;
}

.error-alert .alert-message {
  color: var(--md-on-error-container);
}
```

## 📊 Variable Inheritance

### Color Relationships

The theme system maintains semantic relationships between colors:

```css
/* Primary color relationships */
--md-primary-container is derived from --md-primary (lighter variant)
--md-on-primary is always contrasting with --md-primary
--md-on-primary-container is always contrasting with --md-primary-container

/* Surface hierarchy */
--md-background (base) → --md-surface (cards) → --md-surface-variant (subtle)
--md-on-background → --md-on-surface → --md-on-surface-variant
```

### Usage Guidelines

1. **Use semantic variables** (`--md-primary`, `--md-surface`) rather than hard-coded colors
2. **Maintain contrast** by using matching `on-*` variables for text
3. **Respect the hierarchy** - background → surface → surface-variant
4. **Use container variants** for subtle backgrounds instead of base colors

## 🎯 Best Practices

### Do's
```css
/* ✅ Use semantic variables */
.button {
  background-color: var(--md-primary);
  color: var(--md-on-primary);
}

/* ✅ Use container variants for backgrounds */
.card {
  background-color: var(--md-primary-container);
  color: var(--md-on-primary-container);
}

/* ✅ Use surface hierarchy */
.sidebar {
  background-color: var(--md-surface-variant);
}
```

### Don'ts
```css
/* ❌ Hard-code colors */
.button {
  background-color: #6366f1; /* Won't adapt to theme changes */
}

/* ❌ Mix on-colors incorrectly */
.error-text {
  color: var(--md-on-primary); /* Use var(--md-on-error) instead */
}

/* ❌ Use primary colors for backgrounds */
.background {
  background-color: var(--md-primary); /* Use var(--md-background) instead */
}
```

## 🔍 Debugging Variables

### Inspecting Current Values

Use browser dev tools to inspect current variable values:

```css
/* Add this to your CSS for debugging */
:root {
  /* Debug: Show all primary colors */
  --debug-primary: var(--md-primary);
  --debug-on-primary: var(--md-on-primary);
  --debug-primary-container: var(--md-primary-container);
  --debug-on-primary-container: var(--md-on-primary-container);
}
```

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Variable not applying | Variable not defined in theme file | Add missing variable to both light.css and dark.css |
| Poor contrast | Wrong on-color combination | Use matching `on-*` variables |
| Theme not updating | CSS cache issue | Restart dev server or clear browser cache |

---

**📚 Related Documentation:**
- [Theming Quick Start](./theming-quickstart.md) - Get started with theme creation
- [Component Overrides](./component-overrides.md) - Customize Nuxt UI components
- [Material Design 3](https://m3.material.io/styles/color/the-color-system/color-roles) - Official color system documentation
