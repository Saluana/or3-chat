<template>
  <form
    :class="[
      'chat-input-main mx-2 flex flex-col items-stretch bg-[var(--md-surface)] transition-all duration-300 md:mx-0',
      mainContainerProps?.class,
    ]"
    :data-theme-target="mainContainerProps?.['data-theme-target']"
    :data-theme-matches="mainContainerProps?.['data-theme-matches']"
    aria-label="Agent composer"
    @submit.prevent="submit"
  >
    <div class="chat-input-inner-container m-3.5 flex flex-col gap-3.5">
      <UTextarea
        ref="input"
        :model-value="modelValue"
        :rows="2"
        :disabled="disabled"
        autoresize
        :placeholder="placeholder"
        aria-label="Message the agent"
        class="w-full"
        :ui="{
          base: 'max-h-64 resize-none border-0 bg-transparent px-1 py-1 text-base shadow-none ring-0 focus:ring-0',
        }"
        @update:model-value="$emit('update:modelValue', String($event ?? ''))"
        @keydown="onKeydown"
      />

      <div class="flex w-full items-center gap-2.5">
        <div class="min-w-0 flex-1">
          <slot name="leading" />
        </div>
        <ClientOnly v-if="$slots.settings">
          <UPopover>
            <UButton
              v-bind="settingsButtonProps"
              type="button"
              aria-label="Agent settings"
              :disabled="disabled || running"
            >
              <UIcon name="i-lucide-sliders-horizontal" class="size-4" />
            </UButton>
            <template #content>
              <div class="w-[min(22rem,calc(100vw-2rem))] p-4">
                <slot name="settings" />
              </div>
            </template>
          </UPopover>
        </ClientOnly>
        <UButton
          v-if="running"
          v-bind="stopButtonProps"
          type="button"
          aria-label="Stop agent"
          @click="$emit('stop')"
        >
          <UIcon name="i-lucide-square" class="size-4" />
        </UButton>
        <UButton
          v-else
          v-bind="sendButtonProps"
          type="submit"
          aria-label="Send message"
          :loading="loading"
          :disabled="disabled || loading || !modelValue.trim()"
        >
          <UIcon name="i-lucide-arrow-up" class="size-4" />
        </UButton>
      </div>
    </div>
  </form>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useChatInputTheme } from "~/composables/chat/useChatInputTheme";

const props = withDefaults(
  defineProps<{
    modelValue: string;
    running?: boolean;
    loading?: boolean;
    disabled?: boolean;
    placeholder?: string;
  }>(),
  {
    running: false,
    loading: false,
    disabled: false,
    placeholder: "Ask the agent to do something…",
  },
);

const emit = defineEmits<{
  "update:modelValue": [value: string];
  send: [];
  stop: [];
}>();

const input = ref<{ textarea?: HTMLTextAreaElement; $el?: HTMLElement } | null>(
  null,
);
const closeIcon = ref("i-lucide-x");
const {
  sendButtonProps,
  stopButtonProps,
  settingsButtonProps,
  mainContainerProps,
} = useChatInputTheme(closeIcon);

function submit() {
  if (
    !props.running &&
    !props.disabled &&
    !props.loading &&
    props.modelValue.trim()
  ) {
    emit("send");
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  submit();
}

function focus() {
  const element =
    input.value?.textarea ??
    input.value?.$el?.querySelector<HTMLTextAreaElement>("textarea");
  element?.focus();
}

defineExpose({ focus });
</script>
