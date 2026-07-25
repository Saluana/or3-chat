<template>
    <span
        ref="rootRef"
        class="or3-palette-option-icon relative flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-[var(--md-border-radius)] border border-[color:var(--md-border-color)] bg-[color:var(--md-surface-variant)]/40 text-[color:var(--md-on-surface-variant)]"
    >
        <img
            v-if="url"
            :src="url"
            :alt="alt"
            class="h-full w-full object-cover"
            draggable="false"
        />
        <UIcon v-else :name="fallbackIcon" class="h-3.5 w-3.5" />
    </span>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useThumbnailUrlCache } from '~/composables/core/useThumbnailUrlCache';
import { getFileBlob } from '~/db/files';

const props = defineProps<{
    hash: string;
    alt: string;
    fallbackIcon: string;
    sizeBytes?: number | null;
}>();

/** Above this the decode/memory cost outweighs a 28px thumbnail. */
const MAX_THUMB_BYTES = 6 * 1024 * 1024;

const cache = useThumbnailUrlCache({ graceMs: 15_000 });
const rootRef = ref<HTMLElement | null>(null);
const url = ref<string | undefined>();

let observer: IntersectionObserver | null = null;
let retainedHash: string | null = null;

function tooLarge(): boolean {
    const bytes = props.sizeBytes;
    return typeof bytes === 'number' && bytes > MAX_THUMB_BYTES;
}

function releaseCurrent(): void {
    if (!retainedHash) return;
    cache.release(retainedHash);
    retainedHash = null;
    url.value = undefined;
}

async function load(hash: string): Promise<void> {
    if (retainedHash === hash) return;
    releaseCurrent();
    if (!hash || tooLarge()) return;
    retainedHash = hash;
    cache.retain(hash);
    const state = await cache.ensure(hash, () => getFileBlob(hash));
    // The row may have been recycled to another image while the blob loaded.
    if (retainedHash !== hash) return;
    url.value = state?.status === 'ready' ? state.url : undefined;
}

onMounted(() => {
    const el = rootRef.value;
    if (!el) return;
    // Thumbnails are only worth loading for rows the user can actually see.
    if (typeof IntersectionObserver === 'undefined') {
        void load(props.hash);
        return;
    }
    observer = new IntersectionObserver(
        (entries) => {
            for (const entry of entries) {
                if (entry.isIntersecting) void load(props.hash);
                else releaseCurrent();
            }
        },
        { rootMargin: '120px 0px', threshold: 0.01 }
    );
    observer.observe(el);
});

watch(
    () => props.hash,
    (hash) => {
        if (retainedHash) void load(hash);
    }
);

onBeforeUnmount(() => {
    observer?.disconnect();
    observer = null;
    releaseCurrent();
});
</script>
