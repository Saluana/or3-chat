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
import { reactive, watch, onBeforeUnmount } from 'vue';
import { getFileBlob, getFileMeta } from '~/db/files';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import type { FileMeta } from '../../../types/chat-internal';
import {
    useThumbnailUrlCache,
    type ThumbState,
} from '~/composables/core/useThumbnailUrlCache';

type LocalThumbState = ThumbState | { status: 'loading' };

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

// Shared object URL cache across chat surfaces
const thumbUrlCache = useThumbnailUrlCache({ graceMs: 30000 });

const thumbs = reactive<Record<string, LocalThumbState>>({});
const meta = reactive<Record<string, FileMeta>>({});
const fileNames = reactive<Record<string, string>>({});

async function ensure(h: string) {
    if (thumbs[h] && thumbs[h].status === 'ready') return;
    const cached = thumbUrlCache.get(h);
    if (cached) {
        thumbs[h] = cached;
        return;
    }

    thumbs[h] = { status: 'loading' };
    const state = await thumbUrlCache.ensure(h, async () => {
        const [blob, m] = await Promise.all([
            getFileBlob(h),
            getFileMeta(h).catch(() => undefined),
        ]);
        if (m) {
            meta[h] = m;
            if (m.name) fileNames[h] = m.name;
        }
        return blob;
    });
    if (state) {
        thumbs[h] = state;
    } else {
        thumbs[h] = { status: 'error' };
    }
}

// Track current hashes and manage ref counting/object URL cleanup
const currentHashes = new Set<string>();
let isComponentActive = true;

watch(
    () => props.hashes,
    async (list) => {
        const next = new Set(list);
        for (const h of next) {
            if (!currentHashes.has(h)) {
                await ensure(h);
                const state = thumbUrlCache.get(h);
                if (state?.status === 'ready' && state.url) {
                    if (!isComponentActive) {
                        thumbUrlCache.retain(h);
                        thumbUrlCache.release(h);
                        return;
                    }
                    thumbUrlCache.retain(h);
                    currentHashes.add(h);
                }
            }
        }
        for (const h of Array.from(currentHashes)) {
            if (!next.has(h)) {
                currentHashes.delete(h);
                thumbUrlCache.release(h);
                delete thumbs[h];
            }
        }
    },
    { immediate: true }
);

onBeforeUnmount(() => {
    isComponentActive = false;
    for (const h of currentHashes) {
        thumbUrlCache.release(h);
        delete thumbs[h];
    }
    currentHashes.clear();
});
defineExpose({ thumbs });
</script>

<style scoped></style>
