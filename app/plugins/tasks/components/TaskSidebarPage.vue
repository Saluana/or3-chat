<template>
  <div class="flex flex-col h-full min-h-0 px-2">
    <!-- Create form -->
    <div class="flex flex-col gap-3 mt-2 mb-2 px-1 mr-2.5">
            <UInput
        v-model="searchQuery"
        size="md"
        :icon="iconSearch"
        placeholder="Search lists and tasks..."
        class="w-full"
      />
      <div class="flex gap-2">
        <UInput v-model="newListTitle" size="md" placeholder="New list…" class="flex-1" @keyup.enter="createList" />
        <UButton size="md" class="theme-btn" @click="createList">Create</UButton>
      </div>
    </div>

    <!-- Single scroll container for all content -->
    <ClientOnly>
      <Or3Scroll
        ref="scrollAreaRef"
        :items="combinedItems"
        :item-key="(item) => item.key"
        :estimate-height="40"
        :overscan="240"
        :maintain-bottom="false"
        class="flex-1 min-h-0 sidebar-scroll"
      >
        <template #default="{ item }">
          <!-- Empty State -->
          <p v-if="item.type === 'empty-state'" class="text-center text-sm text-(--md-on-surface) opacity-40 py-8">
            {{ hasSearchQuery ? 'No matching task lists.' : 'No task lists yet.' }}
          </p>

          <!-- Time Group Header -->
          <SidebarGroupHeader
            v-else-if="item.type === 'time-group-header'"
            class="mt-3 time-group-header"
            :label="item.label"
            :collapsed="collapsedGroups.has(item.groupKey)"
            @toggle="toggleGroup(item.groupKey)"
          />

          <!-- Unified Item -->
          <SidebarUnifiedItem
            v-else-if="item.type === 'time-group-item'"
            :item="item.item"
            :active="activeListId === item.item.id"
            :time-display="formatTimeDisplay(item.item.updatedAt, item.groupKey)"
            :class="[
              'mb-0.5',
              collapsingGroups.has(item.groupKey) && 'is-exiting',
            ]"
            @select="() => openList(item.item.id)"
            @rename="() => startRename(item.item.id, item.item.title || 'Untitled Tasks')"
            @delete="() => removeList(item.item.id)"
          />
        </template>
      </Or3Scroll>
    </ClientOnly>

    <p v-if="error" class="px-1 text-xs text-(--md-error)">{{ error }}</p>

    <!-- Delete confirm modal -->
    <UModal
      v-bind="deleteListModalProps"
      v-model:open="showDeleteModal"
      title="Delete task list"
    >
      <template #body>
        <p class="text-sm opacity-70">
          This will permanently remove the task list and all its tasks.
        </p>
      </template>
      <template #footer>
        <UButton variant="ghost" class="theme-btn" @click="showDeleteModal = false">Cancel</UButton>
        <UButton color="error" class="theme-btn" @click="confirmDeleteList">Delete</UButton>
      </template>
    </UModal>

    <!-- Rename Modal -->
    <UModal
      v-model:open="showRenameModal"
      title="Rename task list"
      :ui="{ footer: 'justify-end' }"
      class="border-(--md-border-width)"
    >
      <template #body>
        <UInput
          v-model="editingTitle"
          autofocus
          placeholder="List name"
          @keyup.enter="saveRename"
        />
      </template>
      <template #footer>
        <UButton variant="ghost" class="theme-btn" @click="cancelRename">Cancel</UButton>
        <UButton color="primary" class="theme-btn" @click="saveRename">Save</UButton>
      </template>
    </UModal>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, reactive, onUnmounted } from 'vue';
import { useSidebarMultiPane } from '~/composables/sidebar/useSidebarEnvironment';
import { usePostsList } from '~/composables/posts/usePostsList';
import { useIcon } from '~/composables/useIcon';
import { createSidebarModalProps } from '~/components/sidebar/modalProps';
import { TASK_LIST_POST_TYPE } from '../types';
import { useTaskListService } from '../composables/useTaskListService';
import { useTaskListSearch } from '../composables/useTaskListSearch';
import { Or3Scroll, type Or3ScrollRef } from 'or3-scroll';
import SidebarGroupHeader from '~/components/sidebar/SidebarGroupHeader.vue';
import SidebarUnifiedItem from '~/components/sidebar/SidebarUnifiedItem.vue';
import {
  computeTimeGroup,
  getTimeGroupLabel,
  formatTimeDisplay,
  type TimeGroup,
} from '~/utils/sidebar/sidebarTimeUtils';
import type { UnifiedSidebarItem } from '~/types/sidebar';

const multiPane = useSidebarMultiPane();
const service = useTaskListService();
const { items, refresh } = usePostsList(TASK_LIST_POST_TYPE, { sort: 'updated_at', sortDir: 'desc' });
const { query: searchQuery, results: searchResults } = useTaskListSearch(
  items,
  service.readMeta
);
const newListTitle = ref('');
const editingListId = ref<string | null>(null);
const editingTitle = ref('');
const error = ref<string | null>(null);
const hasSearchQuery = computed(() => searchQuery.value.trim().length > 0);
const visibleItems = computed(() => searchResults.value);

