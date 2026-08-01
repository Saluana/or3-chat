<script setup lang="ts">
import {
    computed,
    onMounted,
    onBeforeUnmount,
    reactive,
    watch,
    ref,
} from 'vue';
import type { FileMeta } from '../../db/schema';
import { getFileBlob } from '../../db/files';
import { reportError } from '../../utils/errors';
import { useSharedPreviewCache } from '~/composables/core/usePreviewCache';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { useIcon } from '#imports';
import { isGeneratedImage } from './image-library';

const iconDownload = useIcon('image.download');
const iconCopy = useIcon('image.copy');
const iconCheck = useIcon('ui.check');
const iconPlus = useIcon('ui.plus');

const props = defineProps<{
    items: FileMeta[];
    selectionMode?: boolean;
    selectedHashes?: Set<string>;
    isDeleting?: boolean;
    trashMode?: boolean;
}>();

const emit = defineEmits<{
    (e: 'view', meta: FileMeta): void;
    (e: 'download', meta: FileMeta): void;
    (e: 'copy', meta: FileMeta): void;
    (e: 'rename', meta: FileMeta): void;
    (e: 'toggle-select', hash: string): void;
    (e: 'delete', meta: FileMeta): void;
}>();

type State = {
    urlByHash: Record<string, string | undefined>;
    errorByHash: Record<string, boolean | undefined>;
};

const state = reactive<State>({ urlByHash: {}, errorByHash: {} });
const container = ref<HTMLElement | null>(null);
let io: IntersectionObserver | null = null;
const cache = useSharedPreviewCache();
const visibleHashes = new Set<string>();
let previousHashes = new Set<string>();
let idleHandle: number | null = null;
let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
let visibilityHandler: (() => void) | null = null;

function isSelected(hash: string): boolean {
    return props.selectedHashes?.has?.(hash) ?? false;
}

function clearUrlState(hash: string) {
    delete state.urlByHash[hash];
    delete state.errorByHash[hash];
}

function dropHash(hash: string) {
    clearUrlState(hash);
    visibleHashes.delete(hash);
}

function pruneStaleState() {
    for (const hash of Object.keys(state.urlByHash)) {
        if (!cache?.peek(hash)) {
            clearUrlState(hash);
        }
    }
}

async function ensureUrl(meta: FileMeta) {
    if (!cache) return;
    if (state.errorByHash[meta.hash]) return;
    try {
        const url = await cache.ensure(
            meta.hash,
            async () => {
                const blob = await getFileBlob(meta.hash);
                if (!blob) throw new Error('blob missing');
                const url = URL.createObjectURL(blob);
                return { url, bytes: blob.size };
            },
            1
        );
        if (url) {
            state.urlByHash[meta.hash] = url;
            state.errorByHash[meta.hash] = undefined;
        }
    } catch (error) {
        state.errorByHash[meta.hash] = true;
        reportError(error, {
            code: 'ERR_DB_READ_FAILED',
            message: `Couldn't load preview for "${meta.name || meta.hash}".`,
            silent: true,
            tags: {
                domain: 'images',
                action: 'preview',
                hash: meta.hash,
            },
        });
    } finally {
        pruneStaleState();
    }
}

function releaseHash(hash: string) {
    if (!cache) return;
    cache.release(hash);
}

function reloadVisiblePreviews() {
    for (const hash of visibleHashes) {
        const meta = props.items.find((m) => m.hash === hash);
        if (meta) void ensureUrl(meta);
    }
}

function handleVisibilityChange() {
    if (!cache || typeof document === 'undefined') return;
    if (document.visibilityState === 'hidden') {
        // Free blob URLs while backgrounded, but keep visibleHashes so we can
        // reload the on-screen tiles when the tab becomes visible again.
        // IntersectionObserver often will not re-fire for already-visible tiles.
        const removed = cache.flushAll();
        removed.forEach((hash) => clearUrlState(hash));
        return;
    }
    reloadVisiblePreviews();
    // Rebind in case the browser cleared intersection state while hidden.
    scheduleObserve();
}

