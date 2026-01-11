<template>
    <div class="h-full flex flex-col min-h-0">
        <div class="px-3 py-2 flex items-center shrink-0">
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
        </div>
        
        <SidebarTimeGroupedList
            ref="list"
            :active-ids="activeDocumentIds ?? []"
            type="document"
            empty-message="No documents yet"
            empty-icon="lucide:file-text"
            cta-label="Create a document"
            @select="onSelect"
            @rename="onRename"
            @delete="onDelete"
            @add-to-project="onAddToProject"
            @cta="emit('new-document')"
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
    name: 'sidebar-docs',
});

const props = defineProps<{
    activeDocumentIds?: string[];
}>();

const emit = defineEmits<{
    (e: 'new-document'): void;
    (e: 'select-document', id: string): void;
    (e: 'rename-document', doc: any): void;
    (e: 'delete-document', doc: any): void;
    (e: 'add-document-to-project', doc: any): void;
}>();

const iconBack = useIcon('ui.chevron.left');
const { setActivePage } = useActiveSidebarPage();

function goBack() {
    setActivePage('sidebar-home');
}

function onSelect(item: UnifiedSidebarItem) {
    emit('select-document', item.id);
}

function onRename(item: UnifiedSidebarItem) {
    emit('rename-document', item);
}

function onDelete(item: UnifiedSidebarItem) {
    emit('delete-document', item);
}

function onAddToProject(item: UnifiedSidebarItem) {
    emit('add-document-to-project', item);
}

const list = ref<InstanceType<typeof SidebarTimeGroupedList> | null>(null);
function resetList() {
    list.value?.reset();
}
defineExpose({ resetList });
</script>
