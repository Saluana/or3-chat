<template>
  <section
    :class="[
      'h-full min-h-0 overflow-y-auto bg-[var(--md-surface)] px-4 pb-8 md:px-6',
      embedded ? 'pt-4' : 'pt-14',
    ]"
    aria-label="Activity detail"
  >
    <div v-if="loading && !detail" class="mx-auto max-w-4xl space-y-4">
      <USkeleton class="h-24 w-full" />
      <USkeleton v-for="index in 4" :key="index" class="h-20 w-full" />
    </div>

    <UAlert
      v-else-if="error && !detail"
      color="error"
      variant="soft"
      title="Activity unavailable"
      :description="error"
    >
      <template #actions>
        <UButton size="xs" color="error" variant="soft" @click="load">
          Retry
        </UButton>
      </template>
    </UAlert>

    <div v-else-if="detail" class="mx-auto max-w-4xl space-y-4">
      <header
        class="rounded-[var(--md-border-radius)] border border-[var(--md-outline-variant)] bg-[var(--md-surface-container)] p-4"
      >
        <div
          class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
        >
          <div>
            <div class="mb-1 flex flex-wrap items-center gap-2">
              <UBadge :color="statusColor(detail.status)" variant="soft">
                {{ detail.status.replace("_", " ") }}
              </UBadge>
              <span class="text-xs text-[var(--md-on-surface-variant)]">
                {{ sourceLabel }} · {{ detail.kind }}
              </span>
            </div>
            <h1 class="text-lg font-semibold text-[var(--md-on-surface)]">
              {{ detail.title }}
            </h1>
            <p
              v-if="detail.summary"
              class="mt-1 text-sm text-[var(--md-on-surface-variant)]"
            >
              {{ detail.summary }}
            </p>
          </div>
          <div v-if="detail.actions.length" class="flex flex-wrap gap-2">
            <UButton
              v-for="action in detail.actions"
              :key="action"
              size="sm"
              :color="
                action === 'deny' || action === 'cancel' ? 'error' : 'primary'
              "
              :variant="action === 'open-source' ? 'ghost' : 'soft'"
              :loading="pendingAction === action"
              :disabled="Boolean(pendingAction)"
              @click="runAction(action)"
            >
              {{ actionLabel(action) }}
            </UButton>
          </div>
        </div>
        <p v-if="actionError" class="mt-3 text-sm text-[var(--md-error)]">
          {{ actionError }}
        </p>
        <p v-if="streamError" class="mt-3 text-xs text-[var(--md-error)]">
          Live updates disconnected: {{ streamError }}
        </p>
      </header>

      <UAlert
        v-if="detail.error"
        color="error"
        variant="soft"
        title="Run failed"
        :description="detail.error"
      />

      <section v-if="detail.approvals?.length" class="space-y-2">
        <h2 class="text-sm font-semibold">Approvals</h2>
        <article
          v-for="approval in detail.approvals"
          :key="approval.id"
          class="rounded-[var(--md-border-radius)] border border-[var(--md-extended-color-warning-color)]/40 p-3"
        >
          <div class="flex items-center justify-between gap-2">
            <strong class="text-sm">{{ approval.title }}</strong>
            <UBadge color="warning" variant="soft">{{
              approval.status
            }}</UBadge>
          </div>
          <p
            v-if="approval.description"
            class="mt-1 text-sm text-[var(--md-on-surface-variant)]"
          >
            {{ approval.description }}
          </p>
        </article>
      </section>

      <section v-if="detail.artifacts?.length" class="space-y-2">
        <h2 class="text-sm font-semibold">Artifacts</h2>
        <div class="grid gap-2 sm:grid-cols-2">
          <a
            v-for="artifact in detail.artifacts"
            :key="artifact.id"
            :href="artifact.href"
            class="rounded-[var(--md-border-radius)] border border-[var(--md-outline-variant)] p-3 hover:bg-[var(--md-surface-variant)]"
          >
            <span class="text-sm font-medium">{{ artifact.label }}</span>
            <span class="ml-2 text-xs text-[var(--md-outline)]">{{
              artifact.kind
            }}</span>
          </a>
        </div>
      </section>

      <section v-if="detail.output" class="space-y-2">
        <h2 class="text-sm font-semibold">Output</h2>
        <pre
          class="max-h-96 overflow-auto whitespace-pre-wrap rounded-[var(--md-border-radius)] bg-[var(--md-surface-container)] p-3 text-sm"
          >{{ detail.output }}</pre
        >
      </section>

      <section class="space-y-2">
        <h2 class="text-sm font-semibold">Timeline</h2>
        <div
          v-if="!timelineEvents.length"
          class="rounded-[var(--md-border-radius)] border border-dashed border-[var(--md-outline-variant)] p-6 text-center text-sm text-[var(--md-on-surface-variant)]"
        >
          No timeline events yet.
        </div>
        <ol v-else class="space-y-2">
          <li
            v-for="event in timelineEvents"
            :key="event.id"
            class="rounded-[var(--md-border-radius)] border border-[var(--md-outline-variant)] bg-[var(--md-surface-container-low)] p-3"
          >
            <div class="flex items-center justify-between gap-3">
              <span class="text-xs font-semibold uppercase tracking-wide">
                {{ event.type }}
              </span>
              <time
                class="text-xs text-[var(--md-outline)]"
                :datetime="event.occurredAt"
              >
                {{ new Date(event.occurredAt).toLocaleString() }}
              </time>
            </div>
            <p
              class="mt-1 whitespace-pre-wrap break-words text-sm text-[var(--md-on-surface-variant)]"
            >
              {{ eventText(event) }}
            </p>
          </li>
        </ol>
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type {
  ActivityEvent,
  ActivityRunAction,
  ActivityRunDetail,
  ActivityRunStatus,
} from "~/core/activity/contract";
import {
  getActivityRegistry,
  type ActivitySubscription,
} from "~/core/activity/registry";
import { ActivityTimeline } from "~/core/activity/timeline";
import { decodeActivityRunRef } from "~/core/activity/run-ref";

