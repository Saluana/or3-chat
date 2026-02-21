<template>
  <div
    class="group/card transition-all duration-200"
    :class="task.status === 'done' ? 'opacity-50 grayscale-[50%] bg-transparent border-dashed border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius)]' : 'bg-[var(--md-surface)]/40 backdrop-blur-md border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius)] shadow-sm'"
  >
    <!-- Title row -->
    <div class="flex items-center gap-3 px-4 pt-4 pb-2">
      <UCheckbox :model-value="task.status === 'done'" :ui="{ base: 'w-4 h-4 transition-colors' }" class="shrink-0 self-center" @update:model-value="$emit('toggle-done', task.id, $event === true)" />
      <div class="flex-1 min-w-0 flex flex-col">
        <UInput
          :model-value="task.title"
          size="sm"
          variant="none"
          :ui="{ base: 'ring-0 shadow-none border-0 font-medium text-[color:var(--md-on-surface)] transition-colors p-0' }"
          class="w-full bg-transparent"
          :class="task.status === 'done' ? 'line-through text-[color:var(--md-on-surface-variant)]' : ''"
          @update:model-value="$emit('update-title', task.id, String($event))"
        />
        <!-- Inline metadata (Due Date) -->
        <div v-if="dueDateValue" class="flex items-center gap-1.5 mt-0.5 text-[10px] text-[var(--md-primary)] opacity-80">
          <UIcon :name="iconCalendar" class="w-3 h-3 shrink-0" />
          <span>{{ formattedDueDate }}</span>
        </div>
      </div>
      <UBadge v-if="task.label && task.label !== 'uncategorized'" color="neutral" variant="soft" size="sm" class="shrink-0 hidden sm:inline-flex self-center">{{ task.label }}</UBadge>
      <!-- Actions -->
      <div class="flex items-center gap-0.5 shrink-0 self-center opacity-0 group-hover/card:opacity-100 focus-within:opacity-100 transition-opacity">
        <!-- Due date picker -->
        <UTooltip :delay-duration="0" text="Set due date">
          <UButton
            size="xs"
            :square="true"
            variant="ghost"
            :icon="iconCalendar"
            aria-label="Set due date"
            class="relative overflow-hidden"
            @click="dateInputRef?.showPicker ? dateInputRef.showPicker() : dateInputRef?.click()"
          >
            <input
              ref="dateInputRef"
              type="date"
              :value="dueDateValue"
              class="sr-only"
              tabindex="-1"
              @change="$emit('reschedule', task.id, ($event.target as HTMLInputElement).value)"
            />
          </UButton>
        </UTooltip>
        <!-- Breakdown action -->
        <UTooltip :delay-duration="0" :text="breakdownLoading ? 'Breaking down…' : 'Break down with AI'">
          <UButton
            size="xs"
            :square="true"
            variant="ghost"
            color="primary"
            :icon="iconSparkles"
            aria-label="Break down task"
            :loading="breakdownLoading"
            :disabled="aiDisabled || breakdownLoading"
            @click="$emit('breakdown', task.id)"
          />
        </UTooltip>
        <div class="w-px h-4 bg-[var(--md-border-color)]/30 mx-1"></div>
        <UTooltip :delay-duration="0" text="Move up">
          <UButton size="xs" :square="true" variant="ghost" :icon="iconChevronUp" aria-label="Move up" @click="$emit('move-up', task.id)" />
        </UTooltip>
        <UTooltip :delay-duration="0" text="Move down">
          <UButton size="xs" :square="true" variant="ghost" :icon="iconChevronDown" aria-label="Move down" @click="$emit('move-down', task.id)" />
        </UTooltip>
        <UTooltip :delay-duration="0" text="Delete task">
          <UButton size="xs" :square="true" variant="ghost" color="error" :icon="iconTrash" aria-label="Remove task" class="hover:bg-[var(--md-error)]/10" @click="$emit('remove', task.id)" />
        </UTooltip>
      </div>
    </div>

    <!-- Subtasks & Add Subtask -->
    <div class="px-4 pb-3">
      <div class="ml-7" :class="task.subtasks.length ? 'pl-3 border-l border-[var(--md-border-color)]/20 space-y-1' : 'pl-1'">
        <div
          v-for="subtask in task.subtasks"
          :key="subtask.id"
          class="group flex items-center gap-2 py-1.5 px-2 rounded-[var(--md-border-radius)] hover:bg-[var(--md-primary)]/10 transition-colors"
        >
          <button
            type="button"
            class="shrink-0 w-4 h-4 flex items-center justify-center text-[var(--md-primary)] text-xs leading-none"
            aria-label="Toggle subtask done"
            @click="$emit('toggle-subtask', task.id, subtask.id)"
          >
            <UIcon :name="iconChevronRight" class="w-3 h-3" />
          </button>
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
          >
            <UIcon :name="iconClose" class="w-3 h-3" />
          </button>
        </div>

        <!-- Add subtask inline -->
        <div class="flex items-center gap-2 py-1 px-2 mt-1 opacity-60 focus-within:opacity-100 transition-opacity" :class="!task.subtasks.length ? '-ml-2' : ''">
          <UIcon :name="iconPlus" class="w-3.5 h-3.5 shrink-0 text-[var(--md-primary)]" />
          <UInput v-model="subtaskDraft" size="sm" variant="none" :ui="{ base: 'ring-0 shadow-none border-0 p-0 text-sm' }" placeholder="Add subtask…" class="flex-1 bg-transparent" @keyup.enter="emitCreateSubtask" />
          <UButton :class="subtaskDraft.trim() ? 'opacity-100' : 'opacity-0 pointer-events-none'" size="sm" variant="ghost" color="primary" class="transition-opacity" @click="emitCreateSubtask">Add</UButton>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useIcon } from '~/composables/useIcon';
import type { TaskItem } from '../types';

const props = withDefaults(defineProps<{
  task: TaskItem;
  breakdownLoading?: boolean;
  aiDisabled?: boolean;
}>(), {
  breakdownLoading: false,
  aiDisabled: false,
});
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
const iconCalendar = useIcon('ui.calendar');
const iconSparkles = useIcon('ui.sparkles');
const iconChevronUp = useIcon('ui.chevron.up');
const iconChevronDown = useIcon('ui.chevron.down');
const iconChevronRight = useIcon('ui.chevron.right');
const iconPlus = useIcon('ui.plus');
const iconTrash = useIcon('ui.trash');
const iconClose = useIcon('ui.close');

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
