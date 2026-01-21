<template>
    <div v-if="documentsEnabled" class="h-full flex flex-col min-h-0">
        <div class="px-3 py-2 flex items-center justify-between shrink-0">
            <UButton
                variant="ghost"
                color="neutral"
                size="sm"
                :icon="iconBack"
                class="whitespace-nowrap hover:bg-[var(--md-surface-hover)] theme-btn"
                @click="goBack"
            >
                Home
            </UButton>
            <UTooltip :delay-duration="0" text="New document">
                <UButton
                    variant="ghost"
                    color="neutral"
                    size="sm"
                    :icon="iconNewDoc"
                    class="bg-[color:var(--md-primary)]/5 text-[color:var(--md-primary)] hover:bg-[color:var(--md-primary)]/10 theme-btn"
                    @click="emit('new-document')"
                >
                    New document
                </UButton>
            </UTooltip>
        </div>

        <SidebarTimeGroupedList
            ref="list"
            :active-ids="activeDocumentIds ?? []"
            type="document"
            empty-message="No documents yet"
            empty-description="Create a document to keep your work organized."
            empty-icon="lucide:file-text"
            cta-label="Create a document"
            @select="onSelect"
            @rename="onRename"
            @delete="onDelete"
            @add-to-project="onAddToProject"
            @cta="emit('new-document')"
        />
    </div>
    <div v-else class="h-full flex items-center justify-center text-sm opacity-70">
        Documents are disabled.
    </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useIcon } from '~/composables/useIcon';
import { useActiveSidebarPage } from '~/composables/sidebar/useActiveSidebarPage';
import type { UnifiedSidebarItem } from '~/types/sidebar';
import SidebarTimeGroupedList from './SidebarTimeGroupedList.vue';
import { useOr3Config } from '~/composables/useOr3Config';

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
    (e: 'rename-document', doc: UnifiedSidebarItem): void;
    (e: 'delete-document', doc: UnifiedSidebarItem): void;
    (e: 'add-document-to-project', doc: UnifiedSidebarItem): void;
}>();

const iconBack = useIcon('ui.chevron.left');
const iconNewDoc = useIcon('sidebar.new_note');
const { setActivePage } = useActiveSidebarPage();
const or3Config = useOr3Config();
const documentsEnabled = computed(() => or3Config.features.documents.enabled);

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
