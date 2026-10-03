<script setup lang="ts">
import { computed } from 'vue';
import type { ModalProps } from '@nuxt/ui';
import { useIcon } from '~/composables/useIcon';
import { useDialogFocus } from '~/composables/ui/useDialogFocus';

defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<{
    open: boolean;
    title: string;
    size?: 'sm' | 'md' | 'lg' | 'workspace';
    closeLabel?: string;
    ui?: ModalProps['ui'];
    content?: ModalProps['content'];
}>(), { size: 'sm' });

const emit = defineEmits<{ 'update:open': [value: boolean] }>();
const closeIcon = useIcon('ui.close');
const dialogContent = useDialogFocus(() => props.content, () => props.size === 'workspace' ? 'workspace' : 'center');
const widths = {
    sm: 'max-w-[560px]',
    md: 'max-w-[700px]',
    lg: 'max-w-[880px]',
    workspace: 'max-w-[1280px]',
};

// Themes own the surface; the shared shell owns spacing and geometry.
const modalUi = computed<ModalProps['ui']>(() => ({
    ...props.ui,
    overlay: [props.ui?.overlay, 'bg-[rgb(15_23_42/0.22)]! backdrop-blur-[1.5px]!'].filter(Boolean).join(' '),
    content: [
        props.ui?.content,
        'app-modal w-[calc(100dvw-2rem)] h-auto max-h-[calc(100dvh-2rem)]! overflow-hidden rounded-[var(--md-border-radius-large,var(--md-border-radius))] ring-0 divide-y-0 border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] bg-[var(--md-surface)] text-[var(--md-on-surface)]',
        widths[props.size],
        props.size === 'workspace' && 'h-[min(800px,calc(100dvh-2rem))] max-sm:w-[100dvw] max-sm:h-[100dvh] max-sm:max-w-none max-sm:max-h-[100dvh]! max-sm:rounded-none max-sm:border-0 max-sm:pt-[env(safe-area-inset-top)]',
    ].filter(Boolean).join(' '),
    header: [props.ui?.header, 'relative flex shrink-0 items-center justify-between gap-4 min-h-0! p-6! pb-0! border-0! bg-transparent! text-[var(--md-on-surface)]!'].filter(Boolean).join(' '),
    wrapper: 'min-w-0 flex-1',
    title: [props.ui?.title, 'line-clamp-2 wrap-anywhere text-[20px]! font-semibold! leading-7! text-[var(--md-on-surface)]!'].filter(Boolean).join(' '),
    description: 'sr-only!',
    close: 'relative! top-auto! end-auto! size-[44px]! min-h-[44px]! min-w-[44px]! shrink-0 p-0! flex items-center justify-center shadow-none! [&_[data-slot=leadingIcon]]:size-5!',
    body: [props.ui?.body, props.size === 'workspace'
        ? 'min-h-0 min-w-0 flex-1 overflow-hidden! p-0! border-0!'
        : 'min-h-0 min-w-0 px-6! pt-7! pb-6! border-0!'].filter(Boolean).join(' '),
    footer: [props.ui?.footer, 'flex shrink-0 items-center justify-end gap-2.5! px-6! pt-1! pb-6! border-0!'].filter(Boolean).join(' '),
}));
</script>

<template>
    <UModal
        v-bind="$attrs"
        :open="open"
        :title="title"
        :close-icon="closeIcon"
        :close="true"
        :ui="modalUi"
        :content="dialogContent"
        @update:open="emit('update:open', $event)"
    >
        <template v-if="closeLabel" #close="{ ui }">
            <UButton
                :icon="closeIcon"
                color="neutral"
                variant="ghost"
                :aria-label="closeLabel"
                data-slot="close"
                :class="ui.close({ class: modalUi?.close })"
            />
        </template>
        <template v-if="$slots.actions" #actions>
            <slot name="actions" />
        </template>
        <template #body>
            <slot />
        </template>
        <template v-if="$slots.footer" #footer>
            <slot name="footer" />
        </template>
    </UModal>
</template>

<style>
.app-modal {
    box-shadow: var(--app-elevation-high, 0 20px 64px rgb(15 23 42 / 0.16));
}

.app-modal [data-slot='body'] {
    overscroll-behavior: contain;
    overflow-wrap: anywhere;
}

.app-modal [data-slot='footer'],
.app-modal [data-slot='footer'] > div {
    flex-wrap: wrap;
    min-width: 0;
}

@layer utilities {
@media (max-width: 767px), (pointer: coarse) {
    .app-modal[role=dialog] button:not([role='switch']) {
        min-height: 44px !important;
    }
    .app-modal [data-slot='close'] {
        width: 44px !important;
        height: 44px !important;
        min-width: 44px !important;
        padding: 0 !important;
    }
    .app-modal [data-slot='footer'] button {
        max-width: 100%;
        white-space: normal;
    }
}

.app-modal[data-compact-viewport] [data-slot='header'] { padding: 16px 16px 0 !important; gap: 8px; }
.app-modal[data-compact-viewport] > [data-slot='body']:not(:has(.system-prompts-shell, .model-catalog-shell)) { padding: 16px !important; }
.app-modal[data-compact-viewport] [data-slot='footer'] { padding: 4px 16px max(16px, env(safe-area-inset-bottom)) !important; }

@media (max-width: 639px), (max-height: 500px) {
    .app-modal [data-slot='header'] {
        padding: 16px 16px 0 !important;
        gap: 8px;
    }
    .app-modal > [data-slot='body']:not(:has(.system-prompts-shell, .model-catalog-shell)) {
        padding: 16px !important;
    }
    .app-modal [data-slot='footer'] {
        padding: 4px 16px max(16px, env(safe-area-inset-bottom)) !important;
    }
}

.app-modal [data-slot='label'] {
    margin-bottom: 0;
    padding-inline: 0;
}
}
</style>
