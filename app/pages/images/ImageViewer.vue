<script setup lang="ts">
import { onBeforeUnmount, reactive, watch, ref, nextTick, computed } from 'vue';
import type { FileMeta } from '~/db/schema';
import { getFileBlob } from '~/db/files';
import { onKeyStroke } from '@vueuse/core';
import { reportError } from '~/utils/errors';
import { useSharedPreviewCache } from '~/composables/core/usePreviewCache';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { useIcon } from '#imports';

const iconDownload = useIcon('image.download');
const iconCopy = useIcon('image.copy');
const iconDelete = useIcon('image.delete');
const iconRepeat = useIcon('image.repeat');
const iconTrash = useIcon('ui.trash');
const iconClose = useIcon('ui.close');

const props = defineProps<{
    modelValue: boolean;
    meta: FileMeta | null;
    trashMode?: boolean;
}>();
const emit = defineEmits<{
    (e: 'update:modelValue', v: boolean): void;
    (e: 'download', meta: FileMeta): void;
    (e: 'copy', meta: FileMeta): void;
    (e: 'rename', meta: FileMeta): void;
    (e: 'delete', meta: FileMeta): void;
    (e: 'restore', meta: FileMeta): void;
}>();

const state = reactive<{ url?: string }>({ url: undefined });
const overlayEl = ref<HTMLElement | null>(null);
const cache = useSharedPreviewCache();
const currentHash = ref<string | null>(null);

const imageViewerModalOverrides = useThemeOverrides({
    component: 'modal',
    context: 'modal',
    identifier: 'modal.image-viewer',
    isNuxtUI: true,
});

const imageViewerModalProps = computed(() => {
    const baseUi = {
        footer: 'justify-end border-t-[var(--md-border-width)]',
        body: 'overflow-hidden flex-1 p-0! h-[100dvh] w-[100dvw]',
    } as Record<string, unknown>;

    const overrideValue =
        (imageViewerModalOverrides.value as Record<string, unknown>) || {};
    const overrideClass =
        typeof overrideValue.class === 'string'
            ? (overrideValue.class as string)
            : '';
    const overrideUi =
        (overrideValue.ui as Record<string, unknown> | undefined) || {};

    const mergedUi = { ...baseUi, ...overrideUi };
    const rest = Object.fromEntries(
        Object.entries(overrideValue).filter(
            ([key]) => key !== 'class' && key !== 'ui'
        )
    ) as Record<string, unknown>;

    const result: Record<string, unknown> = {
        ...rest,
        ui: mergedUi,
    };

    const mergedClass = [overrideClass].filter(Boolean).join(' ');
    if (mergedClass) {
        result.class = mergedClass;
    }

    return result;
});

const downloadButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'image-viewer',
        identifier: 'image-viewer.download',
        isNuxtUI: true,
    });
    return {
        size: 'md' as const,
        ...overrides.value,
    };
});

const copyButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'image-viewer',
        identifier: 'image-viewer.copy',
        isNuxtUI: true,
    });
    return {
        size: 'md' as const,
        ...overrides.value,
    };
});

const deleteButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'image-viewer',
        identifier: 'image-viewer.delete',
        isNuxtUI: true,
    });
    return {
        size: 'md' as const,
        class: 'text-(--md-error)',
        ...overrides.value,
    };
});

const restoreButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'image-viewer',
        identifier: 'image-viewer.restore',
        isNuxtUI: true,
    });
    return {
        size: 'md' as const,
        ...overrides.value,
    };
});

const permanentDeleteButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'image-viewer',
        identifier: 'image-viewer.permanent-delete',
        isNuxtUI: true,
    });
    return {
        variant: 'light' as const,
        size: 'sm' as const,
        class: 'text-(--md-error)',
        ...overrides.value,
    };
});

const closeButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'image-viewer',
        identifier: 'image-viewer.close',
        isNuxtUI: true,
    });
    return {
        size: 'md' as const,
        class: 'flex items-center justify-center',
        ...overrides.value,
    };
});

const backdropProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'div',
        context: 'image-viewer',
        identifier: 'image-viewer.backdrop',
        isNuxtUI: false,
    });
    return {
        class: 'bg-black/75 dark:bg-white/5 backdrop-blur-xs w-dvw h-dvh z-99 overflow-hidden absolute top-0 left-0',
        ...overrides.value,
    };
});

const topBarProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'div',
        context: 'image-viewer',
        identifier: 'image-viewer.top-bar',
        isNuxtUI: false,
    });
    return {
        class: 'fixed inset-x-0 top-0 z-1200 px-2 pt-2',
        ...overrides.value,
    };
});

const innerTopBarProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'div',
        context: 'image-viewer',
        identifier: 'image-viewer.inner-top-bar',
        isNuxtUI: false,
    });
    return {
        class: 'mx-auto flex max-w-[min(728px,90vw)] flex-wrap items-center justify-between gap-2 p-1',
        ...overrides.value,
    };
});

const imageContainerProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'div',
        context: 'image-viewer',
        identifier: 'image-viewer.image-container',
        isNuxtUI: false,
    });
    return {
        class: 'inset-0 grid h-full w-full place-items-center px-4 pb-4 pt-24 sm:pt-6',
        ...overrides.value,
    };
});

const imageProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'img',
        context: 'image-viewer',
        identifier: 'image-viewer.image',
        isNuxtUI: false,
    });
    return {
        class: 'max-w-[90dvw] sm:max-w-[min(96dvw,1400px)] h-[70dvh] object-contain',
        ...overrides.value,
    };
});

const buttonGroupWrapperProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'div',
        context: 'image-viewer',
        identifier: 'image-viewer.button-group-wrapper',
        isNuxtUI: false,
    });
    return {
        class: 'flex items-center',
        ...overrides.value,
    };
});

const loadingTextProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'div',
        context: 'image-viewer',
        identifier: 'image-viewer.loading-text',
        isNuxtUI: false,
    });
    return {
        class: 'text-white/80 text-sm',
        ...overrides.value,
    };
});

async function load() {
    if (!cache) return;
    const nextMeta = props.meta;
    if (currentHash.value && currentHash.value !== nextMeta?.hash) {
        cache.release(currentHash.value);
    }
    currentHash.value = nextMeta?.hash ?? null;
    state.url = undefined;
    if (!nextMeta) return;
    try {
        const url = await cache.ensure(nextMeta.hash, async () => {
            const blob = await getFileBlob(nextMeta.hash);
            if (!blob) throw new Error('blob missing');
            const url = URL.createObjectURL(blob);
            return { url, bytes: blob.size };
        });
        if (url) {
            state.url = url;
            cache.promote(nextMeta.hash, 2);
        }
    } catch (error) {
        reportError(error, {
            code: 'ERR_DB_READ_FAILED',
            message: `Couldn't load "${nextMeta.name || 'image'}" preview.`,
            tags: {
                domain: 'images',
                action: 'viewer-load',
                hash: nextMeta.hash,
            },
        });
    }
}

function downgrade() {
    if (!cache || !currentHash.value) return;
    cache.release(currentHash.value);
    currentHash.value = null;
}

watch(
    () => props.meta?.hash,
    () => load(),
    { immediate: true }
);

onBeforeUnmount(() => {
    downgrade();
    state.url = undefined;
});

function close() {
    downgrade();
    emit('update:modelValue', false);
}

onKeyStroke('Escape', (e) => {
    close();
});

watch(
    () => props.modelValue,
    async (v) => {
        if (v) {
            await nextTick().then(() => overlayEl.value?.focus());
        } else {
            downgrade();
            state.url = undefined;
        }
    }
);
// Keep template overlay at document level so backdrop covers entire screen
</script>

<template>
    <teleport to="body">
        <UModal
            v-if="modelValue"
            role="dialog"
            fullscreen
            v-bind="imageViewerModalProps"
        >
            <div v-bind="topBarProps">
                <div v-bind="innerTopBarProps">
                    <div v-bind="buttonGroupWrapperProps">
                        <UButtonGroup v-if="!props.trashMode">
                            <UButton
                                v-bind="downloadButtonProps"
                                :icon="iconDownload"
                                @click.stop.self="
                                    meta && emit('download', meta)
                                "
                            >
                                Download
                            </UButton>
                            <UButton
                                v-bind="copyButtonProps"
                                :icon="iconCopy"
                                @click.stop.self="meta && emit('copy', meta)"
                            >
                                Copy
                            </UButton>
                            <UButton
                                :icon="iconDelete"
                                v-bind="deleteButtonProps"
                                @click.stop.self="meta && emit('delete', meta)"
                            >
                                Delete
                            </UButton>
                        </UButtonGroup>
                        <UButtonGroup v-else>
                            <UButton
                                v-bind="restoreButtonProps"
                                :icon="iconRepeat"
                                @click.stop.self="meta && emit('restore', meta)"
                            >
                                Restore
                            </UButton>
                            <UButton
                                v-bind="permanentDeleteButtonProps"
                                :icon="iconTrash"
                                @click.stop.self="meta && emit('delete', meta)"
                            >
                                Delete permanently
                            </UButton>
                        </UButtonGroup>
                    </div>
                    <UButton
                        v-bind="closeButtonProps"
                        :icon="iconClose"
                        @click="close"
                    >
                    </UButton>
                </div>
            </div>
            <div v-bind="backdropProps" @click.self="close">
                <div
                    ref="overlayEl"
                    v-bind="imageContainerProps"
                    tabindex="-1"
                    @click.self="close"
                >
                    <img
                        v-if="state.url"
                        :src="state.url"
                        :alt="meta?.name"
                        v-bind="imageProps"
                    />
                    <div v-else v-bind="loadingTextProps">Loading…</div>
                </div>
            </div>
        </UModal>
    </teleport>
</template>

<style scoped></style>
