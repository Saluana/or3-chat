<template>
    <div class="flex flex-col h-full relative">
        <div class="p-2 flex flex-col space-y-2">
            <UButton
                class="w-full flex items-center justify-center backdrop-blur-2xl"
                >New Chat</UButton
            >
            <UInput
                icon="i-lucide-search"
                size="md"
                variant="outline"
                placeholder="Search..."
                class="w-full ml-[1px]"
            ></UInput>
        </div>
        <div class="flex flex-col p-2 space-y-1.5">
            <div v-for="item in items" :key="item.id">
                <RetroGlassBtn @click="() => emit('chatSelected', item.id)">{{
                    item.title
                }}</RetroGlassBtn>
            </div>
        </div>
        <sidebar-side-bottom-nav />
    </div>
</template>
<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { liveQuery } from 'dexie';
import { db } from '~/db'; // your Dexie instance

const items = ref<any[]>([]);
let sub: { unsubscribe: () => void } | null = null;

onMounted(() => {
    sub = liveQuery(() => db.table('threads').toArray()).subscribe({
        next: (results) => (items.value = results),
        error: (err) => console.error('liveQuery error', err),
    });
});

watch(
    () => items.value,
    (newItems) => {
        console.log('Items updated:', newItems);
    }
);

onUnmounted(() => {
    sub?.unsubscribe();
});

const emit = defineEmits(['chatSelected', 'newChat']);
</script>
