<template>
  <UCard class="retro-card">
    <div class="flex items-start gap-2">
      <UButton class="retro-btn aspect-square" size="xs" icon="pixelarticons:arrow-up" aria-label="Move task up" @click="$emit('move-up', task.id)" />
      <UButton class="retro-btn aspect-square" size="xs" icon="pixelarticons:arrow-down" aria-label="Move task down" @click="$emit('move-down', task.id)" />
      <UCheckbox :model-value="task.status === 'done'" @update:model-value="$emit('toggle-done', task.id, $event)" />
      <div class="min-w-0 flex-1 space-y-2">
        <div class="flex flex-wrap items-center gap-2">
          <UInput :model-value="task.title" size="sm" class="min-w-[180px] flex-1" @update:model-value="$emit('update-title', task.id, String($event))" />
          <UBadge color="neutral" variant="soft">{{ task.label }}</UBadge>
          <UInput type="date" size="sm" :model-value="dueDateValue" @update:model-value="$emit('reschedule', task.id, String($event))" />
          <UButton size="xs" variant="soft" icon="pixelarticons:robot" @click="$emit('breakdown', task.id)">Break this down</UButton>
          <UButton class="retro-btn aspect-square" size="xs" icon="pixelarticons:trash" color="error" aria-label="Remove task" @click="$emit('remove', task.id)" />
        </div>
        <div v-if="task.subtasks.length" class="space-y-1">
          <div v-for="subtask in task.subtasks" :key="subtask.id" class="flex items-center gap-2 text-xs">
            <span>• {{ subtask.title }}</span>
            <UButton class="retro-btn aspect-square" size="2xs" icon="pixelarticons:close" aria-label="Remove subtask" @click="$emit('remove-subtask', task.id, subtask.id)" />
          </div>
        </div>
        <div class="flex gap-2">
          <UInput v-model="subtaskDraft" size="xs" placeholder="Add subtask" @keyup.enter="emitCreateSubtask" />
          <UButton size="xs" variant="ghost" @click="emitCreateSubtask">Add</UButton>
        </div>
      </div>
    </div>
  </UCard>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { TaskItem } from '../types';

const props = defineProps<{ task: TaskItem }>();
const emit = defineEmits<{
  'update-title': [taskId: string, title: string];
  'remove': [taskId: string];
  'toggle-done': [taskId: string, done: boolean];
  'move-up': [taskId: string];
  'move-down': [taskId: string];
  'reschedule': [taskId: string, value: string];
  'breakdown': [taskId: string];
  'create-subtask': [taskId: string, title: string];
  'remove-subtask': [taskId: string, subtaskId: string];
}>();

const subtaskDraft = ref('');
const dueDateValue = computed(() => {
  if (!props.task.due_at) return '';
  return new Date(props.task.due_at).toISOString().slice(0, 10);
});

function emitCreateSubtask() {
  const value = subtaskDraft.value.trim();
  if (!value) return;
  // @ts-expect-error emitted signature validated by vue
  emit('create-subtask', props.task.id, value);
  subtaskDraft.value = '';
}
</script>
