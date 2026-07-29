<template>
  <form
    :class="[
      'chat-input-main relative z-10 mx-2 flex cursor-text flex-col items-stretch bg-[var(--md-surface)] transition-all duration-300 hover:border-[var(--md-primary)] focus-within:border-[var(--md-primary)] md:mx-0',
      mainContainerProps?.class,
    ]"
    :data-theme-target="mainContainerProps?.['data-theme-target']"
    :data-theme-matches="mainContainerProps?.['data-theme-matches']"
    aria-label="Agent composer"
    @click="focusFromContainer"
    @submit.prevent="submit"
  >
    <div class="chat-input-inner-container m-3.5 flex flex-col gap-3.5">
      <textarea
        ref="input"
        :value="modelValue"
        rows="2"
        :disabled="disabled"
        :placeholder="placeholder"
        aria-label="Message the agent"
        class="max-h-64 min-h-12 w-full resize-none overflow-y-auto border-0 bg-transparent px-1 py-1 text-base leading-6 text-[var(--md-on-surface)] shadow-none outline-none placeholder:text-[var(--md-on-surface-variant)] disabled:cursor-not-allowed disabled:opacity-60"
        @input="onInput"
        @keydown="onKeydown"
      />

      <div
        class="chat-input-bottom-controls flex w-full flex-wrap items-center gap-2.5"
      >
        <div
          class="chat-input-bottom-controls-left flex min-w-0 flex-1 items-center gap-2"
        >
          <slot name="leading" />
        </div>
        <ClientOnly v-if="$slots.settings">
          <div class="chat-input-settings-btn shrink-0">
            <UPopover>
              <UButton
                v-bind="settingsButtonProps"
                type="button"
                aria-label="Agent settings"
                :disabled="settingsDisabled"
              >
                <UIcon name="i-lucide-sliders-horizontal" class="size-4" />
              </UButton>
              <template #content>
                <div class="w-[min(22rem,calc(100vw-2rem))] p-4">
                  <slot name="settings" />
                </div>
              </template>
            </UPopover>
          </div>
        </ClientOnly>
        <div class="chat-input-bottom-controls-right shrink-0">
          <UButton
            v-if="running"
            class="chat-input-stop-btn"
            v-bind="stopButtonProps"
            type="button"
            aria-label="Stop agent"
            @click="$emit('stop')"
          >
            <UIcon name="i-lucide-square" class="size-4" />
          </UButton>
          <UButton
            v-else
            class="chat-input-send-btn"
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
    </div>
  </form>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from "vue";
import { useChatInputTheme } from "~/composables/chat/useChatInputTheme";

const props = withDefaults(
  defineProps<{
    modelValue: string;
    running?: boolean;
    loading?: boolean;
    disabled?: boolean;
    settingsDisabled?: boolean;
    placeholder?: string;
  }>(),
  {
    running: false,
    loading: false,
    disabled: false,
    settingsDisabled: false,
    placeholder: "Ask the agent to do something…",
  },
);

const emit = defineEmits<{
  "update:modelValue": [value: string];
  send: [];
  stop: [];
}>();

const input = ref<HTMLTextAreaElement | null>(null);
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

function resizeInput() {
  const element = input.value;
  if (!element) return;
  element.style.height = "auto";
  element.style.height = `${Math.min(element.scrollHeight, 256)}px`;
}

function onInput(event: Event) {
  emit("update:modelValue", (event.target as HTMLTextAreaElement).value);
  resizeInput();
}

function focusFromContainer(event: MouseEvent) {
  const target = event.target as HTMLElement;
  if (target.closest("button, [role='button'], input, select, textarea"))
    return;
  focus();
}

function focus() {
  input.value?.focus();
}

watch(
  () => props.modelValue,
  () => void nextTick(resizeInput),
);
onMounted(resizeInput);

defineExpose({ focus });
</script>
