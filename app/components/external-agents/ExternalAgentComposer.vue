<template>
  <ChatComposerShell
    tag="form"
    size="lg"
    :class="[
      'external-agent-composer',
      isDragging ? 'external-agent-composer--dragging' : '',
      mainContainerProps?.class,
    ]"
    :data-theme-target="mainContainerProps?.['data-theme-target']"
    :data-theme-matches="mainContainerProps?.['data-theme-matches']"
    aria-label="Agent composer"
    @click="focusFromContainer"
    @dragenter.prevent="onDragEnter"
    @dragover.prevent
    @dragleave.prevent="onDragLeave"
    @drop.prevent="onDrop"
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
        @paste="onPaste"
      />

      <div
        v-if="attachments.length"
        class="chat-input-attachments flex max-h-28 gap-2 overflow-x-auto pb-0.5"
        aria-label="Attached files"
      >
        <article
          v-for="attachment in attachments"
          :key="attachment.id"
          class="group relative flex min-w-0 max-w-56 shrink-0 items-center gap-2 rounded-[calc(var(--md-border-radius)*0.8)] border border-[var(--md-outline-variant)] bg-[var(--md-surface-container-low)] py-1.5 pl-1.5 pr-8"
        >
          <img
            v-if="attachment.previewUrl"
            :src="attachment.previewUrl"
            :alt="attachment.name"
            class="size-9 shrink-0 rounded-[calc(var(--md-border-radius)*0.55)] object-cover"
          />
          <span
            v-else
            class="grid size-9 shrink-0 place-items-center rounded-[calc(var(--md-border-radius)*0.55)] bg-[var(--md-surface-container-high)]"
          >
            <UIcon
              :name="attachmentIcon(attachment)"
              class="size-4 text-[var(--md-on-surface-variant)]"
            />
          </span>
          <span class="min-w-0 text-left">
            <strong class="block truncate text-xs font-medium">
              {{ attachment.name }}
            </strong>
            <small
              class="block truncate text-[10px] text-[var(--md-on-surface-variant)]"
            >
              {{ formatFileSize(attachment.sizeBytes) }}
            </small>
          </span>
          <UButton
            type="button"
            color="neutral"
            variant="ghost"
            size="xs"
            square
            :disabled="loading"
            class="absolute right-1 top-1 size-6 min-h-6 min-w-6 p-0 opacity-70 transition-opacity hover:opacity-100"
            :aria-label="`Remove ${attachment.name}`"
            @click="removeAttachment(attachment.id)"
          >
            <UIcon name="i-lucide-x" class="size-3.5" />
          </UButton>
        </article>
      </div>

      <div
        class="chat-input-bottom-controls flex w-full flex-wrap items-center gap-2.5"
      >
        <div
          class="chat-input-bottom-controls-left flex min-w-0 flex-1 items-center gap-2"
        >
          <div class="chat-input-attachment-btn relative shrink-0">
            <UButton
              v-bind="attachButtonProps"
              type="button"
              aria-label="Add attachments"
              :disabled="disabled || loading"
              @click="openFilePicker"
            >
              <UIcon name="i-lucide-paperclip" class="size-4" />
            </UButton>
          </div>
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
                <div
                  class="max-h-[min(42rem,calc(100dvh-2rem))] w-[min(22rem,calc(100vw-2rem))] overscroll-contain overflow-y-auto p-4 [scrollbar-gutter:stable]"
                  data-testid="external-agent-settings-scroll-region"
                >
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
            :disabled="
              disabled || loading || (!modelValue.trim() && !attachments.length)
            "
          >
            <UIcon name="i-lucide-arrow-up" class="size-4" />
          </UButton>
        </div>
      </div>
    </div>

    <input
      ref="fileInput"
      type="file"
      class="sr-only"
      tabindex="-1"
      multiple
      aria-hidden="true"
      @change="onFileInput"
    />

    <div
      v-if="isDragging"
      :class="[
        'chat-input-drag-and-drop-overlay pointer-events-none absolute inset-0 z-50 grid place-items-center bg-[var(--md-primary-container)]/90',
        dragOverlayProps?.class,
      ]"
      :data-theme-target="dragOverlayProps?.['data-theme-target']"
      :data-theme-matches="dragOverlayProps?.['data-theme-matches']"
    >
      <div class="text-center text-[var(--md-on-primary-container)]">
        <UIcon name="i-lucide-file-up" class="mx-auto mb-2 size-8" />
        <p class="text-sm font-medium">Drop files to attach</p>
      </div>
    </div>
  </ChatComposerShell>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useToast } from "#imports";
import ChatComposerShell from "~/components/chat/ChatComposerShell.vue";
import { useChatInputTheme } from "~/composables/chat/useChatInputTheme";
import { useOr3Config } from "~/composables/useOr3Config";
import type {
  ExternalAgentAttachmentKind,
  ExternalAgentUploadAttachment,
} from "~/core/external-agents/types";

type ComposerAttachment = ExternalAgentUploadAttachment & {
  readonly previewUrl?: string;
};

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
  send: [attachments: readonly ExternalAgentUploadAttachment[]];
  stop: [];
}>();

