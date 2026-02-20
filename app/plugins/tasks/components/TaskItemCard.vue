<template>
  <div
    class="bg-[var(--md-surface)] border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius)] theme-shadow"
    :class="task.status === 'done' ? 'opacity-60' : ''"
  >
    <!-- Title row -->
    <div class="flex items-center gap-2 px-3 pt-3 pb-2">
      <UCheckbox :model-value="task.status === 'done'" class="shrink-0" @update:model-value="$emit('toggle-done', task.id, $event)" />
      <UInput
        :model-value="task.title"
        size="sm"
        class="flex-1 min-w-0"
        :class="task.status === 'done' ? 'line-through' : ''"
        @update:model-value="$emit('update-title', task.id, String($event))"
      />
      <UBadge v-if="task.label && task.label !== 'uncategorized'" color="neutral" variant="soft" size="sm" class="shrink-0 hidden sm:inline-flex">{{ task.label }}</UBadge>
      <!-- Actions -->
      <div class="flex items-center gap-0.5 shrink-0">
        <UButton size="xs" :square="true" variant="ghost" icon="i-lucide-chevron-up" class="theme-btn" aria-label="Move up" @click="$emit('move-up', task.id)" />
        <UButton size="xs" :square="true" variant="ghost" icon="i-lucide-chevron-down" class="theme-btn" aria-label="Move down" @click="$emit('move-down', task.id)" />
        <UButton size="xs" :square="true" variant="ghost" color="error" icon="i-lucide-trash-2" class="theme-btn" aria-label="Remove task" @click="$emit('remove', task.id)" />
      </div>
    </div>

    <!-- Secondary controls row: flex-wrap handles narrow panes gracefully -->
    <div class="flex flex-wrap items-center gap-2 px-3 pb-3 border-b-[length:var(--md-border-width)] border-b-[color:var(--md-border-color)]">
      <!-- Due date: button triggers hidden native input -->
      <button
        class="flex items-center gap-1.5 h-[32px] px-2 text-xs border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius)] bg-[var(--md-surface)] hover:bg-[var(--md-surface-hover)] transition-colors text-[var(--md-on-surface)] opacity-70 hover:opacity-100 theme-shadow relative overflow-hidden"
        @click="dateInputRef?.showPicker ? dateInputRef.showPicker() : dateInputRef?.click()"
      >
        <UIcon name="i-lucide-calendar" class="w-3.5 h-3.5 shrink-0" />
        <span>{{ dueDateValue ? formattedDueDate : 'Due date' }}</span>
        <input
          ref="dateInputRef"
          type="date"
          :value="dueDateValue"
          class="sr-only"
          tabindex="-1"
          @change="$emit('reschedule', task.id, ($event.target as HTMLInputElement).value)"
        />
      </button>
      <UButton size="sm" variant="outline" class="theme-btn" leading-icon="i-lucide-sparkles" @click="$emit('breakdown', task.id)">
        Break down
      </UButton>
    </div>

    <!-- Subtasks -->
    <div v-if="task.subtasks.length" class="px-3 pt-2 pb-1 space-y-0.5">
      <div
        v-for="subtask in task.subtasks"
        :key="subtask.id"
        class="group flex items-start gap-2 py-1 px-2 rounded-[var(--md-border-radius)] hover:bg-[var(--md-surface-hover)] transition-colors"
      >
        <span class="text-[var(--md-primary)] text-xs mt-0.5 shrink-0">›</span>
        <span class="flex-1 text-xs leading-5 text-[var(--md-on-surface)]">{{ subtask.title }}</span>
        <button
          class="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity w-4 h-4 flex items-center justify-center rounded text-[var(--md-on-surface)] hover:text-[var(--md-error)] hover:bg-[var(--md-error)]/10 text-xs"
          aria-label="Remove subtask"
          @click="$emit('remove-subtask', task.id, subtask.id)"
        >✕</button>
      </div>
    </div>

    <!-- Add subtask row -->
    <div class="flex gap-1.5 px-3 py-2" :class="task.subtasks.length ? 'border-t-[length:var(--md-border-width)] border-t-[color:var(--md-border-color)]' : ''">
      <UInput v-model="subtaskDraft" size="sm" placeholder="Add subtask…" class="flex-1" @keyup.enter="emitCreateSubtask" />
      <UButton size="sm" variant="outline" class="theme-btn" @click="emitCreateSubtask">Add</UButton>
    </div>
  </div>
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
const dateInputRef = ref<HTMLInputElement | null>(null);

const dueDateValue = computed(() => {
  if (!props.task.due_at) return '';
  return new Date(props.task.due_at).toISOString().slice(0, 10);
});

const formattedDueDate = computed(() => {
  if (!props.task.due_at) return '';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(props.task.due_at));
});

function emitCreateSubtask() {
  const value = subtaskDraft.value.trim();
  if (!value) return;
  emit('create-subtask', props.task.id, value);
  subtaskDraft.value = '';
}
</script>
