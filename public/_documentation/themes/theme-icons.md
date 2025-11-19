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

Themes can override any token defined in `DEFAULT_ICONS`. The theme compiler automatically detects and registers these overrides.

1.  Create an `icons.config.ts` file in your theme directory (e.g., `app/theme/my-theme/icons.config.ts`).
2.  Export an object matching `Partial<Record<IconToken, string>>` as the default export.

```typescript
// app/theme/my-theme/icons.config.ts
import type { IconMap } from '~/theme/_shared/icon-registry';

export default <IconMap>{
    'sidebar.page.home': 'i-heroicons-home',
    'ui.trash': 'i-lucide-trash-2',
};
```

The theme compiler will automatically validate these tokens and include them in the compiled theme. No manual registration in plugins is required.

## Best Practices

-   **Always use tokens**: Never hardcode `pixelarticons:` strings in components.
-   **Group tokens**: Use prefixes like `sidebar.`, `chat.`, `ui.` to organize tokens.
-   **Fallback**: If a theme doesn't provide an override, the system falls back to the value in `DEFAULT_ICONS`.
-   **Type Safety**: The `useIcon` argument is typed to `IconToken`, providing autocomplete and validation.

````ts
export const DEFAULT_ICONS = {
    // Shell & Navigation
    'shell.sidebar.toggle.left': 'pixelarticons:arrow-bar-left',
    'shell.sidebar.toggle.right': 'pixelarticons:arrow-bar-right',
    'shell.pane.add': 'pixelarticons:card-plus',
    'shell.pane.close': 'pixelarticons:close',
    'shell.theme.light': 'pixelarticons:sun',
    'shell.theme.dark': 'pixelarticons:moon-star',
    'shell.menu': 'pixelarticons:more-vertical',
    'shell.back': 'pixelarticons:arrow-left',
    'shell.expand': 'i-lucide:folder-open',
    'shell.collapse': 'i-lucide:folder',

    // Chat Interface
    'chat.send': 'pixelarticons:arrow-up',
    'chat.stop': 'pixelarticons:pause',
    'chat.attach': 'i-lucide:plus',
    'chat.upload': 'i-lucide:upload-cloud',
    'chat.clear': 'i-lucide:x',
    'chat.model.search': 'pixelarticons:search',
    'chat.model.settings': 'pixelarticons:sliders',
    'chat.model.catalog': 'pixelarticons:android',
    'chat.system_prompt': 'pixelarticons:script-text',

    // Chat Messages
    'chat.message.copy': 'pixelarticons:copy',
    'chat.message.retry': 'pixelarticons:reload',
    'chat.message.edit': 'pixelarticons:edit-box',
    'chat.message.branch': 'pixelarticons:git-branch',
    'chat.message.delete': 'pixelarticons:trash',
    'chat.reasoning': 'pixelarticons:lightbulb-on',

    // Tool Indicators
    'chat.tool.loader': 'pixelarticons:loader',
    'chat.tool.check': 'pixelarticons:check',
    'chat.tool.error': 'pixelarticons:close',
    'chat.tool.wrench': 'pixelarticons:wrench',

    // Sidebar
    'sidebar.search': 'pixelarticons:search',
    'sidebar.new_chat': 'pixelarticons:message-plus',
    'sidebar.new_folder': 'pixelarticons:folder-plus',
    'sidebar.new_note': 'pixelarticons:note-plus',
    'sidebar.edit': 'pixelarticons:edit',
    'sidebar.delete': 'pixelarticons:trash',
    'sidebar.folder': 'pixelarticons:folder',
    'sidebar.chat': 'pixelarticons:chat',
    'sidebar.note': 'pixelarticons:note',
    'sidebar.settings': 'pixelarticons:sliders',
    'sidebar.user': 'pixelarticons:user',
    'sidebar.activity': 'pixelarticons:human-run',
    'sidebar.credits': 'pixelarticons:coin',
    'sidebar.project.root': 'pixelarticons:home',
    'sidebar.page.home': 'pixelarticons:home',
    'sidebar.page.messages': 'pixelarticons:messages-square',
    'sidebar.page.default': 'pixelarticons:view-grid',

    // Common UI
    'ui.check': 'pixelarticons:check',
    'ui.close': 'pixelarticons:close',
    'ui.copy': 'pixelarticons:copy',
    'ui.trash': 'pixelarticons:trash',
    'ui.edit': 'pixelarticons:edit',
    'ui.warning': 'pixelarticons:warning-box',
    'ui.info': 'pixelarticons:info-box',
    'ui.loading': 'pixelarticons:loader',
    'ui.more': 'pixelarticons:more-vertical',
    'ui.download': 'pixelarticons:download',
    'ui.upload': 'pixelarticons:cloud-upload',
    'ui.search': 'pixelarticons:search',
    'ui.filter': 'pixelarticons:list',
    'ui.sort': 'pixelarticons:sort',
    'ui.view': 'pixelarticons:eye',
    'ui.view_off': 'pixelarticons:eye-closed',
    'ui.lock': 'pixelarticons:lock',
    'ui.unlock': 'pixelarticons:lock-open',
    'ui.settings': 'pixelarticons:sliders',
    'ui.unknown': 'pixelarticons:alert',
    'ui.clock': 'pixelarticons:clock',
    'ui.chart': 'pixelarticons:chart-bar',
    'ui.shield': 'pixelarticons:shield',
    'ui.chevron.left': 'pixelarticons:chevron-left',
    'ui.chevron.down': 'pixelarticons:chevron-down',
    'ui.wait': 'pixelarticons:hourglass',
    'ui.minus': 'pixelarticons:minus',
    'ui.plus': 'pixelarticons:plus',
    'ui.help': 'pixelarticons:message-processing',
    'ui.star': 'pixelarticons:star',
    'ui.moon': 'pixelarticons:moon-stars',
    'ui.dino': 'pixelarticons:downasaur',
    'ui.refresh': 'pixelarticons:reload',
    'ui.fullscreen': 'material-symbols:fullscreen',
    'ui.fullscreen.exit': 'material-symbols:fullscreen-exit',
    'ui.menu': 'pixelarticons:menu',
    'ui.notes': 'pixelarticons:notes',
    'ui.notes.multiple': 'pixelarticons:notes-multiple',
    'ui.chat': 'pixelarticons:message-text',
    'ui.sync': 'pixelarticons:sync',
    'ui.checkbox.on': 'pixelarticons:checkbox-on',
    'ui.checkbox.off': 'pixelarticons:checkbox',
    'ui.book': 'pixelarticons:book',

    // Dashboard
    'dashboard.home': 'pixelarticons:dashboard',
    'dashboard.plugins': 'pixelarticons:zap',
    'dashboard.settings': 'pixelarticons:sliders',
    'dashboard.images': 'pixelarticons:image',
    'dashboard.backup': 'pixelarticons:briefcase-download',
    'dashboard.restore': 'pixelarticons:briefcase-upload',

    // Documents / Editor
    'editor.code': 'pixelarticons:code',
    'editor.list': 'pixelarticons:list',
    'editor.undo': 'pixelarticons:undo',
    'editor.redo': 'pixelarticons:redo',

    // Images
    'image.download': 'pixelarticons:download',
    'image.copy': 'pixelarticons:copy',
    'image.delete': 'pixelarticons:image-delete',
    'image.repeat': 'pixelarticons:repeat',
    'image.multiple': 'pixelarticons:image-multiple',
}```
````
