<template>
    <div class="flex flex-col h-full relative">
        <div class="p-2 flex flex-col space-y-2">
            <UButton
                @click="onNewChat"
                class="w-full flex items-center justify-center backdrop-blur-2xl"
                >New Chat</UButton
            >
            <div class="relative w-full ml-[1px]">
                <UInput
                    v-model="threadSearchQuery"
                    icon="pixelarticons:search"
                    size="md"
                    variant="outline"
                    placeholder="Search threads..."
                    class="w-full"
                />
                <button
                    v-if="threadSearchQuery"
                    type="button"
                    aria-label="Clear thread search"
                    class="absolute inset-y-0 right-2 my-auto h-5 w-5 flex items-center justify-center rounded hover:bg-black/10 dark:hover:bg-white/10 text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-white transition"
                    @click="threadSearchQuery = ''"
                >
                    <UIcon name="i-heroicons-x-mark" class="h-4 w-4" />
                </button>
            </div>
        </div>
        <div
            class="flex flex-col p-2 space-y-1.5 h-[calc(100vh-262px)] overflow-y-auto w-full overflow-x-hidden scrollbar-hidden"
        >
            <div v-for="item in displayThreads" :key="item.id">
                <RetroGlassBtn
                    :class="{
                        'active-element bg-primary/25':
                            item.id === props.activeThread,
                    }"
                    class="w-full flex items-center justify-between text-left"
                    @click="() => emit('chatSelected', item.id)"
                >
                    <div class="flex items-center space-x-1.5">
                        <UIcon
                            v-if="item.forked"
                            name="pixelarticons:git-branch"
                        ></UIcon>
                        <span class="truncate">{{
                            item.title || 'New Thread'
                        }}</span>
                    </div>

                    <!-- Three-dot popover INSIDE the retro button -->
                    <UPopover
                        :content="{
                            side: 'right',
                            align: 'start',
                            sideOffset: 6,
                        }"
                    >
                        <!-- Trigger -->
                        <span
                            class="inline-flex items-center justify-center w-5 h-5 rounded-[3px] hover:bg-black/10 active:bg-black/20"
                            @click.stop
                        >
                            <UIcon
                                name="pixelarticons:more-vertical"
                                class="w-4 h-4 opacity-70"
                            />
                        </span>

                        <!-- Content -->
                        <template #content>
                            <div class="p-1 w-44 space-y-1">
                                <UButton
                                    color="neutral"
                                    variant="ghost"
                                    size="sm"
                                    class="w-full justify-start"
                                    icon="i-lucide-pencil"
                                    @click="openRename(item)"
                                    >Rename</UButton
                                >
                                <UButton
                                    color="error"
                                    variant="ghost"
                                    size="sm"
                                    class="w-full justify-start"
                                    icon="i-lucide-trash-2"
                                    @click="confirmDelete(item)"
                                    >Delete</UButton
                                >
                            </div>
                        </template>
                    </UPopover>
                </RetroGlassBtn>
            </div>
        </div>
        <sidebar-side-bottom-nav />

        <!-- Rename modal -->
        <UModal
            v-model:open="showRenameModal"
            title="Rename thread"
            :ui="{ footer: 'justify-end' }"
            class="border-2"
        >
            <template #header> <h3>Rename thread?</h3> </template>
            <template #body>
                <div class="space-y-4">
                    <UInput
                        v-model="renameTitle"
                        placeholder="Thread title"
                        icon="i-lucide-pencil"
                        @keyup.enter="saveRename"
                    />
                </div>
            </template>
            <template #footer>
                <UButton variant="ghost" @click="showRenameModal = false"
                    >Cancel</UButton
                >
                <UButton color="primary" @click="saveRename">Save</UButton>
            </template>
        </UModal>

        <!-- Delete confirm modal -->
        <UModal
            v-model:open="showDeleteModal"
            title="Delete thread?"
            :ui="{ footer: 'justify-end' }"
            class="border-2"
        >
            <template #header> <h3>Delete thread?</h3> </template>
            <template #body>
                <p class="text-sm opacity-70">
                    This will permanently remove the thread and its messages.
                </p>
            </template>
            <template #footer>
                <UButton variant="ghost" @click="showDeleteModal = false"
                    >Cancel</UButton
                >
                <UButton color="error" @click="deleteThread">Delete</UButton>
            </template>
        </UModal>
    </div>
</template>
<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch, computed } from 'vue';
import { liveQuery } from 'dexie';
import { db, upsert, del as dbDel } from '~/db'; // Dexie + barrel helpers

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

const emit = defineEmits(['chatSelected', 'newChat']);

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