const props = defineProps<{
  paneId: string;
  recordId?: string | null;
  embedded?: boolean;
}>();

const embedded = computed(() => props.embedded === true);

const registry = getActivityRegistry();
const runRef = computed(() => decodeActivityRunRef(props.recordId));
const detail = ref<ActivityRunDetail | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const streamError = ref<string | null>(null);
const actionError = ref<string | null>(null);
const pendingAction = ref<ActivityRunAction | null>(null);
const timelineEvents = ref<ActivityEvent[]>([]);
let timeline = new ActivityTimeline();
let subscription: ActivitySubscription | undefined;
let reloadTimer: ReturnType<typeof setTimeout> | undefined;

const sourceLabel = computed(
  () =>
    registry.get(runRef.value?.sourceId ?? "")?.label ??
    runRef.value?.sourceId ??
    "Activity",
);

async function load() {
  const refValue = runRef.value;
  if (!refValue) {
    error.value = "Invalid activity reference";
    loading.value = false;
    return;
  }
  loading.value = true;
  const result = await registry.getRun(refValue.sourceId, refValue.runId);
  if (!result.ok) {
    error.value = result.error.message;
    loading.value = false;
    return;
  }
  detail.value = result.value;
  error.value = null;
  timeline = new ActivityTimeline();
  for (const event of result.value.events) timeline.ingest(event);
  timelineEvents.value = [...timeline.events];
  loading.value = false;
}

function subscribe() {
  subscription?.dispose();
  const refValue = runRef.value;
  if (!refValue) return;
  subscription = registry.subscribe({
    sourceIds: [refValue.sourceId],
    runId: refValue.runId,
    onEvent(event) {
      streamError.value = null;
      if (timeline.ingest(event)) {
        timelineEvents.value = [...timeline.events];
      }
      if (event.type === "status") scheduleReload();
    },
    onError(nextError) {
      streamError.value = nextError.message;
    },
  });
}

function scheduleReload() {
  if (reloadTimer) clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => void load(), 150);
}

async function runAction(action: ActivityRunAction) {
  const refValue = runRef.value;
  if (!refValue) return;
  pendingAction.value = action;
  actionError.value = null;
  const approval = detail.value?.approvals?.find(
    (item) => item.status === "pending",
  );
  const result = await registry.executeAction(refValue.sourceId, {
    runId: refValue.runId,
    action,
    payload:
      action === "approve" || action === "deny"
        ? {
            approvalId: approval?.id,
            jobId: approval?.metadata?.jobId,
          }
        : undefined,
  });
  if (!result.ok) actionError.value = result.error.message;
  pendingAction.value = null;
  if (result.ok) await load();
}

function statusColor(status: ActivityRunStatus) {
  if (status === "failed") return "error";
  if (status === "waiting_approval") return "warning";
  if (status === "succeeded") return "success";
  return "neutral";
}

function actionLabel(action: ActivityRunAction): string {
  if (action === "open-source") return "Open source";
  return `${action.charAt(0).toUpperCase()}${action.slice(1)}`;
}

function eventText(event: ActivityEvent): string {
  const payload = event.payload;
  for (const key of [
    "text",
    "message",
    "prompt",
    "error",
    "output",
    "title",
    "summary",
  ]) {
    const value = payload[key];
    if (
      typeof value === "string" &&
      value.trim() &&
      !/(?:https?:\/\/|set-cookie|authorization|headers?|cookie|stack trace)/i.test(
        value,
      )
    ) {
      return value.slice(0, 2_000);
    }
  }
  if (event.type === "status") return "Run status updated";
  if (event.type === "tool") return "Agent activity updated";
  if (event.type === "approval") return "Approval state updated";
  if (event.type === "artifact") return "Artifact produced";
  if (event.type === "error") return "The run encountered an error";
  if (event.type === "message") return "Response updated";
  return "Activity updated";
}

watch(
  () => props.recordId,
  async () => {
    await load();
    subscribe();
  },
);

onMounted(async () => {
  await load();
  subscribe();
});

onBeforeUnmount(() => {
  if (reloadTimer) clearTimeout(reloadTimer);
  subscription?.dispose();
});
</script>