function ensureObserver(): IntersectionObserver | null {
    if (typeof IntersectionObserver === 'undefined') return null;
    if (!io) {
        io = new IntersectionObserver(
            (entries) => {
                for (const e of entries) {
                    const hash = (e.target as HTMLElement).dataset['hash'];
                    if (!hash) continue;
                    if (e.isIntersecting) {
                        visibleHashes.add(hash);
                        const meta = props.items.find((m) => m.hash === hash);
                        if (meta) {
                            ensureUrl(meta);
                            cache?.promote(hash, 1);
                        }
                    } else {
                        visibleHashes.delete(hash);
                        releaseHash(hash);
                    }
                }
                const removed = cache?.evictIfNeeded('intersection') ?? [];
                removed.forEach((hash) => dropHash(hash));
                pruneStaleState();
            },
            { root: container.value, rootMargin: '200px 0px', threshold: 0.01 }
        );
    }
    return io;
}

function bindTiles() {
    const observer = ensureObserver();
    if (!observer) return;
    const root = container.value;
    if (!root) return;

    observer.disconnect();

    const run = () => {
        root?.querySelectorAll('[data-hash]')?.forEach((el) =>
            observer.observe(el)
        );
    };

    if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(run);
    } else {
        setTimeout(run, 16);
    }
}

function cancelScheduledObserve() {
    const cancelIdle =
        typeof window !== 'undefined' &&
        typeof window.cancelIdleCallback === 'function'
            ? window.cancelIdleCallback.bind(window)
            : null;
    if (idleHandle !== null && cancelIdle) {
        cancelIdle(idleHandle);
    }
    if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
    }
    idleHandle = null;
    timeoutHandle = null;
}

function scheduleObserve() {
    cancelScheduledObserve();

    const idleScheduler =
        typeof window !== 'undefined' &&
        typeof window.requestIdleCallback === 'function'
            ? window.requestIdleCallback.bind(window)
            : null;

    if (idleScheduler) {
        idleHandle = idleScheduler(
            () => {
                idleHandle = null;
                bindTiles();
            },
            { timeout: 50 }
        );
        return;
    }

    timeoutHandle = setTimeout(() => {
        timeoutHandle = null;
        bindTiles();
    }, 0);
}

onMounted(() => {
    previousHashes = new Set(props.items.map((item) => item.hash));
    scheduleObserve();
    if (typeof document !== 'undefined') {
        visibilityHandler = () => handleVisibilityChange();
        document.addEventListener('visibilitychange', visibilityHandler);
    }
});

watch(
    () => props.items.map((i) => i.hash),
    (hashes) => {
        const next = new Set(hashes);
        for (const hash of previousHashes) {
            if (!next.has(hash)) {
                cache?.drop(hash);
                dropHash(hash);
            }
        }
        previousHashes = next;
        const removed = cache?.evictIfNeeded('items-change') ?? [];
        removed.forEach((hash) => dropHash(hash));
        pruneStaleState();
        scheduleObserve();
    }
);

onBeforeUnmount(() => {
    if (io) io.disconnect();
    cancelScheduledObserve();
    if (typeof document !== 'undefined' && visibilityHandler) {
        document.removeEventListener('visibilitychange', visibilityHandler);
    }
    const removed = cache?.flushAll() ?? [];
    removed.forEach((hash) => dropHash(hash));
    pruneStaleState();
});

function view(meta: FileMeta) {
    emit('view', meta);
}

function download(meta: FileMeta) {
    emit('download', meta);
}

function copy(meta: FileMeta) {
    emit('copy', meta);
}

function toggleSelect(hash: string) {
    if (!hash || props.isDeleting) return;
    emit('toggle-select', hash);
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(timestamp: number): string {
    return new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        year:
            new Date(timestamp * 1000).getFullYear() ===
            new Date().getFullYear()
                ? undefined
                : 'numeric',
    }).format(new Date(timestamp * 1000));
}

const downloadButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'images.gallery',
        identifier: 'images.gallery.download',
        isNuxtUI: true,
    });
    return {
        size: 'sm' as const,
        variant: 'solid' as const,
        color: 'neutral' as const,
        square: true as const,
        class: 'flex items-center justify-center',
        icon: iconDownload.value,
        ...overrides.value,
    };
});

const copyButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'images.gallery',
        identifier: 'images.gallery.copy',
        isNuxtUI: true,
    });
    return {
        size: 'sm' as const,
        variant: 'solid' as const,
        color: 'neutral' as const,
        square: true as const,
        class: 'flex items-center justify-center',
        icon: iconCopy.value,
        ...overrides.value,
    };
});

defineExpose({ ensureUrl });
</script>

