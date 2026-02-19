<template>
  <div class="p-3 space-y-3">
    <div class="flex flex-wrap items-center gap-2">
      <h3 class="font-semibold">Tasks</h3>
      <UButton size="xs" :variant="sortMode==='manual'?'solid':'soft'" @click="setSortMode('manual')">Manual</UButton>
      <UButton size="xs" :variant="sortMode==='hardest'?'solid':'soft'" @click="runDifficultySort('hardest')">Hardest</UButton>
      <UButton size="xs" :variant="sortMode==='easiest'?'solid':'soft'" @click="runDifficultySort('easiest')">Easiest</UButton>
      <span v-if="fallbackNotice" class="text-xs opacity-80">{{ fallbackNotice }}</span>
    </div>

    <UForm :state="{}" @submit.prevent="addNewTask">
      <div class="flex gap-2">
        <UInput v-model="draftTitle" placeholder="Add a task" class="flex-1" />
        <UButton type="submit">Add</UButton>
      </div>
    </UForm>

    <div v-if="error" class="text-sm text-red-500">{{ error }}</div>

    <div class="space-y-2">
      <TaskItemCard
        v-for="task in tasks"
        :key="task.id"
        :task="task"
        @update-title="onUpdateTitle"
        @toggle-done="onToggleDone"
        @remove="onRemove"
        @move-up="moveTask($event, -1)"
        @move-down="moveTask($event, 1)"
        @reschedule="onReschedule"
        @breakdown="onBreakdown"
        @create-subtask="onCreateSubtask"
        @remove-subtask="onRemoveSubtask"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import TaskItemCard from './TaskItemCard.vue';
import { useTaskListService } from '../composables/useTaskListService';
import { useTaskAiActions } from '../composables/useTaskAiActions';
import type { SortMode } from '../types';

const props = defineProps<{
  recordId?: string | null;
}>();

const service = useTaskListService();
const ai = useTaskAiActions();

const listId = ref<string | null>(props.recordId ?? null);
const meta = ref(service.defaultMeta());
const draftTitle = ref('');
const error = ref<string | null>(null);
const loading = ref(false);

const tasks = computed(() => [...meta.value.tasks].sort((a, b) => a.order - b.order));
const sortMode = computed(() => meta.value.sort_mode);
const fallbackNotice = computed(() => meta.value.ai_fallback_notice ?? null);

async function refresh() {
  if (!listId.value) {
    const created = await service.loadOrCreateDefaultList();
    listId.value = created.id;
    meta.value = created.meta;
    return;
  }
  const post = await (globalThis as any).__or3PanePluginApi?.posts?.get({ id: listId.value });
  if (post?.ok) meta.value = service.readMeta(post.post.meta);
}

async function addNewTask() {
  if (!listId.value || !draftTitle.value.trim()) return;
  loading.value = true;
  try {
    await service.addTask(listId.value, { title: draftTitle.value });
    draftTitle.value = '';
    await refresh();
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to add task';
  } finally {
    loading.value = false;
  }
}

async function onUpdateTitle(taskId: string, title: string) {
  if (!listId.value) return;
  await service.updateTask(listId.value, taskId, { title });
  await refresh();
}

async function onToggleDone(taskId: string, done: boolean) {
  if (!listId.value) return;
  await service.updateTask(listId.value, taskId, { status: done ? 'done' : 'todo' });
  await refresh();
}

async function onRemove(taskId: string) {
  if (!listId.value) return;
  await service.removeTask(listId.value, taskId);
  await refresh();
}

async function moveTask(taskId: string, delta: number) {
  if (!listId.value) return;
  const ordered = tasks.value.map((task) => task.id);
  const index = ordered.indexOf(taskId);
  const nextIndex = index + delta;
  if (index < 0 || nextIndex < 0 || nextIndex >= ordered.length) return;
  const [id] = ordered.splice(index, 1);
  ordered.splice(nextIndex, 0, id);
  await service.reorderTasks(listId.value, ordered);
  await refresh();
}

async function onReschedule(taskId: string, value: string) {
  if (!listId.value) return;
  const dueAt = value ? new Date(`${value}T00:00:00`).getTime() : null;
  await service.rescheduleTask(listId.value, taskId, dueAt);
  await refresh();
}

async function onBreakdown(taskId: string) {
  if (!listId.value) return;
  const task = tasks.value.find((entry) => entry.id === taskId);
  if (!task) return;
  const result = await ai.breakTaskDown({ title: task.title, notes: task.notes, count: 5 });
  if (!result.ok) {
    error.value = result.error;
    return;
  }
  for (const step of result.steps) {
    await service.addSubtask(listId.value, taskId, step);
  }
  await refresh();
}

async function onCreateSubtask(taskId: string, title: string) {
  if (!listId.value) return;
  await service.addSubtask(listId.value, taskId, title);
  await refresh();
}

async function onRemoveSubtask(taskId: string, subtaskId: string) {
  if (!listId.value) return;
  await service.removeSubtask(listId.value, taskId, subtaskId);
  await refresh();
}

async function runDifficultySort(mode: 'hardest' | 'easiest') {
  if (!listId.value) return;
  const analysis = await ai.analyzeDifficulty(tasks.value);
  for (const rating of analysis.ratings) {
    await service.updateTask(listId.value, rating.task_id, {
      difficulty_score: rating.score,
      difficulty_reason: rating.reason,
    });
  }
  await service.updateMetaAtomic(listId.value, (current) => ({ ...current, ai_fallback_notice: analysis.fallbackNotice }));
  await service.sortByDifficulty(listId.value, mode);
  await refresh();
}

async function setSortMode(mode: SortMode) {
  if (!listId.value) return;
  await service.updateMetaAtomic(listId.value, (current) => ({ ...current, sort_mode: mode }));
  await refresh();
}

onMounted(async () => {
  await refresh();
});
</script>
