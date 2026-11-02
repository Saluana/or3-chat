<script setup lang="ts">
import { onBeforeUnmount, reactive, watch, computed, ref, type Ref } from 'vue';
import type { FileMeta } from '~/db/schema';
import { getFileBlob } from '~/db/files';
import { getWorkspaceGeneration, subscribeActiveWorkspaceDb } from '~/db/client';
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
    /** Hide Delete where the image is owned by something else, such as a chat message. */
    hideDelete?: boolean;
}>();
const emit = defineEmits<{
    (e: 'update:modelValue', v: boolean): void;
    (e: 'download', meta: FileMeta): void;
    (e: 'copy', meta: FileMeta): void;
    (e: 'rename', meta: FileMeta): void;
    (e: 'delete', meta: FileMeta): void;
    (e: 'restore', meta: FileMeta): void;
}>();

const state = reactive<{ url?: string; failed: boolean; loaded: boolean; naturalSize?: [number, number] }>({
    url: undefined,
    failed: false,
    loaded: false,
});
const dialogContent = useDialogFocus(undefined, () => 'fullscreen');
const cache = useSharedPreviewCache();
const currentHash = ref<string | null>(null);
let loadToken = 0;
const stopWorkspace = subscribeActiveWorkspaceDb(() => {
    loadToken += 1;
    downgrade();
    state.url = undefined;
});
onBeforeUnmount(() => {
    loadToken += 1;
    stopWorkspace();
});

const imageViewerModalOverrides = useThemeOverrides({
    component: 'modal',
    context: 'modal',
    identifier: 'modal.image-viewer',
    isNuxtUI: true,
});

// Full-window lightbox: the scrim lives on the content so it covers the
// viewport exactly (a vh cap would shrink under the theme's body zoom).
const imageViewerModalProps = computed(() => {
    return buildThemeOverrideProps(imageViewerModalOverrides.value, {
        baseUi: {
            overlay: 'bg-transparent',
            content:
                'image-preview-modal fixed inset-0 flex flex-col overflow-hidden p-0! divide-y-0! max-w-none! max-h-none! rounded-none! border-0! ring-0! shadow-none! bg-(--md-scrim)/85! backdrop-blur-md data-[state=open]:animate-[fade-in_200ms_var(--ease-out)] data-[state=closed]:animate-[fade-out_150ms_var(--ease-out)]',
        },
    });
});

const surfacePill =
    'pointer-events-auto rounded-full bg-(--md-surface)/90 text-(--md-on-surface) shadow-lg ring-1 ring-(--md-outline-variant)/40 backdrop-blur-md';

function themed(identifier: string, component: string, baseClass: string) {
    const overrides = useThemeOverrides({
        component,
        context: 'image-viewer',
        identifier,
        isNuxtUI: component === 'button',
    });
    return computed(() => buildThemeOverrideProps(overrides.value, { baseClass }));
}

function toolbarButton(identifier: string, label: string, icon: Readonly<Ref<string>>, tone = '') {
    const themedProps = themed(identifier, 'button', `rounded-full flex items-center justify-center ${tone}`);
    return computed(() => ({
        variant: 'ghost' as const,
        color: 'neutral' as const,
        size: 'md' as const,
        square: true as const,
        icon: icon.value,
        'aria-label': label,
        ...themedProps.value,
    }));
}

const errorTone = 'text-(--md-error)! hover:bg-(--md-error)/10!';
const downloadButtonProps = toolbarButton('image-viewer.download', 'Download', iconDownload);
const copyButtonProps = toolbarButton('image-viewer.copy', 'Copy', iconCopy);
const deleteButtonProps = toolbarButton('image-viewer.delete', 'Delete', iconDelete, errorTone);
const restoreButtonProps = toolbarButton('image-viewer.restore', 'Restore', iconRepeat);
const permanentDeleteButtonProps = toolbarButton('image-viewer.permanent-delete', 'Delete permanently', iconTrash, errorTone);
const closeButtonProps = toolbarButton('image-viewer.close', 'Close image preview', iconClose);

