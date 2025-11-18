# Theme Icon System

The application uses a semantic icon system to decouple UI components from specific icon sets (like Pixelarticons or Lucide). This allows themes to completely swap out the icon set without changing component code.

## Core Concepts

1.  **Semantic Tokens**: Instead of hardcoding `pixelarticons:home`, we use `sidebar.page.home`.
2.  **Icon Registry**: A central registry (`IconRegistry`) resolves tokens to concrete icon strings based on the active theme.
3.  **`useIcon` Composable**: A reactive way to use icons in Vue components.

## Usage

### In Components

Use the `useIcon` composable to resolve an icon token.

```vue
<script setup lang="ts">
import { useIcon } from '#imports';

// Returns a ComputedRef<string>
const homeIcon = useIcon('sidebar.page.home');
</script>

<template>
    <UButton :icon="homeIcon.value" label="Home" />
    <!-- Or directly in template -->
    <UIcon :name="useIcon('ui.trash').value" />
</template>
```

### In Configuration (Non-Reactive)

If you need to resolve an icon outside of a Vue component context (e.g., in a plugin setup function where reactivity isn't needed immediately, though `useIcon` is still preferred if possible), you can use the registry directly, but `useIcon` is recommended for consistency.

## Adding New Icons

1.  Open `app/config/icon-tokens.ts`.
2.  Add a new key-value pair to the `DEFAULT_ICONS` object.
    -   **Key**: The semantic token name (e.g., `feature.action.name`). Use dot notation for hierarchy.
    -   **Value**: The default icon string (e.g., `pixelarticons:rocket`).

```typescript
// app/config/icon-tokens.ts
export const DEFAULT_ICONS = {
    // ...
    'my.new.feature': 'pixelarticons:zap',
};
```

3.  The `IconToken` type is automatically updated.

## Overriding Icons in Themes

Themes can override any token defined in `DEFAULT_ICONS`.

1.  Create or edit your theme's configuration file (e.g., `app/theme/my-theme/icons.ts`).
2.  Define an object matching `Partial<Record<IconToken, string>>`.

```typescript
// app/theme/my-theme/icons.ts
import type { IconMap } from '~/theme/_shared/icon-registry';

export const icons: IconMap = {
    'sidebar.page.home': 'i-heroicons-home',
    'ui.trash': 'i-lucide-trash-2',
};
```

3.  Ensure your theme loader registers these icons.

```typescript
// app/plugins/theme.client.ts (example)
import { icons } from '~/theme/my-theme/icons';
iconRegistry.registerTheme('my-theme', icons);
```

## Best Practices

-   **Always use tokens**: Never hardcode `pixelarticons:` strings in components.
-   **Group tokens**: Use prefixes like `sidebar.`, `chat.`, `ui.` to organize tokens.
-   **Fallback**: If a theme doesn't provide an override, the system falls back to the value in `DEFAULT_ICONS`.
-   **Type Safety**: The `useIcon` argument is typed to `IconToken`, providing autocomplete and validation.
