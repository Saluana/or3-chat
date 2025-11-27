<template>
    <div
        id="message-attachments-gallery-root"
        v-if="hashes.length"
        class="mt-3"
    >
        <div
            class="message-attachments-gallery-grid grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2"
        >
            <div
                v-for="(h, index) in hashes"
                :key="h"
                :id="`attachment-item-${index}`"
                :class="[
                    'message-attachment-item relative aspect-square overflow-hidden flex items-center justify-center bg-[var(--md-surface-container-lowest)]',
                    attachmentItemProps?.class || '',
                ]"
                :data-theme-target="attachmentItemProps?.['data-theme-target']"
                :data-theme-matches="
                    attachmentItemProps?.['data-theme-matches']
                "
            >
                <!-- PDF Placeholder if mime/kind indicates pdf -->
                <template v-if="meta[h]?.kind === 'pdf'">
                    <div
                        class="message-attachment-pdf-placeholder w-full h-full flex flex-col items-center justify-center gap-1 bg-[var(--md-surface-container-low)] text-center p-1"
                    >
                        <span
                            class="message-attachment-pdf-label text-[10px] font-semibold tracking-wide uppercase bg-black text-white px-1 py-0.5 rounded"
                            >PDF</span
                        >
                        <span
                            class="message-attachment-pdf-name text-[9px] leading-snug line-clamp-3 break-words px-1"
                            :title="fileNames[h] || h.slice(0, 8)"
                            >{{ fileNames[h] || 'document.pdf' }}</span
                        >
                    </div>
                </template>
                <template v-else-if="thumbs[h]?.status === 'ready'">
                    <img
                        :id="`attachment-image-${index}`"
                        :src="thumbs[h].url"
                        :alt="'file ' + h.slice(0, 8)"
                        class="message-attachment-image object-cover w-full h-full"
                        draggable="false"
                    />
                </template>
                <template v-else-if="thumbs[h]?.status === 'error'">
                    <div
                        :id="`attachment-error-${index}`"
                        class="message-attachment-error text-[10px] text-center px-1 text-error"
                    >
                        failed
                    </div>
                </template>
                <template v-else>
                    <div
                        :id="`attachment-loading-${index}`"
                        class="message-attachment-loading animate-pulse text-[10px] opacity-70"
                    >
                        loading
                    </div>
                </template>
            </div>
        </div>
        <button
            id="btn-collapse-attachments"
            v-bind="collapseButtonProps"
            :class="[
                'col-span-full mt-1 justify-self-start text-xs underline text-[var(--md-primary)]',
                collapseButtonProps?.class ?? '',
            ]"
            type="button"
            @click="$emit('collapse')"
            aria-label="Hide attachments"
        >
            Hide attachments
        </button>
    </div>
</template>

<script setup lang="ts">
import { reactive, watch, onBeforeUnmount, onMounted } from 'vue';
import { getFileMeta } from '~/db/files';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import type { FileMeta } from '../../../types/chat-internal';
import {
    type ThumbState,
    retainThumb,
    releaseThumb,
    ensureThumb as ensureThumbFromCache,
    queuePrefetch,
    getThumbCache,
    peekPdfMeta,
} from '~/composables/core/useThumbnails';

const props = defineProps<{ hashes: string[] }>();
defineEmits<{ (e: 'collapse'): void }>();

const collapseButtonProps = useThemeOverrides({
    component: 'button',
    context: 'message',
    identifier: 'message.collapse-attachments',
    isNuxtUI: false,
});

const attachmentItemProps = useThemeOverrides({
    component: 'div',
    context: 'message',
    identifier: 'message.attachment-item',
    isNuxtUI: false,
});

const thumbs = reactive<Record<string, ThumbState>>({});
const meta = reactive<
    Record<string, FileMeta | { name?: string; kind: string }>
>({});
const fileNames = reactive<Record<string, string>>({});

async function ensure(h: string) {
    // Check PDF meta cache first
    const cachedPdf = peekPdfMeta(h);
    if (cachedPdf) {
        meta[h] = cachedPdf as FileMeta;
        if (cachedPdf.name) fileNames[h] = cachedPdf.name;
        return;
    }

    if (thumbs[h] && thumbs[h].status === 'ready') return;

    const cache = getThumbCache();
    const cached = cache.get(h);
    if (cached) {
        thumbs[h] = cached;
        // Also load meta for file names
        if (!meta[h]) {
            getFileMeta(h)
                .then((m) => {
                    if (m) {
                        meta[h] = m;
                        if (m.name) fileNames[h] = m.name;
                    }
                })
                .catch(() => {});
        }
        return;
    }

    // Use shared thumbnail loading
    const pdfMeta: Record<string, { name?: string; kind: string }> = {};
    await ensureThumbFromCache(h, thumbs, pdfMeta);

    // Copy any PDF meta discovered
    if (pdfMeta[h]) {
        meta[h] = pdfMeta[h] as FileMeta;
        if (pdfMeta[h].name) fileNames[h] = pdfMeta[h].name!;
    } else {
        // Load file meta for names
        getFileMeta(h)
            .then((m) => {
                if (m) {
                    meta[h] = m;
                    if (m.name) fileNames[h] = m.name;
                }
            })
            .catch(() => {});
    }
}

// Track current hashes and manage ref counting/object URL cleanup
const currentHashes = new Set<string>();
let isComponentActive = true;

// Queue prefetch on mount
onMounted(() => {
    if (props.hashes.length > 0) {
        queuePrefetch(props.hashes);
    }
});

watch(
    () => props.hashes,
    async (list) => {
        const cache = getThumbCache();
        const next = new Set(list);

        // Queue new hashes for bulk prefetch
        const newHashes = list.filter((h) => !currentHashes.has(h));
        if (newHashes.length > 0) {
            queuePrefetch(newHashes);
        }

        for (const h of next) {
            if (!currentHashes.has(h)) {
                await ensure(h);
                const state = cache.get(h);
                if (state?.status === 'ready' && state.url) {
                    if (!isComponentActive) {
                        retainThumb(h);
                        releaseThumb(h);
                        return;
                    }
                    retainThumb(h);
                    currentHashes.add(h);
                }
            }
        }
        for (const h of Array.from(currentHashes)) {
            if (!next.has(h)) {
                currentHashes.delete(h);
                releaseThumb(h);
            }
        }
    },
    { immediate: true }
);

onBeforeUnmount(() => {
    isComponentActive = false;
    for (const h of currentHashes) releaseThumb(h);
    currentHashes.clear();
});
defineExpose({ thumbs });
</script>

<style scoped></style>
