<script setup lang="ts">
import { onBeforeUnmount, reactive, watch, ref, nextTick } from 'vue';
import type { FileMeta } from '~/db/schema';
import { getFileBlob } from '~/db/files';
import { onKeyStroke } from '@vueuse/core';

const props = defineProps<{
    modelValue: boolean;
    meta: FileMeta | null;
}>();
const emit = defineEmits<{
    (e: 'update:modelValue', v: boolean): void;
    (e: 'download', meta: FileMeta): void;
    (e: 'copy', meta: FileMeta): void;
    (e: 'rename', meta: FileMeta): void;
    (e: 'delete', meta: FileMeta): void;
}>();

const state = reactive<{ url?: string }>({ url: undefined });
const overlayEl = ref<HTMLElement | null>(null);

async function load() {
    revoke();
    if (!props.meta) return;
    try {
        const blob = await getFileBlob(props.meta.hash);
        if (!blob) return;
        state.url = URL.createObjectURL(blob);
    } catch {}
}

function revoke() {
    if (state.url) URL.revokeObjectURL(state.url);
    state.url = undefined;
}

watch(
    () => props.meta?.hash,
    () => load(),
    { immediate: true }
);

onBeforeUnmount(revoke);

function close() {
    emit('update:modelValue', false);
}

onKeyStroke('Escape', (e) => {
    close();
});

watch(
    () => props.modelValue,
    async (v) => {
        if (v) await nextTick().then(() => overlayEl.value?.focus());
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
            :ui="{
                footer: 'justify-end border-t-2',
                body: 'overflow-hidden flex-1 p-0! h-[100dvh] w-[100dvw]',
            }"
        >
            <div
                @click.stop.prevent
                class="fixed top-0 z-[1200] right-0 mt-2 mr-2 flex gap-2 p-1 rounded-md border-2 border-[var(--md-outline-variant)] bg-[var(--md-surface-container-highest)]/95 backdrop-blur"
            >
                <button
                    class="retro-btn px-3 py-1 text-sm"
                    @click.stop.self="meta && emit('download', meta)"
                >
                    Download
                </button>
                <button
                    class="retro-btn px-3 py-1 text-sm"
                    @click.stop.self="meta && emit('copy', meta)"
                >
                    Copy
                </button>
                <button
                    class="retro-btn px-3 py-1 text-sm"
                    @click.stop.self="meta && emit('rename', meta)"
                >
                    Rename
                </button>
                <button
                    class="retro-btn px-3 py-1 text-sm text-[var(--md-error)]"
                    @click.stop.self="meta && emit('delete', meta)"
                >
                    Delete
                </button>
                <button
                    class="retro-btn px-3 py-1 text-sm"
                    @click.stop.self="close"
                >
                    Close
                </button>
            </div>
            <div
                class="bg-black/75 dark:bg-white/5 backdrop-blur-xs w-[100dvw] h-[100dvh] z-[1003] overflow-hidden absolute top-0 left-0"
                @click.self="close"
            >
                <div
                    ref="overlayEl"
                    class="inset-0 p-4 grid place-items-center h-full w-full"
                    tabindex="-1"
                    @click.self="close"
                >
                    <img
                        v-if="state.url"
                        :src="state.url"
                        :alt="meta?.name"
                        class="max-w-[min(96vw,1400px)] h-[70dvh] object-contain"
                    />
                    <div v-else class="text-white/80 text-sm">Loading…</div>
                </div>
            </div>
        </UModal>
    </teleport>
</template>

<style scoped></style>
