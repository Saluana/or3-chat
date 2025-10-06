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
                @click="emit('toggleDashboard')"
                size="md"
                class="flex item-center justify-center"
                icon="pixelarticons:dashboard"
                :ui="{
                    base: 'bg-[var(--md-surface-variant)] hover:bg-[var(--md-surface-variant)]/80 active:bg-[var(--md-surface-variant)]/90 text-[var(--md-on-surface)]',
                    leadingIcon: 'w-5 h-5',
                }"
            ></UButton>
        </div>
        <div
            v-if="sidebarFooterActions.length"
            class="px-1 pb-2 flex flex-col space-y-2"
        >
            <UTooltip
                v-for="entry in sidebarFooterActions"
                :key="`sidebar-collapsed-footer-${entry.action.id}`"
                :delay-duration="0"
                :text="entry.action.tooltip || entry.action.label"
            >
                <UButton
                    size="md"
                    variant="ghost"
                    :color="(entry.action.color || 'neutral') as any"
                    :square="!entry.action.label"
                    :disabled="entry.disabled"
                    class="retro-btn pointer-events-auto flex items-center justify-center gap-1"
                    :ui="{ base: 'retro-btn' }"
                    :aria-label="
                        entry.action.tooltip ||
                        entry.action.label ||
                        entry.action.id
                    "
                    @click="() => handleSidebarFooterAction(entry)"
                >
                    <UIcon :name="entry.action.icon" class="w-5 h-5" />
                    <span v-if="entry.action.label" class="text-xs font-medium">
                        {{ entry.action.label }}
                    </span>
                </UButton>
            </UTooltip>
        </div>
    </div>
</template>
<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch, computed } from 'vue';
import { liveQuery } from 'dexie';
import { db, upsert, del as dbDel } from '~/db'; // Dexie + barrel helpers
import { nowSec } from '~/db/util';

const props = defineProps<{
    activeThread?: string;
}>();

const items = ref<any[]>([]);
import { useThreadSearch } from '~/composables/threads/useThreadSearch';
const { query: threadSearchQuery, results: threadSearchResults } =
    useThreadSearch(items as any);
const displayThreads = computed(() =>
    threadSearchQuery.value.trim() ? threadSearchResults.value : items.value
);

const activeDocumentIds = computed<string[]>(() => {
    const api: any = (globalThis as any).__or3MultiPaneApi;
    if (api && api.panes && Array.isArray(api.panes.value)) {
        return api.panes.value
            .filter((p: any) => p.mode === 'doc' && p.documentId)
            .map((p: any) => p.documentId as string);
    }
    return [];
});

const activeThreadIds = computed<string[]>(() => {
    const api: any = (globalThis as any).__or3MultiPaneApi;
    if (api && api.panes && Array.isArray(api.panes.value)) {
        const ids = api.panes.value
            .filter((p: any) => p.mode === 'chat' && p.threadId)
            .map((p: any) => p.threadId as string)
            .filter(Boolean);
        if (ids.length) return ids;
    }
    return props.activeThread ? [props.activeThread] : [];
});

const collapsedFooterContext = () => ({
    activeThreadId: activeThreadIds.value[0] ?? null,
    activeDocumentId: activeDocumentIds.value[0] ?? null,
    isCollapsed: true,
});

const sidebarFooterActions = useSidebarFooterActions(collapsedFooterContext);

async function handleSidebarFooterAction(entry: SidebarFooterActionEntry) {
    if (entry.disabled) return;
    try {
        await entry.action.handler(collapsedFooterContext());
    } catch (error) {
        console.error(
            `[SidebarCollapsed] footer action "${entry.action.id}" failed`,
            error
        );
    }
}
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
    () => {
        /* silent: removed Items updated log */
    }
);

onUnmounted(() => {
    sub?.unsubscribe();
});

const emit = defineEmits([
    'chatSelected',
    'newChat',
    'focusSearch',
    'toggleDashboard',
]);

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
    const now = nowSec();
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
}
</script>
