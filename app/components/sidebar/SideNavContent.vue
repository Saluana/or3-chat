<template>
    <div class="flex flex-col h-full relative">
        <div class="px-2 pt-2 flex flex-col space-y-2">
            <div class="flex">
                <UButton
                    @click="onNewChat"
                    class="w-full flex text-[22px] items-center justify-center backdrop-blur-2xl"
                    >New Chat</UButton
                >
                <UTooltip :delay-duration="0" text="Create project">
                    <UButton
                        color="secondary"
                        class="ml-2 flex items-center justify-center backdrop-blur-2xl"
                        icon="pixelarticons:folder-plus"
                        :ui="{
                            leadingIcon: 'w-5 h-5',
                        }"
                    />
                </UTooltip>
                <UTooltip :delay-duration="0" text="Create document">
                    <UButton
                        class="ml-2 flex items-center justify-center backdrop-blur-2xl"
                        icon="pixelarticons:note-plus"
                        :ui="{
                            base: 'bg-white text-black hover:bg-gray-100 active:bg-gray-200',
                            leadingIcon: 'w-5 h-5',
                        }"
                    />
                </UTooltip>
            </div>
            <div
                class="relative w-full ml-[1px] border-b-3 border-primary/50 pb-3"
            >
                <UInput
                    v-model="threadSearchQuery"
                    icon="pixelarticons:search"
                    size="md"
                    :ui="{
                        leadingIcon: 'h-[20px] w-[20px]',
                    }"
                    variant="outline"
                    placeholder="Search threads..."
                    class="w-full"
                >
                    <template v-if="threadSearchQuery.length > 0" #trailing>
                        <UButton
                            color="neutral"
                            variant="subtle"
                            size="xs"
                            class="flex items-center justify-center p-0"
                            icon="pixelarticons:close-box"
                            aria-label="Clear input"
                            @click="threadSearchQuery = ''"
                        /> </template
                ></UInput>
            </div>
        </div>
        <!-- Virtualized thread list -->
        <VList
            :data="displayThreads as any[]"
            class="h-[calc(100vh-250px)]! px-2 pb-8 pt-3 w-full overflow-x-hidden scrollbar-hidden"
            :overscan="8"
            #default="{ item }"
        >
            <div class="mb-2" :key="item.id">
                <RetroGlassBtn
                    :class="{
                        'active-element bg-primary/25':
                            item.id === props.activeThread,
                    }"
                    class="w-full flex items-center justify-between text-left"
                    @click="() => emit('chatSelected', item.id)"
                >
                    <div
                        class="flex items-center gap-1.5 flex-1 min-w-0 overflow-hidden"
                    >
                        <UIcon
                            v-if="item.forked"
                            name="pixelarticons:git-branch"
                            class="shrink-0"
                        ></UIcon>
                        <!-- The title span gets flex-1 + min-w-0 so it actually truncates instead of pushing the action icon off-screen -->
                        <span
                            class="block flex-1 min-w-0 truncate"
                            :title="item.title || 'New Thread'"
                        >
                            {{ item.title || 'New Thread' }}
                        </span>
                    </div>
                    <UPopover
                        :content="{
                            side: 'right',
                            align: 'start',
                            sideOffset: 6,
                        }"
                    >
                        <span
                            class="inline-flex items-center justify-center w-5 h-5 rounded-[3px] hover:bg-black/10 active:bg-black/20"
                            @click.stop
                        >
                            <UIcon
                                name="pixelarticons:more-vertical"
                                class="w-4 h-4 opacity-70"
                            />
                        </span>
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
        </VList>
        <sidebar-side-bottom-nav />

        <!-- Rename modal -->
        <UModal
            v-model:open="showRenameModal"
            title="Rename thread"
            :ui="{
                footer: 'justify-end ',
            }"
        >
            <template #header> <h3>Rename thread?</h3> </template>
            <template #body>
                <div class="space-y-4">
                    <UInput
                        v-model="renameTitle"
                        placeholder="Thread title"
                        icon="pixelarticons:edit"
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
