<script setup lang="ts">
import { onBeforeUnmount, reactive, watch, computed, ref } from 'vue';
import type { FileMeta } from '~/db/schema';
import { getFileBlob } from '~/db/files';
import { useDialogFocus } from '~/composables/ui/useDialogFocus';
import { reportError } from '~/utils/errors';
import { useSharedPreviewCache } from '~/composables/core/usePreviewCache';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { buildThemeOverrideProps } from '~/composables/ui/themeOverrideProps';
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
const dialogContent = useDialogFocus(undefined, () => 'fullscreen');
const cache = useSharedPreviewCache();
const currentHash = ref<string | null>(null);

const imageViewerModalOverrides = useThemeOverrides({
    component: 'modal',
    context: 'modal',
    identifier: 'modal.image-viewer',
    isNuxtUI: true,
});

const imageViewerModalProps = computed(() => {
    return buildThemeOverrideProps(imageViewerModalOverrides.value, {
        baseUi: {
            content: 'image-preview-modal flex flex-col min-h-0 max-h-[100dvh]! overflow-hidden! p-0! divide-y-0!',
        },
    });
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
        class: 'flex items-center justify-center shrink-0',
        'aria-label': 'Close image preview',
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
        class: 'bg-black/75 dark:bg-white/5 flex-1 min-h-0 overflow-hidden relative',
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
        class: 'relative shrink-0 px-2 pt-[max(0.5rem,env(safe-area-inset-top))] bg-[var(--md-surface)]',
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
        class: 'mx-auto flex max-w-[728px] flex-wrap items-center justify-between gap-2 p-1',
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
        class: 'grid h-full min-h-0 w-full place-items-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))]',
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
        class: 'max-w-full max-h-full min-h-0 object-contain',
        ...overrides.value,
    };
});

const fieldGroupWrapperProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'div',
        context: 'image-viewer',
        identifier: 'image-viewer.button-group-wrapper',
        isNuxtUI: false,
    });
    return {
        class: 'flex min-w-0 items-center [&_[data-slot=root]]:flex-wrap',
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
        if (url && props.modelValue && props.meta?.hash === nextMeta.hash) {
            state.url = url;
            cache.promote(nextMeta.hash, 2);
        }
    } catch (error) {
        reportError(error, {
            code: 'ERR_DB_READ_FAILED',
            message: `Couldn't load "${nextMeta.name || 'image'}" preview.`,
            silent: true,
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

onBeforeUnmount(() => {
    downgrade();
    state.url = undefined;
});

function close() {
    downgrade();
    emit('update:modelValue', false);
}

watch(
    [() => props.meta?.hash, () => props.modelValue],
    ([, open]) => {
        if (open) void load();
        else { downgrade(); state.url = undefined; }
    },
    { immediate: true }
);
// Keep template overlay at document level so backdrop covers entire screen
</script>

<template>
        <UModal
            v-bind="imageViewerModalProps"
            :open="modelValue"
            title="Image preview"
            :description="meta?.name || 'View image'"
            :content="dialogContent"
            fullscreen
            @update:open="!$event && close()"
        >
        <template #content>
            <div v-bind="topBarProps">
                <div v-bind="innerTopBarProps">
                    <div v-bind="fieldGroupWrapperProps">
                        <UFieldGroup v-if="!props.trashMode" class="flex-wrap min-w-0 max-w-full">
                            <UButton
                                v-bind="downloadButtonProps"
                                :icon="iconDownload"
                                @click.stop="
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
                        </UFieldGroup>
                        <UFieldGroup v-else class="flex-wrap min-w-0 max-w-full">
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
                        </UFieldGroup>
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
                    v-bind="imageContainerProps"
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
        </template>
        </UModal>
</template>

<style>
@layer utilities {
@media (max-width: 767px), (pointer: coarse) {
    .image-preview-modal[role=dialog] button {
        min-height: 44px !important;
        min-width: 44px !important;
    }
}
}
</style>
