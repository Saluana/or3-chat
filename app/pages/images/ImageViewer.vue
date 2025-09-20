<script setup lang="ts">
import { onBeforeUnmount, reactive, watch } from 'vue';
import type { FileMeta } from '../../db/schema';
import { getFileBlob } from '../../db/files';

const props = defineProps<{
    modelValue: boolean;
    meta: FileMeta | null;
}>();
const emit = defineEmits<{
    (e: 'update:modelValue', v: boolean): void;
    (e: 'download', meta: FileMeta): void;
    (e: 'copy', meta: FileMeta): void;
    (e: 'rename', meta: FileMeta): void;
}>();

const state = reactive<{ url?: string }>({ url: undefined });

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

function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
}
</script>

<template>
    <teleport to="body">
        <div
            v-if="modelValue"
            @keydown.capture="onKey"
            tabindex="0"
            class="fixed inset-0 z-50"
        >
            <div class="absolute inset-0 bg-black/70" @click="close"></div>
            <div class="absolute inset-0 p-4 flex flex-col">
                <div class="self-end mb-2 flex gap-2">
                    <button
                        class="px-2 py-1 bg-white/10 rounded"
                        @click="meta && emit('download', meta)"
                    >
                        Download
                    </button>
                    <button
                        class="px-2 py-1 bg-white/10 rounded"
                        @click="meta && emit('copy', meta)"
                    >
                        Copy
                    </button>
                    <button
                        class="px-2 py-1 bg-white/10 rounded"
                        @click="meta && emit('rename', meta)"
                    >
                        Rename
                    </button>
                    <button
                        class="px-2 py-1 bg-white/10 rounded"
                        @click="close"
                    >
                        Close
                    </button>
                </div>
                <div class="flex-1 min-h-0 grid place-items-center">
                    <img
                        v-if="state.url"
                        :src="state.url"
                        :alt="meta?.name"
                        class="max-w-full max-h-full object-contain"
                    />
                    <div v-else class="text-white/80 text-sm">Loading…</div>
                </div>
            </div>
        </div>
    </teleport>
</template>

<style scoped></style>
