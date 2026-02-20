<template>
  <div :class="paneFrameClass" class="flex flex-col h-full">
    <!-- Header: pl-14/pr-28 clear the absolute shell overlay buttons (new-pane left, theme+notifications right) -->
    <div :class="headerClass" class="border-b-[length:var(--md-border-width)] border-b-[color:var(--md-border-color)] shrink-0">
      <h3 class="min-w-0 flex-1 font-semibold text-sm text-[var(--md-on-surface)] tracking-wider truncate">{{ headerTitle }}</h3>
      <!-- Sort mode picker -->
      <UPopover :content="{ side: 'bottom', align: 'end', sideOffset: 4 }">
        <UButton size="sm" variant="outline" :icon="sortIcon" trailing-icon="i-lucide-chevron-down" class="shrink-0 theme-btn whitespace-nowrap">
          {{ sortLabel }}
        </UButton>
        <template #content>
          <div class="p-1 w-36 space-y-1">
            <UButton color="neutral" variant="popover" size="sm" icon="i-lucide-grip-vertical" class="w-full justify-start" :class="sortMode === 'manual' ? 'font-semibold' : ''" @click="setSortMode('manual')">Manual</UButton>
            <UButton color="neutral" variant="popover" size="sm" icon="i-lucide-flame" class="w-full justify-start" :class="sortMode === 'hardest' ? 'font-semibold' : ''" @click="runDifficultySort('hardest')">Hardest first</UButton>
            <UButton color="neutral" variant="popover" size="sm" icon="i-lucide-leaf" class="w-full justify-start" :class="sortMode === 'easiest' ? 'font-semibold' : ''" @click="runDifficultySort('easiest')">Easiest first</UButton>
          </div>
        </template>
      </UPopover>
    </div>

    <!-- Scrollable content — max-w-2xl centers on wide single-pane layouts -->
    <div class="flex-1 overflow-y-auto">
      <div class="w-full max-w-2xl mx-auto flex flex-col gap-0">
        <!-- Add task -->
        <div class="px-3 pt-3 pb-2">
          <div class="flex gap-2">
            <UInput v-model="draftTitle" size="sm" placeholder="Add a task…" class="flex-1" @keyup.enter="addNewTask" />
            <UButton size="sm" class="theme-btn" :loading="loading" @click="addNewTask">Add</UButton>
          </div>
          <p v-if="error" class="mt-1 text-xs text-[var(--md-error)]">{{ error }}</p>
        </div>

        <!-- AI fallback notice -->
        <div v-if="fallbackNotice" class="px-3 py-1 text-xs text-[var(--md-on-surface)] opacity-60 bg-[var(--md-surface-container-high)] border-b-[length:var(--md-border-width)] border-b-[color:var(--md-border-color)]">
          {{ fallbackNotice }}
        </div>

        <!-- Task list -->
        <div class="p-3 space-y-2">
          <p v-if="tasks.length === 0" class="text-center text-sm text-[var(--md-on-surface)] opacity-40 py-8">
            No tasks yet.
          </p>
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
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { getGlobalMultiPaneApi } from '~/utils/multiPaneApi';
import TaskItemCard from './TaskItemCard.vue';
import { useTaskListService } from '../composables/useTaskListService';
import { useTaskAiActions } from '../composables/useTaskAiActions';
import type { SortMode } from '../types';

const props = defineProps<{
  paneId?: string;
  recordId?: string | null;
}>();

const multiPaneApi = getGlobalMultiPaneApi();
const isSinglePane = computed(() => {
  if (!multiPaneApi) return true;
  return multiPaneApi.panes.value.length <= 1;
});
const isLastPane = computed(() => {
  if (!multiPaneApi || !props.paneId) return true;
  const panes = multiPaneApi.panes.value;
  const paneIndex = panes.findIndex((pane) => pane.id === props.paneId);
  if (paneIndex < 0) return true;
  return paneIndex === panes.length - 1;
});
const paneFrameClass = computed(() => {
  if (isSinglePane.value || isLastPane.value) return '';
  return [
    'border-t-[length:var(--md-border-width)]',
    'border-r-[length:var(--md-border-width)]',
    'border-t-[color:var(--md-border-color)]',
    'border-r-[color:var(--md-border-color)]',
  ];
});
const headerClass = computed(() => {
  if (isSinglePane.value) {
    return 'h-12 flex flex-nowrap items-center gap-3 pl-14 pr-28';
  }
  return 'h-12 flex flex-nowrap items-center gap-2 pl-3 pr-10';
});

const service = useTaskListService();
const ai = useTaskAiActions();

const listId = ref<string | null>(props.recordId ?? null);
const listTitle = ref('Tasks');
const meta = ref(service.defaultMeta());
const draftTitle = ref('');
const error = ref<string | null>(null);
const loading = ref(false);

const tasks = computed(() => [...meta.value.tasks].sort((a, b) => a.order - b.order));
const sortMode = computed(() => meta.value.sort_mode);
const fallbackNotice = computed(() => meta.value.ai_fallback_notice ?? null);
const headerTitle = computed(() => listTitle.value || 'Tasks');
const sortLabel = computed(() => {
  if (sortMode.value === 'hardest') return 'Hardest';
  if (sortMode.value === 'easiest') return 'Easiest';
  return 'Manual';
});
const sortIcon = computed(() => {
  if (sortMode.value === 'hardest') return 'i-lucide-flame';
  if (sortMode.value === 'easiest') return 'i-lucide-leaf';
  return 'i-lucide-grip-vertical';
});

async function refresh() {
  if (!listId.value) {
    const created = await service.loadOrCreateDefaultList();
    listId.value = created.id;
    listTitle.value = created.title || 'Tasks';
    meta.value = created.meta;
    return;
  }
  const post = await (globalThis as any).__or3PanePluginApi?.posts?.get({ id: listId.value });
  if (post?.ok) {
    listTitle.value = post.post.title || 'Tasks';
    meta.value = service.readMeta(post.post.meta);
    return;
  }
  const fallback = await service.loadOrCreateDefaultList();
  listId.value = fallback.id;
  listTitle.value = fallback.title || 'Tasks';
  meta.value = fallback.meta;
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

watch(
  () => props.recordId,
  async (next) => {
    listId.value = next ?? null;
    error.value = null;
    await refresh();
  },
  { immediate: true }
);
</script>
