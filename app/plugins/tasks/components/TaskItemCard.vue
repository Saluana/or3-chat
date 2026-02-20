<template>
  <div
    class="bg-[var(--md-surface)]/25 backdrop-blur-lg border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius)]"
    :class="task.status === 'done' ? 'opacity-60' : ''"
  >
    <!-- Title row -->
    <div class="flex items-center gap-2 px-3 py-2.5">
      <UCheckbox :model-value="task.status === 'done'" size="sm" class="shrink-0 self-center" @update:model-value="$emit('toggle-done', task.id, $event === true)" />
      <UInput
        :model-value="task.title"
        size="sm"
        variant="none"
        class="flex-1 min-w-0 bg-transparent"
        :class="task.status === 'done' ? 'line-through opacity-60' : ''"
        @update:model-value="$emit('update-title', task.id, String($event))"
      />
      <UBadge v-if="task.label && task.label !== 'uncategorized'" color="neutral" variant="soft" size="sm" class="shrink-0 hidden sm:inline-flex self-center">{{ task.label }}</UBadge>
      <!-- Actions -->
      <div class="flex items-center gap-0.5 shrink-0 self-center">
        <UButton size="xs" :square="true" variant="ghost" icon="i-lucide-chevron-up" aria-label="Move up" @click="$emit('move-up', task.id)" />
        <UButton size="xs" :square="true" variant="ghost" icon="i-lucide-chevron-down" aria-label="Move down" @click="$emit('move-down', task.id)" />
        <UButton size="xs" :square="true" variant="ghost" color="error" icon="i-lucide-trash-2" aria-label="Remove task" @click="$emit('remove', task.id)" />
      </div>
    </div>

    <!-- Secondary controls row -->
    <div class="flex flex-wrap items-center gap-1 px-3 pb-2">
      <!-- Due date: button triggers hidden native input -->
      <button
        class="flex items-center gap-1.5 h-7 px-2 text-xs rounded-[var(--md-border-radius)] hover:bg-[var(--md-surface-hover)] transition-colors text-[var(--md-primary)] cursor-pointer relative overflow-hidden"
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
      <UButton size="sm" variant="ghost" color="primary" leading-icon="i-lucide-sparkles" @click="$emit('breakdown', task.id)">
        Break down
      </UButton>
    </div>

    <!-- Subtasks -->
    <div v-if="task.subtasks.length" class="px-3 pt-2 pb-1 space-y-0.5">
      <div
        v-for="subtask in task.subtasks"
        :key="subtask.id"
        class="group flex items-center gap-2 py-1 px-2 rounded-[var(--md-border-radius)] hover:bg-[var(--md-surface-hover)] transition-colors"
      >
        <button
          type="button"
          class="shrink-0 w-4 h-4 flex items-center justify-center text-[var(--md-primary)] text-xs leading-none"
          aria-label="Toggle subtask done"
          @click="$emit('toggle-subtask', task.id, subtask.id)"
        >›</button>
        <button
          type="button"
          class="flex-1 text-left text-xs leading-5 text-[var(--md-on-surface)] transition-opacity"
          :class="subtask.done ? 'line-through opacity-50' : ''"
          @click="$emit('toggle-subtask', task.id, subtask.id)"
        >{{ subtask.title }}</button>
        <button
          type="button"
          class="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity w-4 h-4 flex items-center justify-center rounded text-[var(--md-on-surface)] hover:text-[var(--md-error)] hover:bg-[var(--md-error)]/10 text-xs leading-none"
          aria-label="Remove subtask"
          @click="$emit('remove-subtask', task.id, subtask.id)"
        >✕</button>
      </div>
    </div>

    <!-- Add subtask row -->
    <div class="flex gap-1.5 px-3 py-2">
      <UInput v-model="subtaskDraft" size="sm" variant="none" placeholder="Add subtask…" class="flex-1 bg-transparent" @keyup.enter="emitCreateSubtask" />
      <UButton size="sm" variant="ghost" color="primary" @click="emitCreateSubtask">Add</UButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { TaskItem } from '../types';

const props = defineProps<{ task: TaskItem }>();
const emit = defineEmits<{
  (e: 'update-title', taskId: string, title: string): void;
  (e: 'remove', taskId: string): void;
  (e: 'toggle-done', taskId: string, done: boolean): void;
  (e: 'move-up', taskId: string): void;
  (e: 'move-down', taskId: string): void;
  (e: 'reschedule', taskId: string, value: string): void;
  (e: 'breakdown', taskId: string): void;
  (e: 'create-subtask', taskId: string, title: string): void;
  (e: 'toggle-subtask', taskId: string, subtaskId: string): void;
  (e: 'remove-subtask', taskId: string, subtaskId: string): void;
}>();

const subtaskDraft = ref('');
const dateInputRef = ref<HTMLInputElement | null>(null);

function formatDateForInput(ts: number): string {
  const date = new Date(ts);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const dueDateValue = computed(() => {
  if (!props.task.due_at) return '';
  return formatDateForInput(props.task.due_at);
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
