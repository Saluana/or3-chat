<template>
    <div class="flex flex-col justify-between h-full relative">
        <div class="px-1 pt-2 flex flex-col space-y-2">
            <UTooltip :delay-duration="0" text="New chat">
                <UButton
                    @click="onNewChat"
                    size="md"
                    class="flex item-center justify-center"
                    icon="pixelarticons:message-plus"
                    :ui="{
                        leadingIcon: 'w-5 h-5',
                    }"
                ></UButton>
                <UButton
                    size="md"
                    class="flex item-center justify-center"
                    icon="pixelarticons:search"
                    :ui="{
                        base: 'bg-white text-black hover:bg-gray-100 active:bg-gray-200',
                        leadingIcon: 'w-5 h-5',
                    }"
                    @click="emit('focusSearch')"
                ></UButton>
            </UTooltip>
        </div>
        <div class="px-1 pt-2 flex flex-col space-y-2 mb-2">
            <UButton
                size="md"
                class="flex item-center justify-center"
                icon="pixelarticons:sliders-2"
                :ui="{
                    base: 'bg-[var(--md-surface-variant)] text-[var(--md-on-surface)] hover:bg-gray-300 active:bg-gray-300',
                    leadingIcon: 'w-5 h-5',
                }"
            ></UButton>
        </div>
    </div>
</template>
<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch, computed } from 'vue';
import { liveQuery } from 'dexie';
import { db, upsert, del as dbDel } from '~/db'; // Dexie + barrel helpers
import { VList } from 'virtua/vue';

const props = defineProps<{
    activeThread?: string;
}>();

const items = ref<any[]>([]);
import { useThreadSearch } from '~/composables/useThreadSearch';
const { query: threadSearchQuery, results: threadSearchResults } =
    useThreadSearch(items as any);
const displayThreads = computed(() =>
    threadSearchQuery.value.trim() ? threadSearchResults.value : items.value
);
let sub: { unsubscribe: () => void } | null = null;

onMounted(() => {
    // Sort by last opened using updated_at index; filter out deleted
    sub = liveQuery(() =>
        db.threads
            .orderBy('updated_at')
            .reverse()
            .filter((t) => !t.deleted)
            .toArray()
    ).subscribe({
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

const emit = defineEmits(['chatSelected', 'newChat', 'focusSearch']);

// ----- Actions: menu, rename, delete -----
const showRenameModal = ref(false);
const renameId = ref<string | null>(null);
const renameTitle = ref('');

const showDeleteModal = ref(false);
const deleteId = ref<string | null>(null);

function openRename(thread: any) {
    renameId.value = thread.id;
    renameTitle.value = thread.title ?? '';
    showRenameModal.value = true;
}

async function saveRename() {
    if (!renameId.value) return;
    const t = await db.threads.get(renameId.value);
    if (!t) return;
    const now = Math.floor(Date.now() / 1000);
    await upsert.thread({ ...t, title: renameTitle.value, updated_at: now });
    showRenameModal.value = false;
    renameId.value = null;
    renameTitle.value = '';
}

function confirmDelete(thread: any) {
    deleteId.value = thread.id as string;
    showDeleteModal.value = true;
}

async function deleteThread() {
    if (!deleteId.value) return;
    await dbDel.hard.thread(deleteId.value);
    showDeleteModal.value = false;
    deleteId.value = null;
}

function onNewChat() {
    emit('newChat');
    console.log('New chat requested');
}
</script>
