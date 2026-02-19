<template>
  <div class="p-3 space-y-3">
    <div class="flex items-center gap-2">
      <UInput v-model="newListTitle" placeholder="New list name" class="flex-1" />
      <UButton size="sm" @click="createList">Create</UButton>
    </div>

    <UCard v-for="post in items" :key="post.id" class="cursor-pointer" @click="openList(post.id)">
      <div class="flex items-center justify-between gap-2">
        <span class="text-sm font-medium">{{ post.title }}</span>
        <span class="text-xs opacity-70">{{ taskCount(post.meta) }} tasks</span>
      </div>
    </UCard>
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
  await multiPane.openApp('or3-tasks', { recordId });
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
