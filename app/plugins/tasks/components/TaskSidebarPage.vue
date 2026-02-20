<template>
  <div class="flex flex-col gap-2 p-3">
    <!-- Create form -->
    <div class="flex gap-2">
      <UInput v-model="newListTitle" size="sm" placeholder="New list…" class="flex-1" @keyup.enter="createList" />
      <UButton size="sm" class="theme-btn" @click="createList">Create</UButton>
    </div>

    <!-- Empty state -->
    <p v-if="items.length === 0" class="text-center text-xs text-[var(--md-on-surface)] opacity-40 py-6">
      No task lists yet.
    </p>

    <!-- List items -->
    <div
      v-for="post in items"
      :key="post.id"
      class="group relative w-full flex items-center gap-2 px-3 py-2.5 transition-colors rounded-[var(--md-border-radius)] cursor-pointer text-[color:var(--md-on-surface)] hover:bg-[var(--md-surface-hover)]"
      role="button"
      tabindex="0"
      @click="editingListId !== post.id && openList(post.id)"
      @keydown.enter="editingListId !== post.id && openList(post.id)"
    >
      <!-- Inline rename mode -->
      <template v-if="editingListId === post.id">
        <UInput
          v-model="editingTitle"
          size="sm"
          class="min-w-0 flex-1"
          autofocus
          @click.stop
          @keyup.enter="saveRename(post.id)"
          @keyup.esc="cancelRename"
        />
        <UButton size="xs" variant="solid" color="primary" icon="i-lucide-check" aria-label="Save" :square="true" class="theme-btn" @click.stop="saveRename(post.id)" />
        <UButton size="xs" variant="outline" color="neutral" icon="i-lucide-x" aria-label="Cancel" :square="true" class="theme-btn" @click.stop="cancelRename" />
      </template>

      <!-- Normal mode -->
      <template v-else>
        <UIcon name="i-lucide-list-checks" class="w-[18px] h-[18px] shrink-0 text-[color:var(--md-on-surface-variant)]/70 group-hover:text-[color:var(--md-on-surface)]/80" />
        <span class="flex-1 min-w-0 truncate text-sm font-normal leading-tight text-[color:var(--md-on-surface)]">{{ post.title }}</span>
        <span class="shrink-0 text-[10px] tabular-nums opacity-40 font-medium transition-opacity group-hover:opacity-0 text-[color:var(--md-on-surface-variant)]">{{ taskCount(post.meta) }} tasks</span>

        <!-- Three-dot hover action -->
        <div class="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
          <UPopover :content="{ side: 'right', align: 'start', sideOffset: 6 }">
            <UButton
              variant="ghost"
              color="primary"
              size="xs"
              :square="true"
              :icon="iconMore"
              aria-label="List actions"
              class="flex items-center justify-center shadow-none"
              v-bind="triggerOverrides"
              @click.stop
              @keydown="handlePopoverTriggerKey"
            />
            <template #content>
              <div class="p-1 w-36 space-y-1">
                <UButton
                  color="neutral"
                  variant="popover"
                  size="sm"
                  :icon="iconEdit"
                  class="w-full justify-start"
                  @click="startRename(post.id, post.title)"
                >
                  Rename
                </UButton>
                <UButton
                  color="neutral"
                  variant="popover"
                  size="sm"
                  :icon="iconTrash"
                  class="w-full justify-start text-[var(--md-error)] hover:bg-[var(--md-error)]/10"
                  @click="removeList(post.id)"
                >
                  Delete
                </UButton>
              </div>
            </template>
          </UPopover>
        </div>
      </template>
    </div>

    <p v-if="error" class="px-1 text-xs text-[var(--md-error)]">{{ error }}</p>

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
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useSidebarMultiPane } from '~/composables/sidebar/useSidebarEnvironment';
import { usePostsList } from '~/composables/posts/usePostsList';
import { useIcon } from '~/composables/useIcon';
import { usePopoverKeyboard } from '~/composables/usePopoverKeyboard';
import { createSidebarModalProps } from '~/components/sidebar/modalProps';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { TASK_LIST_POST_TYPE } from '../types';
import { useTaskListService } from '../composables/useTaskListService';

const multiPane = useSidebarMultiPane();
const service = useTaskListService();
const { items, refresh } = usePostsList(TASK_LIST_POST_TYPE, { sort: 'updated_at', sortDir: 'desc' });
const newListTitle = ref('');
const editingListId = ref<string | null>(null);
const editingTitle = ref('');
const error = ref<string | null>(null);

const iconMore = useIcon('ui.more');
const iconEdit = useIcon('ui.edit');
const iconTrash = useIcon('ui.trash');
const { handlePopoverTriggerKey } = usePopoverKeyboard();

const showDeleteModal = ref(false);
const listToDelete = ref<string | null>(null);

const deleteListModalProps = createSidebarModalProps('sidebar.delete-task-list', {
  ui: { footer: 'justify-end' },
  class: 'border-[var(--md-border-width)]',
});

const triggerOverrides = useThemeOverrides({
  component: 'button',
  context: 'sidebar',
  identifier: 'sidebar.unified-item.trigger',
  isNuxtUI: true,
});

async function openList(recordId: string) {
  await multiPane.switchToApp('or3-tasks', { recordId });
}

function taskCount(meta: unknown): number {
  const parsed = service.readMeta(meta);
  return parsed.tasks.length;
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
}

function cancelRename() {
  editingListId.value = null;
  editingTitle.value = '';
}

async function saveRename(listId: string) {
  try {
    error.value = null;
    await service.renameList(listId, editingTitle.value);
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
    await service.deleteList(listToDelete.value);
    if (editingListId.value === listToDelete.value) cancelRename();
    await refresh();
    showDeleteModal.value = false;
    listToDelete.value = null;
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to delete list';
  }
}
</script>
