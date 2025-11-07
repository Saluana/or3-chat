<template>
    <div v-if="hashes.length" class="mt-3">
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            <div
                v-for="h in hashes"
                :key="h"
                class="relative aspect-square border-2 border-black rounded-[3px] retro-shadow overflow-hidden flex items-center justify-center bg-[var(--md-surface-container-lowest)]"
            >
                <!-- PDF Placeholder if mime/kind indicates pdf -->
                <template v-if="meta[h]?.kind === 'pdf'">
                    <div
                        class="w-full h-full flex flex-col items-center justify-center gap-1 bg-[var(--md-surface-container-low)] text-center p-1"
                    >
                        <span
                            class="text-[10px] font-semibold tracking-wide uppercase bg-black text-white px-1 py-0.5 rounded"
                            >PDF</span
                        >
                        <span
                            class="text-[9px] leading-snug line-clamp-3 break-words px-1"
                            :title="fileNames[h] || h.slice(0, 8)"
                            >{{ fileNames[h] || 'document.pdf' }}</span
                        >
                    </div>
                </template>
                <template v-else-if="thumbs[h]?.status === 'ready'">
                    <img
                        :src="thumbs[h].url"
                        :alt="'file ' + h.slice(0, 8)"
                        class="object-cover w-full h-full"
                        draggable="false"
                    />
                </template>
                <template v-else-if="thumbs[h]?.status === 'error'">
                    <div class="text-[10px] text-center px-1 text-error">
                        failed
                    </div>
                </template>
                <template v-else>
                    <div class="animate-pulse text-[10px] opacity-70">
                        loading
                    </div>
                </template>
            </div>
        </div>
        <button
            :class="[
                'col-span-full mt-1 justify-self-start text-xs underline text-[var(--md-primary)]',
                (collapseButtonProps as any)?.class || ''
            ]"
            :data-theme-target="(collapseButtonProps as any)?.['data-theme-target']"
            :data-theme-matches="(collapseButtonProps as any)?.['data-theme-matches']"
            type="button"
            @click="$emit('collapse')"
            aria-label="Hide attachments"
        >
            Hide attachments
        </button>
    </div>
</template>

<script setup lang="ts">
import { reactive, watch, computed } from 'vue';
import { getFileBlob, getFileMeta } from '~/db/files';
import { useThemeOverrides } from '~/composables/useThemeResolver';

interface ThumbState {
    status: 'loading' | 'ready' | 'error';
    url?: string;
}
const props = defineProps<{ hashes: string[] }>();
defineEmits<{ (e: 'collapse'): void }>();

// Theme overrides for collapse button
const collapseButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'message',
        identifier: 'message.collapse-attachments',
        isNuxtUI: false,
    });

    return overrides.value;
});

// Reuse global caches so virtualization doesn't thrash
const cache = ((globalThis as any).__or3ThumbCache ||= new Map<
    string,
    ThumbState
>());
const inflight = ((globalThis as any).__or3ThumbInflight ||= new Map<
    string,
    Promise<void>
>());
const thumbs = reactive<Record<string, ThumbState>>({});
const meta = reactive<Record<string, any>>({});
const fileNames = reactive<Record<string, string>>({});

async function ensure(h: string) {
    if (thumbs[h] && thumbs[h].status === 'ready') return;
    const cached = cache.get(h);
    if (cached) {
        thumbs[h] = cached;
        return;
    }
    if (inflight.has(h)) {
        await inflight.get(h);
        const after = cache.get(h);
        if (after) thumbs[h] = after;
        return;
    }
    thumbs[h] = { status: 'loading' };
    const p = (async () => {
        try {
            const [blob, m] = await Promise.all([
                getFileBlob(h),
                getFileMeta(h).catch(() => undefined),
            ]);
            if (m) {
                meta[h] = m;
                if (m.name) fileNames[h] = m.name;
            }
            if (!blob) throw new Error('missing');
            const url = URL.createObjectURL(blob);
            const ready: ThumbState = { status: 'ready', url };
            cache.set(h, ready);
            thumbs[h] = ready;
        } catch {
            const err: ThumbState = { status: 'error' };
            cache.set(h, err);
            thumbs[h] = err;
        } finally {
            inflight.delete(h);
        }
    })();
    inflight.set(h, p);
    await p;
}

watch(
    () => props.hashes,
    (list) => {
        list.forEach(ensure);
    },
    { immediate: true }
);
defineExpose({ thumbs });
</script>

<style scoped></style>