const backdropProps = themed('image-viewer.backdrop', 'div', 'relative flex h-full min-h-0 w-full flex-col');
const topBarProps = themed(
    'image-viewer.top-bar',
    'div',
    'pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-3 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-5 sm:pt-5'
);
const innerTopBarProps = themed('image-viewer.inner-top-bar', 'div', `${surfacePill} min-w-0 max-w-[min(28rem,55%)] px-4 py-2`);
const fieldGroupWrapperProps = themed('image-viewer.button-group-wrapper', 'div', `${surfacePill} flex shrink-0 items-center gap-0.5 p-1`);
const imageContainerProps = themed(
    'image-viewer.image-container',
    'div',
    'flex min-h-0 flex-1 items-center justify-center px-3 pt-20 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-16 sm:pt-24 sm:pb-12'
);
const imageProps = themed(
    'image-viewer.image',
    'img',
    'max-w-full max-h-full min-h-0 object-contain select-none rounded-(--md-border-radius) shadow-2xl transition-opacity duration-200'
);
const loadingTextProps = themed('image-viewer.loading-text', 'div', `${surfacePill} px-4 py-2 text-sm`);

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const details = computed(() => {
    const meta = props.meta;
    if (!meta) return '';
    const size = meta.width && meta.height ? [meta.width, meta.height] : state.naturalSize;
    return [
        size ? `${size[0]} × ${size[1]}` : '',
        meta.mime_type.split('/')[1]?.toUpperCase() ?? '',
        meta.size_bytes > 0 ? formatBytes(meta.size_bytes) : '',
    ]
        .filter(Boolean)
        .join(' · ');
});

function onImageLoad(event: Event) {
    const img = event.target as HTMLImageElement;
    state.naturalSize = [img.naturalWidth, img.naturalHeight];
    state.loaded = true;
}

async function load() {
    const token = ++loadToken;
    const generation = getWorkspaceGeneration();
    const isCurrent = () => token === loadToken && generation === getWorkspaceGeneration();
    if (!cache) return;
    const nextMeta = props.meta;
    if (currentHash.value && currentHash.value !== nextMeta?.hash) {
        cache.release(currentHash.value);
    }
    currentHash.value = nextMeta?.hash ?? null;
    state.url = undefined;
    state.failed = false;
    state.loaded = false;
    state.naturalSize = undefined;
    if (!nextMeta) return;
    try {
        const url = await cache.ensure(nextMeta.hash, async () => {
            const blob = await getFileBlob(nextMeta.hash);
            if (!blob) throw new Error('blob missing');
            const url = URL.createObjectURL(blob);
            return { url, bytes: blob.size };
        });
        if (isCurrent() && url && props.modelValue && props.meta?.hash === nextMeta.hash) {
            state.url = url;
            cache.promote(nextMeta.hash, 2);
        }
    } catch (error) {
        if (!isCurrent()) return;
        state.failed = true;
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
            <div v-bind="backdropProps" @click.self="close">
                <div v-bind="topBarProps">
                    <div v-bind="innerTopBarProps">
                        <p class="truncate text-sm font-medium" :title="meta?.name">
                            {{ meta?.name || 'Image' }}
                        </p>
                        <p
                            v-if="details"
                            class="truncate text-xs text-(--md-on-surface-variant)"
                        >
                            {{ details }}
                        </p>
                    </div>
                    <div v-bind="fieldGroupWrapperProps">
                        <template v-if="!props.trashMode">
                            <UTooltip text="Download">
                                <UButton
                                    v-bind="downloadButtonProps"
                                    @click.stop="meta && emit('download', meta)"
                                />
                            </UTooltip>
                            <UTooltip text="Copy">
                                <UButton
                                    v-bind="copyButtonProps"
                                    @click.stop="meta && emit('copy', meta)"
                                />
                            </UTooltip>
                            <UTooltip v-if="!props.hideDelete" text="Delete">
                                <UButton
                                    v-bind="deleteButtonProps"
                                    @click.stop="meta && emit('delete', meta)"
                                />
                            </UTooltip>
                        </template>
                        <template v-else>
                            <UTooltip text="Restore">
                                <UButton
                                    v-bind="restoreButtonProps"
                                    @click.stop="meta && emit('restore', meta)"
                                />
                            </UTooltip>
                            <UTooltip text="Delete permanently">
                                <UButton
                                    v-bind="permanentDeleteButtonProps"
                                    @click.stop="meta && emit('delete', meta)"
                                />
                            </UTooltip>
                        </template>
                        <span
                            class="mx-1 h-5 w-px bg-(--md-outline-variant)"
                            aria-hidden="true"
                        />
                        <UTooltip text="Close" :kbds="['esc']">
                            <UButton v-bind="closeButtonProps" @click="close" />
                        </UTooltip>
                    </div>
                </div>
                <div v-bind="imageContainerProps" @click.self="close">
                    <img
                        v-if="state.url"
                        :src="state.url"
                        :alt="meta?.name"
                        v-bind="imageProps"
                        :class="state.loaded ? 'opacity-100' : 'opacity-0'"
                        @load="onImageLoad"
                    />
                    <div v-else v-bind="loadingTextProps">
                        {{ state.failed ? 'Preview unavailable' : 'Loading…' }}
                    </div>
                </div>
            </div>
        </template>
    </UModal>
</template>
