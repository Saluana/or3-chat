<script setup lang="ts">
import { onBeforeUnmount, reactive, watch, ref, nextTick, computed } from 'vue';
import type { FileMeta } from '~/db/schema';
import { getFileBlob } from '~/db/files';
import { onKeyStroke } from '@vueuse/core';
import { reportError } from '~/utils/errors';
import { useSharedPreviewCache } from '~/composables/core/usePreviewCache';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { useIcon } from '#imports';

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
            <div class="fixed inset-x-0 top-0 z-1200 px-2 pt-2">
                <div
                    @click.stop.prevent
                    class="mx-auto flex max-w-[min(540px,90vw)] flex-wrap items-center justify-between gap-2 rounded-md border-(length:--md-border-width) border-(--md-outline-variant) bg-(--md-surface-container-highest)/95 p-1 backdrop-blur"
                >
                    <div class="flex items-center">
                        <UButtonGroup v-if="!props.trashMode">
                            <UButton
                                variant="light"
                                size="sm"
                                :icon="useIcon('image.download')"
                                @click.stop.self="
                                    meta && emit('download', meta)
                                "
                            >
                                Download
                            </UButton>
                            <UButton
                                variant="light"
                                :icon="useIcon('image.copy')"
                                size="sm"
                                @click.stop.self="meta && emit('copy', meta)"
                            >
                                Copy
                            </UButton>
                            <UButton
                                variant="light"
                                class="text-(--md-error)"
                                size="sm"
                                :icon="useIcon('image.delete')"
                                @click.stop.self="meta && emit('delete', meta)"
                            >
                                Delete
                            </UButton>
                        </UButtonGroup>
                        <UButtonGroup v-else>
                            <UButton
                                variant="light"
                                size="sm"
                                :icon="useIcon('image.repeat')"
                                @click.stop.self="meta && emit('restore', meta)"
                            >
                                Restore
                            </UButton>
                            <UButton
                                variant="light"
                                class="text-(--md-error)"
                                size="sm"
                                :icon="useIcon('ui.trash')"
                                @click.stop.self="meta && emit('delete', meta)"
                            >
                                Delete permanently
                            </UButton>
                        </UButtonGroup>
                    </div>
                    <UButton
                        :icon="useIcon('ui.close')"
                        variant="light"
                        size="sm"
                        @click="close"
                    >
                    </UButton>
                </div>
            </div>
            <div
                class="bg-black/75 dark:bg-white/5 backdrop-blur-xs w-dvw h-dvh z-99 overflow-hidden absolute top-0 left-0"
                @click.self="close"
            >
                <div
                    ref="overlayEl"
                    class="inset-0 grid h-full w-full place-items-center px-4 pb-4 pt-24 sm:pt-6"
                    tabindex="-1"
                    @click.self="close"
                >
                    <img
                        v-if="state.url"
                        :src="state.url"
                        :alt="meta?.name"
                        class="max-w-[90dvw] sm:max-w-[min(96dvw,1400px)] h-[70dvh] object-contain"
                    />
                    <div v-else class="text-white/80 text-sm">Loading…</div>
                </div>
            </div>
        </UModal>
    </teleport>
</template>

<style scoped></style>
