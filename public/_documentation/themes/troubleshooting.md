# Troubleshooting Guide: Refined Theme System

Common issues, debugging techniques, and solutions for OR3's refined theme system.

## Quick Diagnostics

Run these commands to diagnose most issues:

```bash
# Validate your theme
bun run theme:validate my-theme

# Recompile all themes
bun run theme:compile

# Check active theme
bun run theme:switch
```

---

## Theme Not Applying

### Symptom

Theme appears inactive; components use default styles.

### Possible Causes

#### 1. Theme Not Active

**Check:**
```bash
# In browser console
localStorage.getItem('activeTheme')
```

**Solution:**
```bash
bun run theme:switch
# Select your theme
```

Or programmatically:
```typescript
const { set } = useTheme();
set('my-theme');
```

#### 2. Theme Not Compiled

**Check:**
```bash
ls types/theme-generated.d.ts
# If missing or outdated
```

**Solution:**
```bash
bun run theme:compile
bun run dev
```

#### 3. Missing v-theme Directive

**Check:**
```vue
<UButton>Click</UButton>  <!-- ✗ No v-theme -->
```

**Solution:**
```vue
<UButton v-theme>Click</UButton>  <!-- ✓ With v-theme -->
```

#### 4. SSR Hydration Mismatch

**Check browser console:**
```
Hydration node mismatch...
```

**Solution:**

Ensure `00.theme-directive.ts` plugin exists:
```typescript
// app/plugins/00.theme-directive.ts
export default defineNuxtPlugin(() => {
    return {
        provide: {
            theme: {
                directive: {
                    getSSRProps: () => ({})
                }
            }
        }
    };
});
```

---

## Colors Look Wrong

### Symptom

Colors don't match theme definition; appear washed out or incorrect.

### Possible Causes

#### 1. RGB Format Issue

**Check theme definition:**
```typescript
colors: {
    primary: 'rgb(99, 102, 241)',  // ✗ Wrong format
}
```

**Solution:**

Use hex format:
```typescript
colors: {
    primary: '#6366f1',  // ✓ Correct
}
```

#### 2. Dark Mode Not Defined

**Check:**

Theme looks good in light mode but bad in dark mode.

**Solution:**

Add `dark` overrides:
```typescript
colors: {
    primary: '#6366f1',
    dark: {
        primary: '#818cf8',  // Lighter for dark mode
        surface: '#1f2937',
        onSurface: '#f9fafb',
    }
}
```

#### 3. Contrast Ratio Too Low

**Check:**

Text hard to read on backgrounds.

**Solution:**

Test contrast ratio (minimum 4.5:1 for WCAG AA):
- [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/)
- Chrome DevTools > Inspect element > Color picker

Adjust colors:
```typescript
// Bad: 2.1:1 contrast
primary: '#a5b4fc',
onPrimary: '#e0e7ff',

// Good: 8.3:1 contrast
primary: '#6366f1',
onPrimary: '#ffffff',
```

#### 4. CSS Variables Not Updated

**Check browser console:**
```javascript
getComputedStyle(document.documentElement).getPropertyValue('--md-primary')
// Returns old value
```

**Solution:**

Force recompile and hard refresh:
```bash
rm -rf .nuxt types/theme-generated.d.ts
bun run theme:compile
bun run dev
# In browser: Cmd+Shift+R (Mac) / Ctrl+Shift+R (Windows)
```

---

## Overrides Not Working

### Symptom

Component props from theme are ignored; components use defaults.

### Possible Causes

#### 1. Selector Typo

**Check theme:**
```typescript
overrides: {
    'buton.chat#send': { /* ... */ }  // ✗ Typo: "buton"
}
```

**Solution:**
```bash
bun run theme:validate my-theme
# Reports: Unknown component 'buton'
```

Fix typo:
```typescript
overrides: {
    'button.chat#send': { /* ... */ }  // ✓ Correct
}
```

#### 2. Wrong Context

**Check:**

Component is in `sidebar` but theme targets `chat`:
```typescript
overrides: {
    'button.chat#send': { /* ... */ }
}
```

**Solution:**

Match context to component location:
```typescript
overrides: {
    'button.sidebar#send': { /* ... */ }
}
```

Or use explicit context in directive:
```vue
<UButton v-theme="{ identifier: 'send', context: 'sidebar' }">
    Send
</UButton>
```

#### 3. Specificity Conflict

