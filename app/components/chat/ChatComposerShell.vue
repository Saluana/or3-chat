<template>
  <component
    :is="tag"
    ref="rootElement"
    v-bind="attrs"
    :class="[
      'chat-composer-shell chat-input-main relative z-10 mx-2 flex cursor-text flex-col items-stretch bg-[var(--md-surface)] transition-all duration-300 md:mx-0',
      `chat-composer-shell--${size}`,
    ]"
    :data-composer-size="size"
  >
    <slot />
  </component>
</template>

<script setup lang="ts">
import { ref, useAttrs } from "vue";

defineOptions({ inheritAttrs: false });

type ChatComposerSize = "sm" | "lg";

withDefaults(
  defineProps<{
    tag?: "div" | "form" | "section";
    size?: ChatComposerSize;
  }>(),
  {
    tag: "div",
    size: "sm",
  },
);

const attrs = useAttrs();
const rootElement = ref<HTMLElement | null>(null);

defineExpose({ rootElement });
</script>

<style scoped>
.chat-composer-shell {
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--md-outline) 18%, transparent);
  border-radius: 28px;
  background: color-mix(in srgb, var(--md-surface) 92%, white 8%);
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--md-outline) 6%, transparent),
    0 1px 3px rgb(0 0 0 / 4%),
    0 4px 12px -4px rgb(0 0 0 / 6%);
  transition:
    border-color 250ms ease,
    box-shadow 350ms cubic-bezier(0.4, 0, 0.2, 1),
    transform 200ms ease;
}

.chat-composer-shell:hover:not(:focus-within) {
  border-color: color-mix(in srgb, var(--md-outline) 32%, transparent);
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--md-outline) 8%, transparent),
    0 2px 6px rgb(0 0 0 / 5%),
    0 6px 18px -6px rgb(0 0 0 / 7%);
}

.chat-composer-shell:focus-within,
.chat-composer-shell.external-agent-composer--dragging {
  border-color: color-mix(in srgb, var(--md-primary) 45%, transparent);
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--md-primary) 12%, transparent),
    0 0 0 4px color-mix(in srgb, var(--md-primary) 6%, transparent),
    0 2px 8px rgb(0 0 0 / 6%),
    0 8px 24px -8px rgb(0 0 0 / 8%);
}

.chat-composer-shell--sm {
  --chat-composer-editor-min-height: 2rem;
}

.chat-composer-shell--sm :deep(.chat-input-inner-container) {
  gap: 0.25rem;
  margin: 0.45rem 0.75rem;
}

.chat-composer-shell--sm :deep(.chat-input-editor-container),
.chat-composer-shell--sm :deep(.chat-input-editor),
.chat-composer-shell--sm :deep(.prosemirror-host) {
  min-height: var(--chat-composer-editor-min-height);
}

.chat-composer-shell--lg {
  --chat-composer-editor-min-height: 6rem;
}

.chat-composer-shell--lg :deep(.chat-input-editor-container),
.chat-composer-shell--lg :deep(textarea) {
  min-height: var(--chat-composer-editor-min-height);
}

@media (prefers-color-scheme: dark) {
  .chat-composer-shell {
    background: color-mix(in srgb, var(--md-surface) 90%, white 10%);
    border-color: color-mix(in srgb, var(--md-outline) 30%, transparent);
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--md-outline) 15%, transparent),
      0 1px 4px rgb(0 0 0 / 30%),
      0 4px 16px -4px rgb(0 0 0 / 40%);
  }

  .chat-composer-shell:hover:not(:focus-within) {
    border-color: color-mix(in srgb, var(--md-outline) 55%, transparent);
  }

  .chat-composer-shell:focus-within,
  .chat-composer-shell.external-agent-composer--dragging {
    border-color: color-mix(in srgb, var(--md-primary) 60%, transparent);
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--md-primary) 25%, transparent),
      0 0 0 4px color-mix(in srgb, var(--md-primary) 12%, transparent),
      0 2px 8px rgb(0 0 0 / 30%),
      0 8px 24px -8px rgb(0 0 0 / 40%);
  }
}

:global(.dark) .chat-composer-shell {
  background: color-mix(in srgb, var(--md-surface) 90%, white 10%);
  border-color: color-mix(in srgb, var(--md-outline) 30%, transparent);
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--md-outline) 15%, transparent),
    0 1px 4px rgb(0 0 0 / 30%),
    0 4px 16px -4px rgb(0 0 0 / 40%);
}

:global(.dark) .chat-composer-shell:hover:not(:focus-within) {
  border-color: color-mix(in srgb, var(--md-outline) 55%, transparent);
}

:global(.dark) .chat-composer-shell:focus-within,
:global(.dark) .chat-composer-shell.external-agent-composer--dragging {
  border-color: color-mix(in srgb, var(--md-primary) 60%, transparent);
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--md-primary) 25%, transparent),
    0 0 0 4px color-mix(in srgb, var(--md-primary) 12%, transparent),
    0 2px 8px rgb(0 0 0 / 30%),
    0 8px 24px -8px rgb(0 0 0 / 40%);
}

@media (prefers-reduced-motion: reduce) {
  .chat-composer-shell {
    transition-duration: 1ms;
  }
}
</style>
