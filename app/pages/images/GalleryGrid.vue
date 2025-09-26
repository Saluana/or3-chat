<script setup lang="ts">
import { onMounted, onBeforeUnmount, reactive, watch, ref } from 'vue';
import type { FileMeta } from '../../db/schema';
import { getFileBlob } from '../../db/files';
import { reportError } from '../../utils/errors';

const props = defineProps<{
    items: FileMeta[];
    selectionMode?: boolean;
    selectedHashes?: Set<string>;
    isDeleting?: boolean;
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

function isSelected(hash: string): boolean {
    return props.selectedHashes?.has?.(hash) ?? false;
}

async function ensureUrl(meta: FileMeta) {
    if (state.urlByHash[meta.hash] || state.errorByHash[meta.hash]) return;
    try {
        const blob = await getFileBlob(meta.hash);
        if (!blob) throw new Error('blob missing');
        const url = URL.createObjectURL(blob);
        state.urlByHash[meta.hash] = url;
    } catch (error) {
        state.errorByHash[meta.hash] = true;
        reportError(error, {
            code: 'ERR_DB_READ_FAILED',
            message: `Couldn't load preview for "${meta.name || meta.hash}".`,
            tags: {
                domain: 'images',
                action: 'preview',
                hash: meta.hash,
            },
        });
    }
}

function observe() {
    if (io) io.disconnect();
    if (typeof IntersectionObserver === 'undefined') return;
    io = new IntersectionObserver(
        (entries) => {
            for (const e of entries) {
                if (e.isIntersecting) {
                    const hash = (e.target as HTMLElement).dataset['hash'];
                    const meta = props.items.find((m) => m.hash === hash);
                    if (meta) ensureUrl(meta);
                }
            }
        },
        { root: container.value, rootMargin: '200px 0px', threshold: 0.01 }
    );

    // Attach to tiles
    requestAnimationFrame(() => {
        container.value
            ?.querySelectorAll('[data-hash]')
            ?.forEach((el) => io?.observe(el));
    });
}

onMounted(() => {
    observe();
});

watch(
    () => props.items.map((i) => i.hash).join(','),
    () => {
        // re-observe when items change
        observe();
    }
);

onBeforeUnmount(() => {
    if (io) io.disconnect();
    // revoke URLs
    Object.values(state.urlByHash).forEach((u) => u && URL.revokeObjectURL(u));
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

// Single delete is now handled from viewer; emit hook kept for type safety if needed elsewhere.

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
                class="group relative w-full overflow-hidden rounded-md border-2 transition duration-150"
                :class="
                    props.selectionMode && isSelected(m.hash)
                        ? 'border-[var(--md-primary)] shadow-[2px_2px_0_var(--md-primary)]'
                        : 'border-[var(--md-outline-variant)] shadow-[2px_2px_0_var(--md-outline)]'
                "
            >
                <UButton
                    v-if="props.selectionMode"
                    type="button"
                    size="sm"
                    square
                    class="retro-btn absolute! z-[11] top-2 left-2 flex items-center justify-center"
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
                        :name="
                            isSelected(m.hash)
                                ? 'pixelarticons:check'
                                : 'pixelarticons:plus'
                        "
                        class="h-5 w-5"
                    />
                </UButton>
                <button
                    v-if="state.urlByHash[m.hash] && !state.errorByHash[m.hash]"
                    type="button"
                    class="block w-full cursor-pointer focus-visible:outline focus-visible:outline-offset-2 focus-visible:outline-[var(--md-primary)]"
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
                    class="flex min-h-[160px] w-full items-center justify-center bg-[var(--md-surface-container)] text-xs opacity-80 focus-visible:outline focus-visible:outline-offset-2 focus-visible:outline-[var(--md-primary)]"
                    :aria-label="`View ${m.name}`"
                    @click="view(m)"
                >
                    <span>Preview unavailable</span>
                </button>

                <div
                    class="pointer-events-none absolute inset-0 bg-black/55 opacity-0 transition-opacity duration-200 group-hover:opacity-60 group-focus-within:opacity-60"
                ></div>
                <div
                    class="pointer-events-none absolute inset-0 flex items-end justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100"
                >
                    <div class="pointer-events-auto mb-3 flex gap-1.5">
                        <UButton
                            size="sm"
                            variant="light"
                            square
                            class="flex item-center justify-center"
                            :icon="'pixelarticons:download'"
                            :disabled="props.isDeleting"
                            aria-label="Download image"
                            @click.stop="download(m)"
                        />
                        <UButton
                            size="sm"
                            square
                            variant="light"
                            class="flex item-center justify-center"
                            :icon="'pixelarticons:copy'"
                            :disabled="props.isDeleting"
                            aria-label="Copy image"
                            @click.stop="copy(m)"
                        />
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped></style>