**Check:**

Multiple selectors match; lower specificity wins unexpectedly.

**Debug:**
```typescript
// In browser console
const resolver = window.$nuxt.$theme.resolver;
const props = resolver.resolve('button', 'chat', 'send');
console.log('Resolved props:', props);
```

**Solution:**

Review specificity:
```typescript
// Specificity: 1
'button': { variant: 'solid' },

// Specificity: 11 (wins over 'button')
'button.chat': { variant: 'ghost' },

// Specificity: 21 (wins over 'button.chat')
'button#send': { variant: 'outline' },

// Specificity: 31 (wins over 'button#send')
'button.chat#send': { variant: 'soft' },
```

Higher specificity always wins.

#### 4. Explicit Props Override

**Check component:**
```vue
<UButton v-theme="'chat.send'" variant="outline">
    Send
</UButton>
```

Explicit `variant="outline"` overrides theme.

**Solution:**

Remove explicit prop if theme should control it:
```vue
<UButton v-theme="'chat.send'">Send</UButton>
```

Or keep explicit props for dynamic cases:
```vue
<UButton v-theme="'chat.send'" :variant="isDraft ? 'outline' : 'solid'">
    Send
</UButton>
```

---

## Performance Issues

### Symptom

Slow component rendering; theme resolution taking >10ms.

### Possible Causes

#### 1. Too Many Overrides

**Check:**
```bash
# Count overrides
grep -c "'.*':" app/theme/my-theme/theme.ts
# If >200, too many
```

**Solution:**

Consolidate selectors:
```typescript
// Bad: 50 selectors for buttons
'button#btn1': { /* ... */ },
'button#btn2': { /* ... */ },
'button#btn3': { /* ... */ },
// ...

// Good: 5 generic selectors
'button': { /* ... */ },
'button.chat': { /* ... */ },
'button.sidebar': { /* ... */ },
'button#send': { /* ... */ },
'button#cancel': { /* ... */ },
```

#### 2. Dynamic Selector Computation

**Check component:**
```vue
<UButton :v-theme="`${context}.${action}`">{{ label }}</UButton>
```

**Solution:**

Use static selectors:
```vue
<UButton v-theme="'chat.send'" v-if="action === 'send'">Send</UButton>
<UButton v-theme="'chat.cancel'" v-else>Cancel</UButton>
```

#### 3. Creating New Resolvers

**Check composable:**
```typescript
export function useMyComposable() {
    const resolver = new RuntimeResolver(overrides);  // ✗ New instance
    // ...
}
```

**Solution:**

Reuse resolver from plugin:
```typescript
export function useMyComposable() {
    const resolver = useRuntimeResolver();  // ✓ Reused
    // ...
}
```

#### 4. Complex Selectors

**Check:**
```typescript
overrides: {
    'button.chat#send[type="submit"][disabled="false"]:hover:focus': {
        /* ... */
    }
}
```

**Solution:**

Simplify:
```typescript
overrides: {
    'button.chat#send': { /* ... */ }
}
```

Use CSS classes for state-specific styling.

---

## TypeScript Errors

### Symptom

`ThemeName`, `ThemeIdentifier` types not recognized; compile errors.

### Possible Causes

#### 1. Missing Generated Types

**Check:**
```bash
ls types/theme-generated.d.ts
# If missing
```

**Solution:**
```bash
bun run theme:compile
```

#### 2. Outdated Types

**Check `types/theme-generated.d.ts`:**
```typescript
type ThemeName = 'light' | 'dark';
// My new theme 'ocean' is missing!
```

**Solution:**

Recompile:
```bash
bun run theme:compile
```

#### 3. TypeScript Not Picking Up Types

**Check `tsconfig.json`:**
```json
{
    "include": [
        "types/**/*.d.ts"
    ]
}
```

**Solution:**

Restart TypeScript server:
- VSCode: `Cmd+Shift+P` → "TypeScript: Restart TS Server"
- Or restart editor

---

## CLI Command Errors

### `bun run theme:create` Fails

**Symptom:**
```
Error: Theme directory already exists
```

**Solution:**

Choose a different name or remove existing theme:
```bash
rm -rf app/theme/my-theme
bun run theme:create
```

### `bun run theme:validate` Fails

**Symptom:**
```
ThemeValidationError: Missing required color 'primary'
```

**Solution:**

