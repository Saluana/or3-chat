<template>
  <div class="flex flex-col gap-2 p-3">
    <!-- Create form -->
    <div class="flex gap-2">
      <UInput v-model="newListTitle" size="sm" placeholder="New list…" class="flex-1" @keyup.enter="createList" />
      <UButton size="sm" @click="createList">Create</UButton>
    </div>

    <!-- Empty state -->
    <p v-if="items.length === 0" class="text-center text-xs text-[var(--md-on-surface)] opacity-40 py-6">
      No task lists yet.
    </p>

    <!-- List items -->
    <button
      v-for="post in items"
      :key="post.id"
      class="w-full text-left bg-[var(--md-surface)] border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius)] theme-shadow hover:bg-[var(--md-surface-hover)] active:bg-[var(--md-surface-active)] transition-colors p-3"
      @click="openList(post.id)"
    >
      <div class="flex items-center justify-between gap-2 min-w-0">
        <span class="min-w-0 flex-1 text-sm font-medium text-[var(--md-on-surface)] truncate whitespace-nowrap">{{ post.title }}</span>
        <span class="shrink-0 text-xs text-[var(--md-on-surface)] opacity-60">{{ taskCount(post.meta) }} tasks</span>
      </div>
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useSidebarMultiPane } from '~/composables/sidebar/useSidebarEnvironment';
import { usePostsList } from '~/composables/posts/usePostsList';
import { TASK_LIST_POST_TYPE } from '../types';
import { useTaskListService } from '../composables/useTaskListService';

const multiPane = useSidebarMultiPane();
const service = useTaskListService();
const { items, refresh } = usePostsList(TASK_LIST_POST_TYPE, { sort: 'updated_at', sortDir: 'desc' });
const newListTitle = ref('');

async function openList(recordId: string) {
  await multiPane.switchToApp('or3-tasks', { recordId });
}

function taskCount(meta: unknown): number {
  const parsed = service.readMeta(meta);
  return parsed.tasks.length;
}

async function createList() {
  const id = await service.createList(newListTitle.value || 'My Tasks');
  newListTitle.value = '';
  refresh();
  await openList(id);
}
</script>
