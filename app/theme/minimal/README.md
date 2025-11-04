# Minimal Theme

A clean, distraction-free theme that removes all decorative elements and focuses purely on content and functionality.

## 🎨 Design Philosophy

The Minimal theme embraces simplicity and clarity by:
- **Pure Grayscale**: Only black, white, and gray colors
- **No Decorations**: Removes patterns, shadows, and ornamental elements
- **Sharp Edges**: Clean borders with minimal rounding
- **Instant Feedback**: No transitions or animations
- **High Contrast**: Maximum readability and focus

## 📁 Theme Structure

```
minimal/
├── light.css     # Clean light mode with white backgrounds
├── dark.css      # Clean dark mode with black backgrounds
├── main.css      # Removes all decorative patterns and transitions
├── theme.ts      # Minimal component variants
└── README.md     # This documentation
```

## 🎯 Key Features

### Color Palette
- **Primary**: Pure black/white for maximum contrast
- **Secondary**: Grayscale variants (#666, #999, #ccc)
- **Surfaces**: Clean whites (#ffffff) and blacks (#000000)
- **Error**: Subtle red that maintains readability

### Visual Elements
- **Borders**: 1px solid gray lines
- **Shadows**: Completely removed
- **Transitions**: Disabled for instant feedback
- **Patterns**: No decorative backgrounds or textures
- **Typography**: System fonts with normal letter spacing

### Component Variants
- **Minimal Button**: Clean borders with hover states
- **Minimal Input**: Simple borders with focus indicators
- **Minimal Card**: Sharp-edged containers
- **Minimal Modal**: Clean overlay dialogs

## 🚀 Usage

### Activate via Dashboard
1. Go to **Dashboard** → **Settings** → **Theme Selector**
2. Select **Minimal** from the theme list
3. The page will reload with minimal styling

### Activate Programmatically
```typescript
// Switch to minimal theme
await $theme.switchTheme('minimal')

// Toggle between light and dark
$theme.toggle() // Works with minimal theme colors
```

## 🎨 Customization

### Modifying Colors
Edit `light.css` or `dark.css` to adjust the color scheme:

```css
:root {
  /* Make it slightly warmer */
  --md-primary: #1a1a1a;
  --md-background: #fafafa;
  --md-surface: #f5f5f5;
}
```

### Adding Back Transitions
If you want some transitions back, edit `main.css`:

```css
/* Re-enable only hover transitions */
.retro-btn:hover {
  transition: background-color 0.2s ease;
}
```

### Custom Component Styles
Add your own variants in `theme.ts`:

```typescript
export default defineAppConfig({
  ui: {
    button: {
      variant: {
        myMinimal: {
          class: 'border-2 border-gray-400 hover:border-gray-600'
        }
      }
    }
  }
})
```

## 🔧 Technical Details

### CSS Variables
The theme defines these custom properties:
- `--md-*`: Material Design color system variables
- `--app-*`: Application-specific variables
- All variables use grayscale values for consistency

### Component Overrides
- **Transitions**: Disabled globally via `* { transition: none !important }`
- **Shadows**: Removed with `box-shadow: none !important`
- **Borders**: Standardized to 1px solid gray
- **Border Radius**: Minimal 2px radius (rounded-sm)

### Performance
- **Fast Rendering**: No CSS animations or transitions
- **Small Bundle**: Minimal CSS footprint
- **GPU Friendly**: No complex effects or filters
- **Accessibility**: High contrast ratios for readability

## 🎯 Use Cases

### Perfect For:
- **Content-heavy applications** where readability is paramount
- **Accessibility-focused** interfaces requiring high contrast
- **Development and debugging** with clean visual hierarchy
- **Professional environments** with conservative styling
- **Users with visual impairments** or sensitivity to motion

### Not Recommended For:
- **Gaming or entertainment** applications
- **Brand-heavy marketing** sites
- **Children's applications** requiring visual engagement
- **Highly decorative** user interfaces

## 🧪 Testing

### Validation
The theme includes comprehensive validation:
- ✅ All required Material Design variables defined
- ✅ Contrast ratios meet WCAG AA standards
- ✅ Component variants work correctly
- ✅ Light/dark mode switching functional

### Browser Compatibility
- ✅ Chrome 90+
- ✅ Firefox 88+
- ✅ Safari 14+
- ✅ Edge 90+

## 🔄 Migration

### From Default Theme
1. **Color Changes**: Replace colorful variables with grayscale
2. **Remove Shadows**: Set `box-shadow: none` on all components
3. **Disable Transitions**: Add `transition: none` globally
4. **Simplify Borders**: Use 1px solid gray consistently

### From Other Themes
1. **Backup Current Theme**: Save your existing theme files
2. **Copy Minimal Structure**: Use minimal theme as starting point
3. **Gradually Add Features**: Add back specific elements as needed
4. **Test Thoroughly**: Ensure all functionality works

## 🤝 Contributing

### Adding Features
When extending the minimal theme:
1. **Maintain Simplicity**: Don't add unnecessary decorations
2. **Preserve Performance**: Keep animations and effects minimal
3. **Test Accessibility**: Ensure high contrast ratios
4. **Document Changes**: Update this README with new features

### Submitting Changes
1. **Fork the Repository**
2. **Create Feature Branch**: `git checkout -b minimal-theme-enhancement`
3. **Make Changes**: Edit theme files with minimal additions
4. **Test**: Verify all color modes work
5. **Submit Pull Request**: With clear description of changes

## 📄 License

This theme follows the same license as the main application.

---

**🎯 Result**: A clean, fast, and accessible theme that puts content first while maintaining full functionality of the application.