const input = ref<HTMLTextAreaElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const attachments = ref<ComposerAttachment[]>([]);
const isDragging = ref(false);
const dragDepth = ref(0);
const closeIcon = ref("i-lucide-x");
const {
  sendButtonProps,
  stopButtonProps,
  attachButtonProps,
  settingsButtonProps,
  mainContainerProps,
  dragOverlayProps,
} = useChatInputTheme(closeIcon);
const config = useOr3Config();
const toast = useToast();

function submit() {
  if (
    !props.running &&
    !props.disabled &&
    !props.loading &&
    (props.modelValue.trim() || attachments.value.length)
  ) {
    emit(
      "send",
      attachments.value.map(({ previewUrl: _previewUrl, ...attachment }) => ({
        ...attachment,
      })),
    );
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

function openFilePicker() {
  fileInput.value?.click();
}

function attachmentKind(file: File): ExternalAgentAttachmentKind {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("text/")) return "text";
  return "file";
}

function makeAttachmentId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `attachment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
}

function makePreviewUrl(file: File): string | undefined {
  if (!file.type.startsWith("image/")) return undefined;
  try {
    return URL.createObjectURL(file);
  } catch {
    return undefined;
  }
}

function releasePreview(attachment: ComposerAttachment) {
  if (!attachment.previewUrl?.startsWith("blob:")) return;
  try {
    URL.revokeObjectURL(attachment.previewUrl);
  } catch {
    // The browser may already have released the object URL.
  }
}

function addFiles(files: FileList | readonly File[]) {
  const available = config.limits.maxFilesPerMessage - attachments.value.length;
  if (available <= 0) {
    toast.add({
      title: "Attachment limit reached",
      description: `Maximum ${config.limits.maxFilesPerMessage} files per message.`,
      color: "warning",
    });
    return;
  }
  const selected = Array.from(files);
  const accepted = selected.slice(0, available);
  const rejectedForSize = accepted.filter(
    (file) => file.size > config.limits.maxFileSizeBytes,
  );
  for (const file of accepted) {
    if (file.size > config.limits.maxFileSizeBytes) continue;
    attachments.value.push({
      id: makeAttachmentId(),
      kind: attachmentKind(file),
      name: file.name,
      mimeType: file.type || undefined,
      sizeBytes: file.size,
      data: file,
      previewUrl: makePreviewUrl(file),
    });
  }
  if (rejectedForSize.length) {
    toast.add({
      title: "File too large",
      description: `Files must be ${Math.round(
        config.limits.maxFileSizeBytes / 1024 / 1024,
      )} MB or smaller.`,
      color: "warning",
    });
  }
  if (selected.length > available) {
    toast.add({
      title: "Some files were not added",
      description: `Maximum ${config.limits.maxFilesPerMessage} files per message.`,
      color: "warning",
    });
  }
}

function onFileInput(event: Event) {
  const target = event.target as HTMLInputElement;
  if (target.files) addFiles(target.files);
  target.value = "";
}

function onPaste(event: ClipboardEvent) {
  const files = event.clipboardData?.files;
  if (!files?.length) return;
  event.preventDefault();
  addFiles(files);
}

function onDragEnter(event: DragEvent) {
  if (!event.dataTransfer?.types.includes("Files")) return;
  dragDepth.value += 1;
  isDragging.value = true;
}

function onDragLeave() {
  dragDepth.value = Math.max(0, dragDepth.value - 1);
  if (!dragDepth.value) isDragging.value = false;
}

function onDrop(event: DragEvent) {
  dragDepth.value = 0;
  isDragging.value = false;
  if (event.dataTransfer?.files?.length) {
    addFiles(event.dataTransfer.files);
  }
}

function removeAttachment(id: string) {
  const index = attachments.value.findIndex(
    (attachment) => attachment.id === id,
  );
  if (index < 0) return;
  const [removed] = attachments.value.splice(index, 1);
  if (removed) releasePreview(removed);
}

function clearAttachments(
  expected?: readonly ExternalAgentUploadAttachment[],
): boolean {
  if (
    expected &&
    (attachments.value.length !== expected.length ||
      attachments.value.some(
        (attachment, index) => attachment.id !== expected[index]?.id,
      ))
  ) {
    return false;
  }
  attachments.value.forEach(releasePreview);
  attachments.value = [];
  return true;
}

function attachmentIcon(attachment: ComposerAttachment): string {
  if (attachment.kind === "audio") return "i-lucide-file-audio";
  if (attachment.kind === "video") return "i-lucide-file-video";
  if (attachment.kind === "text") return "i-lucide-file-text";
  if (attachment.mimeType === "application/pdf") return "i-lucide-file-type-2";
  return "i-lucide-file";
}

function formatFileSize(size = 0): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function focus() {
  input.value?.focus();
}

watch(
  () => props.modelValue,
  () => void nextTick(resizeInput),
);
onMounted(resizeInput);
onBeforeUnmount(clearAttachments);

defineExpose({ focus, clearAttachments });
</script>