Add missing colors:
```typescript
colors: {
    primary: '#6366f1',      // ← Add this
    onPrimary: '#ffffff',    // ← And this
    // ...
}
```

**Symptom:**
```
ThemeValidationError: Invalid selector 'button..chat'
```

**Solution:**

Fix selector syntax:
```typescript
overrides: {
    'button.chat': { /* ... */ }  // ✓ Single dot
}
```

### `bun run theme:switch` Doesn't Persist

**Symptom:**

Theme switches but reverts on page reload.

**Solution:**

Check localStorage:
```javascript
// In browser console
localStorage.setItem('activeTheme', 'my-theme');
```

If localStorage is disabled (private browsing), theme won't persist.

---

## Build Errors

### Vite Build Fails

**Symptom:**
```
[vite] Failed to resolve import '~/theme/my-theme/theme'
```

**Solution:**

Ensure theme file exports default:
```typescript
// app/theme/my-theme/theme.ts
import { defineTheme } from '~/theme/_shared/define-theme';

export default defineTheme({ /* ... */ });  // ← Must export default
```

### Type Generation Fails

**Symptom:**
```
Error: Cannot find module 'app/theme'
```

**Solution:**

Ensure theme directory structure:
```
app/theme/
  ├── _shared/
  │   ├── define-theme.ts
  │   └── types.ts
  └── my-theme/
      └── theme.ts
```

---

## Runtime Errors

### `RuntimeResolver is not a constructor`

**Symptom:**
```javascript
TypeError: RuntimeResolver is not a constructor
```

**Solution:**

Import from correct path:
```typescript
// ✗ Wrong
import { RuntimeResolver } from '~/theme/_shared/types';

// ✓ Correct
import { RuntimeResolver } from '~/theme/_shared/runtime-resolver';
```

### `Cannot read property 'resolve' of null`

**Symptom:**
```javascript
TypeError: Cannot read property 'resolve' of null
```

**Solution:**

Check if resolver is initialized:
```typescript
const resolver = useRuntimeResolver();

if (!resolver) {
    console.warn('Theme not loaded yet');
    return;
}

const props = resolver.resolve('button', 'chat', 'send');
```

### `Maximum call stack size exceeded`

**Symptom:**

Infinite loop in theme resolution.

**Solution:**

Check for circular `extends`:
```typescript
// ✗ Bad: Circular dependency
// ocean.ts
export default defineTheme({
    name: 'ocean',
    extends: 'forest',  // ← Extends forest
});

// forest.ts
export default defineTheme({
    name: 'forest',
    extends: 'ocean',  // ← Extends ocean (circular!)
});
```

Fix:
```typescript
// ✓ Good: Linear inheritance
export default defineTheme({
    name: 'ocean',
    extends: 'base',  // ← Extends base
});
```

---

## Visual Issues

### Components Look Inconsistent

**Check:**

Some components themed, others not.

**Solution:**

Add `v-theme` to all Nuxt UI components:
```bash
# Find components without v-theme
grep -r '<UButton' app/components/ | grep -v 'v-theme'
grep -r '<UInput' app/components/ | grep -v 'v-theme'
```

Add directive:
```vue
<UButton v-theme>Click</UButton>
```

### Theme Flashes on Page Load

**Symptom:**

Brief flash of default theme before custom theme applies.

**Solution:**

Set theme class on `<html>` in `app.vue`:
```vue
<script setup lang="ts">
const { current } = useTheme();

useHead({
    htmlAttrs: {
        class: () => current.value,
        'data-theme': () => current.value
    }
});
</script>
```

### Dark Mode Toggle Breaks

**Symptom:**

Dark mode doesn't switch; stuck on light.

**Solution:**

Check theme plugin:
```typescript
// app/plugins/theme.client.ts
export default defineNuxtPlugin(() => {
    const theme = ref(localStorage.getItem('activeTheme') || 'light');
    
    function toggle() {
        theme.value = theme.value === 'light' ? 'dark' : 'light';
        localStorage.setItem('activeTheme', theme.value);
        document.documentElement.classList.toggle('dark');
    }
    
    return {
        provide: {
            theme: { current: theme, toggle }
        }
    };
});
```

---

## Browser Compatibility

### Internet Explorer 11

**Symptom:**

Theme system doesn't work in IE11.

**Solution:**

IE11 is not supported. Use modern browsers:
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

### Safari Private Browsing

**Symptom:**

