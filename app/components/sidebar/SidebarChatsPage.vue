<template>
    <div class="h-full flex flex-col min-h-0">
        <div class="px-3 py-2 flex items-center justify-between shrink-0">
            <UButton
                variant="ghost"
                color="neutral"
                size="sm"
                :icon="iconBack"
                class="whitespace-nowrap hover:bg-[var(--md-surface-hover)]"
                @click="goBack"
            >
                Home
            </UButton>
            <UTooltip :delay-duration="0" text="New chat">
                <UButton
                    variant="ghost"
                    color="neutral"
                    size="sm"
                    :icon="iconNewChat"
                    class="bg-[color:var(--md-primary)]/10 text-[color:var(--md-primary)] hover:bg-[color:var(--md-primary)]/15"
                    @click="emit('new-chat')"
                >
                    New chat
                </UButton>
            </UTooltip>
        </div>
        
        <SidebarTimeGroupedList
            ref="list"
            :active-ids="activeThreadIds ?? []"
            type="thread"
            empty-message="No chats yet"
            empty-description="Kick things off by starting a new chat."
            empty-icon="lucide:message-square"
            cta-label="Start a new chat"
            @select="onSelect"
            @rename="onRename"
            @delete="onDelete"
            @add-to-project="onAddToProject"
            @cta="emit('new-chat')"
        />
    </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useIcon } from '~/composables/useIcon';
import { useActiveSidebarPage } from '~/composables/sidebar/useActiveSidebarPage';
import type { UnifiedSidebarItem } from '~/types/sidebar';
import SidebarTimeGroupedList from './SidebarTimeGroupedList.vue';

// Component name for KeepAlive matching
defineOptions({
    name: 'sidebar-chats',
});

const props = defineProps<{
    activeThreadIds?: string[];
}>();

const emit = defineEmits<{
    (e: 'new-chat'): void;
    (e: 'select-thread', id: string): void;
    (e: 'rename-thread', thread: UnifiedSidebarItem): void;
    (e: 'delete-thread', thread: UnifiedSidebarItem): void;
    (e: 'add-to-project', thread: UnifiedSidebarItem): void;
}>();

const iconBack = useIcon('ui.chevron.left');
const iconNewChat = useIcon('sidebar.new_chat');
const { setActivePage } = useActiveSidebarPage();

function goBack() {
    setActivePage('sidebar-home');
}

function onSelect(item: UnifiedSidebarItem) {
    emit('select-thread', item.id);
}

function onRename(item: UnifiedSidebarItem) {
    emit('rename-thread', item);
}

function onDelete(item: UnifiedSidebarItem) {
    emit('delete-thread', item);
}

function onAddToProject(item: UnifiedSidebarItem) {
    emit('add-to-project', item);
}

// Support search/filter reset if needed
const list = ref<InstanceType<typeof SidebarTimeGroupedList> | null>(null);
function resetList() {
    list.value?.reset();
}
defineExpose({ resetList });
</script>