const iconSearch = useIcon('ui.search');
const iconTaskList = useIcon('ui.tasklist');

const showDeleteModal = ref(false);
const listToDelete = ref<string | null>(null);
const showRenameModal = ref(false);

const deleteListModalProps = createSidebarModalProps('sidebar.delete-task-list', {
  ui: { footer: 'justify-end' },
  class: 'border-[var(--md-border-width)]',
});

const scrollAreaRef = ref<Or3ScrollRef | null>(null);

// Time grouping state
const collapsedGroups = reactive(new Set<string>());
const collapsingGroups = reactive(new Set<string>());
const pendingTimeouts = new Set<ReturnType<typeof setTimeout>>();
const COLLAPSE_ANIMATION_DURATION = 200;

function toggleGroup(groupKey: string) {
  if (collapsedGroups.has(groupKey)) {
    collapsedGroups.delete(groupKey);
  } else {
    collapsingGroups.add(groupKey);
    const timeoutId = setTimeout(() => {
      collapsingGroups.delete(groupKey);
      collapsedGroups.add(groupKey);
      pendingTimeouts.delete(timeoutId);
    }, COLLAPSE_ANIMATION_DURATION);
    pendingTimeouts.add(timeoutId);
  }
}

// Group items by time
const groupedItems = computed(() => {
  const groups = new Map<TimeGroup, UnifiedSidebarItem[]>();

  for (const item of visibleItems.value) {
    const unifiedItem: UnifiedSidebarItem = {
      id: item.id,
      type: 'document', // Use document type for unified item styling
      title: item.title ?? 'Untitled',
      updatedAt: item.updated_at ?? 0,
      icon: iconTaskList.value,
    };
    const groupKey = computeTimeGroup(unifiedItem.updatedAt);
    if (!groups.has(groupKey)) {
      groups.set(groupKey, []);
    }
    groups.get(groupKey)!.push(unifiedItem);
  }

  return groups;
});

type SidebarCombinedItem =
  | { key: string; type: 'empty-state' }
  | { key: string; type: 'time-group-header'; label: string; groupKey: TimeGroup }
  | { key: string; type: 'time-group-item'; item: UnifiedSidebarItem; groupKey: TimeGroup };

// Build combined items list for Or3Scroll
const combinedItems = computed(() => {
  const result: SidebarCombinedItem[] = [];

  if (visibleItems.value.length === 0) {
    result.push({
      key: 'home-empty-state',
      type: 'empty-state',
    });
    return result;
  }

  for (const [groupKey, groupItems] of groupedItems.value) {
    result.push({
      key: `time-group-header-${groupKey}`,
      type: 'time-group-header',
      label: getTimeGroupLabel(groupKey),
      groupKey,
    });

    if (!collapsedGroups.has(groupKey)) {
      for (const item of groupItems) {
        result.push({
          key: `time-group-item-${item.id}`,
          type: 'time-group-item',
          item,
          groupKey,
        });
      }
    }
  }

  return result;
});

const activeListId = computed(() => {
  const activeId = multiPane.activePaneId.value;
  const activePane = multiPane.panes.value.find((p) => p.id === activeId);
  if (activePane?.mode === 'or3-tasks') {
    return activePane.documentId;
  }
  return null;
});

async function openList(recordId: string) {
  await multiPane.switchToApp('or3-tasks', { recordId });
}

async function createList() {
  try {
    error.value = null;
    const id = await service.createList(newListTitle.value || 'My Tasks');
    newListTitle.value = '';
    await refresh();
    await openList(id);
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to create list';
  }
}

function startRename(listId: string, title: string) {
  error.value = null;
  editingListId.value = listId;
  editingTitle.value = title;
  showRenameModal.value = true;
}

function cancelRename() {
  editingListId.value = null;
  editingTitle.value = '';
  showRenameModal.value = false;
}

async function saveRename() {
  if (!editingListId.value) return;
  try {
    error.value = null;
    await service.renameList(editingListId.value, editingTitle.value);
    cancelRename();
    await refresh();
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to rename list';
  }
}

function removeList(listId: string) {
  listToDelete.value = listId;
  showDeleteModal.value = true;
}

async function confirmDeleteList() {
  if (!listToDelete.value) return;
  try {
    error.value = null;
    const deletedId = listToDelete.value;
    await service.deleteList(deletedId);
    if (editingListId.value === deletedId) cancelRename();

    const panes = multiPane.panes.value;
    for (let i = panes.length - 1; i >= 0; i -= 1) {
      const pane = panes[i];
      if (!pane) continue;
      if (pane.mode !== 'or3-tasks') continue;
      if (pane.documentId !== deletedId) continue;

      if (panes.length > 1) {
        await multiPane.closePane(i);
      } else {
        multiPane.updatePane(i, {
          mode: 'chat',
          threadId: '',
          documentId: undefined,
          messages: [],
        });
        multiPane.setActive(i);
      }
    }

    await refresh();
    showDeleteModal.value = false;
    listToDelete.value = null;
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to delete list';
  }
}

onUnmounted(() => {
  pendingTimeouts.forEach(clearTimeout);
  pendingTimeouts.clear();
});
</script>