Theme doesn't persist in Safari private mode.

**Solution:**

localStorage is restricted in private browsing. Use session storage fallback:
```typescript
function getStorage() {
    try {
        localStorage.setItem('test', 'test');
        localStorage.removeItem('test');
        return localStorage;
    } catch {
        return sessionStorage;
    }
}

const storage = getStorage();
storage.setItem('activeTheme', 'my-theme');
```

---

## Debugging Techniques

### Enable Theme Debug Logs

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
    theme: {
        debug: true  // Logs theme resolution
    }
});
```

**Console output:**
```
[Theme] Resolving button.chat#send
[Theme] Matched: button (specificity: 1)
[Theme] Matched: button.chat (specificity: 11)
[Theme] Matched: button.chat#send (specificity: 31) ← Winner
[Theme] Resolved props: { variant: 'solid', color: 'primary' }
```

### Inspect Resolver State

```javascript
// In browser console
const resolver = window.$nuxt.$theme.resolver;

// List all selectors
console.log(resolver._selectors);

// Test resolution
console.log(resolver.resolve('button', 'chat', 'send'));
```

### Check CSS Variables

```javascript
// In browser console
const root = document.documentElement;
const primary = getComputedStyle(root).getPropertyValue('--md-primary');
console.log('Primary color:', primary);

// Check all MD3 tokens
const tokens = [
    '--md-primary',
    '--md-on-primary',
    '--md-secondary',
    '--md-surface',
    '--md-on-surface'
];

tokens.forEach(token => {
    const value = getComputedStyle(root).getPropertyValue(token);
    console.log(`${token}: ${value}`);
});
```

### Test Specificity Calculation

```typescript
import { parseSelector, calculateSpecificity } from '~/app/plugins/theme.client';

const selector = 'button.chat#send:hover';
const parsed = parseSelector(selector);
const specificity = calculateSpecificity(parsed);

console.log('Parsed:', parsed);
console.log('Specificity:', specificity);
```

---

## FAQ

### Q: Can I use themes with Tailwind classes?

**A:** Yes! Themes set CSS variables that Tailwind uses:
```vue
<div class="bg-primary text-on-primary">
    Uses theme's primary color
</div>
```

### Q: Can I have multiple themes active?

**A:** No. Only one theme is active globally. Use overrides for component-specific variations.

### Q: Can I change themes programmatically?

**A:** Yes:
```typescript
const { set } = useTheme();
set('ocean');
```

### Q: Do themes work with SSR?

**A:** Yes, but theme is applied client-side. Use `useHead` to set initial theme class.

### Q: Can I share themes between projects?

**A:** Yes! Export theme definition and import in other projects:
```typescript
// Published as npm package
import oceanTheme from '@my-org/ocean-theme';

export default defineNuxtConfig({
    theme: {
        themes: [oceanTheme]
    }
});
```

### Q: How do I reset to default theme?

**A:**
```bash
# CLI
bun run theme:switch
# Select 'light' or 'dark'

# Or programmatically
localStorage.removeItem('activeTheme');
location.reload();
```

---

## Still Stuck?

1. **Check documentation**: See other guides in this section
2. **Search GitHub Issues**: [github.com/your-org/or3-chat/issues](https://github.com)
3. **Ask in Discord**: OR3 community server
4. **File a bug**: Include theme definition, error logs, and screenshots

**Template for bug reports:**

```markdown
**Describe the issue:**
Brief description

**Theme definition:**
```typescript
// Paste theme.ts content
```

**Steps to reproduce:**
1. Step one
2. Step two
3. ...

**Expected behavior:**
What should happen

**Actual behavior:**
What actually happens

**Environment:**
- OS: macOS 13.2
- Browser: Chrome 120
- Nuxt: 4.2.0
- OR3: 1.0.0

**Error logs:**
```
Paste console errors
```

**Screenshots:**
[Attach if relevant]
```

---

## Preventive Measures

To avoid issues:

1. ✅ **Always validate themes** before deploying
2. ✅ **Test theme switching** manually
3. ✅ **Run visual regression tests** for all themes
4. ✅ **Keep overrides under 100**
5. ✅ **Use semantic naming** for identifiers
6. ✅ **Document custom colors** and selectors
7. ✅ **Version themes** with semantic versioning
8. ✅ **Maintain changelogs** for theme updates

See [Best Practices](./best-practices.md) for comprehensive guidelines.