<template>
    <div
        ref="container"
        class="columns-1 sm:columns-2 lg:columns-3 gap-4 max-w-[1400px] mx-auto"
    >
        <div
            v-for="m in items"
            :key="m.hash"
            :data-hash="m.hash"
            class="mb-4 break-inside-avoid"
        >
            <div
                class="w-full overflow-hidden rounded-[var(--md-border-radius)] border-(length:--md-border-width) bg-[var(--md-surface)] transition duration-150"
                :class="
                    props.selectionMode && isSelected(m.hash)
                        ? 'border-(--md-primary)'
                        : 'border-(--md-border-color)'
                "
            >
                <div
                    class="group relative overflow-hidden bg-[var(--md-surface-container)]"
                >
                    <UButton
                        v-if="props.selectionMode"
                        type="button"
                        size="sm"
                        color="primary"
                        square
                        class="absolute! z-11 top-2 left-2 flex items-center justify-center backdrop-blur"
                        :aria-pressed="isSelected(m.hash)"
                        role="checkbox"
                        :aria-checked="isSelected(m.hash)"
                        :title="
                            isSelected(m.hash)
                                ? `Deselect ${m.name}`
                                : `Select ${m.name}`
                        "
                        @click.stop="toggleSelect(m.hash)"
                    >
                        <UIcon
                            :name="isSelected(m.hash) ? iconCheck : iconPlus"
                            class="h-5 w-5"
                        />
                    </UButton>
                    <button
                        v-if="
                            state.urlByHash[m.hash] &&
                            !state.errorByHash[m.hash]
                        "
                        type="button"
                        class="block w-full cursor-pointer focus-visible:outline focus-visible:outline-offset-2 focus-visible:outline-(--md-primary)"
                        :aria-label="`View ${m.name}`"
                        @click="view(m)"
                    >
                        <img
                            class="w-full h-auto transition-transform duration-200 group-hover:scale-[1.02] group-focus-within:scale-[1.02]"
                            :src="state.urlByHash[m.hash]"
                            :alt="m.name"
                            loading="lazy"
                        />
                    </button>
                    <button
                        v-else
                        type="button"
                        class="flex min-h-40 w-full items-center justify-center bg-(--md-surface-container) text-xs opacity-80 focus-visible:outline focus-visible:outline-offset-2 focus-visible:outline-(--md-primary)"
                        :aria-label="`View ${m.name}`"
                        @click="view(m)"
                    >
                        <span v-if="state.errorByHash[m.hash]"
                            >Preview unavailable</span
                        >
                        <span v-else>Loading preview…</span>
                    </button>

                    <div
                        class="pointer-events-none absolute inset-0 bg-black/55 opacity-0 transition-opacity duration-200 group-hover:opacity-60 group-focus-within:opacity-60"
                    ></div>
                    <div
                        v-if="!props.trashMode"
                        class="pointer-events-none absolute inset-0 flex items-end justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100"
                    >
                        <div class="pointer-events-auto mb-3 flex gap-1.5">
                            <UButton
                                v-bind="downloadButtonProps"
                                :disabled="props.isDeleting"
                                aria-label="Download image"
                                @click.stop="download(m)"
                            />
                            <UButton
                                v-bind="copyButtonProps"
                                :disabled="props.isDeleting"
                                aria-label="Copy image"
                                @click.stop="copy(m)"
                            />
                        </div>
                    </div>
                </div>
                <div class="image-card-meta">
                    <div class="flex min-w-0 items-center gap-2">
                        <span class="image-card-type">{{
                            m.mime_type.split('/')[1]?.toUpperCase() || 'IMAGE'
                        }}</span>
                        <strong
                            class="min-w-0 flex-1 truncate"
                            :title="m.name"
                            >{{ m.name }}</strong
                        >
                    </div>
                    <div class="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                        <span>{{ formatBytes(m.size_bytes) }}</span>
                        <span aria-hidden="true">•</span>
                        <span>{{
                            isGeneratedImage(m) ? 'Generated' : 'Uploaded'
                        }}</span>
                        <span aria-hidden="true">•</span>
                        <span>{{ formatDate(m.created_at) }}</span>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.image-card-meta {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.65rem 0.7rem 0.7rem;
    color: var(--md-on-surface);
    font-size: 0.7rem;
}
.image-card-meta > :last-child {
    color: var(--md-on-surface-variant, var(--md-on-surface));
    font-size: 0.62rem;
    opacity: 0.68;
}
.image-card-type {
    padding: 0.1rem 0.3rem;
    color: var(--md-on-surface-variant, var(--md-on-surface));
    background: var(--md-surface-container-high);
    border-radius: var(--md-border-radius);
    font-size: 0.56rem;
    line-height: 1.3;
}
</style>
