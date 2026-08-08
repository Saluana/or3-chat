# useChatInputTheme

Composable that resolves themed props for every control in the chat input surface. It centralises send, stop, attach, settings, and composer action button styling so the input looks consistent across themes.

## Purpose

`useChatInputTheme(closeIcon)` returns a set of computed prop objects ready to spread onto Nuxt UI components:

-   `sendButtonProps` — primary send button.
-   `stopButtonProps` — error-styled stop button.
-   `attachButtonProps` — attachment picker button.
-   `settingsButtonProps` — settings button.
-   `composerActionButtonProps` — quick-action row buttons.
-   Container and editor props (`mainContainerProps`, `containerProps`, `editorProps`, `dragOverlayProps`, `attachmentPdfContainerProps`, `attachmentTextContainerProps`) for plain `div` styling.
-   `attachmentRemoveBtnProps` — remove button for attachment chips (uses the `closeIcon` passed in).

Each prop object merges a retro default with overrides from the theme system. Overrides come from `useThemeOverrides` and `useButtonOverrides` using the `chat` context with per-control identifiers (e.g. `chat.send`, `chat.stop`).

## Usage

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { useChatInputTheme } from '~/composables/chat/useChatInputTheme';

const closeIcon = ref('i-ph-x');
const theme = useChatInputTheme(closeIcon);
</script>

<template>
    <UButton v-bind="theme.sendButtonProps" icon="i-ph-paper-plane" />
    <UButton v-bind="theme.stopButtonProps" icon="i-ph-stop" />
</template>
```

## Notes

-   The `closeIcon` argument is a `Ref<string>` so the icon can swap reactively.
-   Identifiers are stable, so themes can target each control individually.

## Related

-   `useThemeResolver` — underlying override resolution.
-   `useTypedThemeOverrides` — type-safe wrappers used here.
-   `ChatInputDropper.vue` — main consumer of these props.
