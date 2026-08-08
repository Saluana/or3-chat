# usePopoverKeyboard

Accessibility helper for popover trigger buttons. It makes triggers keyboard-activatable with Enter and Space.

## Purpose

`usePopoverKeyboard()` returns `handlePopoverTriggerKey(event)`, designed for `@keydown` on a trigger element:

-   Activates the trigger on `Enter` or `Space` (Space matches both `event.code` and `event.key` for layout safety).
-   Prevents default scrolling and stops propagation.
-   Calls `click()` on the current target.

## Usage

```vue
<template>
    <button
        type="button"
        class="popover-trigger"
        @keydown="handlePopoverTriggerKey"
    >
        Open menu
    </button>
</template>

<script setup lang="ts">
import { usePopoverKeyboard } from '~/composables/usePopoverKeyboard';

const { handlePopoverTriggerKey } = usePopoverKeyboard();
</script>
```

## Notes

-   Use on the element that receives focus, not on the popover content.
-   Space keydown fires repeatedly when held; the click handler should ignore repeats if that matters.

## Related

-   `useChatMentions` — a popover-driven feature that benefits from keyboard activation.
