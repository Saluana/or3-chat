# Theme Icon System

OR3 uses semantic icon tokens so themes can swap icon sets without changing
component code.

## Core pieces

- `app/config/icon-tokens.ts` defines tokens and default icons.
- `app/theme/_shared/icon-registry.ts` stores per-theme overrides.
- `app/plugins/icon-registry.ts` hydrates the registry for SSR.
- `app/composables/useIcon.ts` resolves tokens reactively.

## Using icons in components

```vue
<script setup lang="ts">
const sendIcon = useIcon('chat.send');
</script>

<template>
  <UButton :icon="sendIcon">Send</UButton>
  <UIcon :name="useIcon('ui.trash')" />
</template>
```

In templates, Vue unwraps the computed value automatically. In script logic,
use `.value`.

## Adding new tokens

1. Add a new key to `app/config/icon-tokens.ts` (`DEFAULT_ICONS`).
2. The `IconToken` type updates automatically.

## Overriding icons per theme

Option A: inline in `theme.ts`:

```ts
icons: {
  'chat.send': 'tabler:send',
  'ui.trash': 'tabler:trash',
}
```

Option B: `icons.config.ts`:

```ts
import type { IconMap } from '~/theme/_shared/icon-registry';

export default <IconMap>{
  'chat.send': 'tabler:send',
  'ui.trash': 'tabler:trash',
};
```

Theme icons are loaded and registered when the theme is activated. The CLI
validator (`bun run theme:validate`) also warns about invalid tokens.

## Resolving icons outside components

```ts
const { $iconRegistry, $theme } = useNuxtApp();
const icon = $iconRegistry.resolve('chat.send', $theme.activeTheme.value);
```
