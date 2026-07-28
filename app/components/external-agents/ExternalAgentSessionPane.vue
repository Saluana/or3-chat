<template>
  <section
    class="h-full min-h-0 overflow-y-auto bg-[var(--md-surface)] p-3 sm:p-5"
    aria-label="External agent session"
  >
    <div v-if="isLauncher" class="mx-auto max-w-2xl space-y-4">
      <header>
        <h1 class="text-lg font-semibold">New external agent session</h1>
        <p class="text-sm text-[var(--md-on-surface-variant)]">
          Provider choices and safety modes come from the selected host.
        </p>
      </header>
      <ExternalAgentLauncher @launched="replaceWithSession" />
    </div>

    <div v-else-if="loading" class="grid min-h-48 place-items-center text-sm">
      Loading canonical session…
    </div>
    <UAlert
      v-else-if="loadError"
      color="error"
      variant="soft"
      title="Session unavailable"
      :description="loadError"
    />

    <div v-else-if="session" class="mx-auto max-w-5xl space-y-4">
      <header
        class="rounded-[var(--md-border-radius)] border border-[var(--md-outline-variant)] bg-[var(--md-surface-container)] p-4"
      >
        <div
          class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
        >
          <div class="min-w-0">
            <div class="mb-1 flex flex-wrap items-center gap-2">
              <UBadge :color="statusColor" variant="soft">
                {{ session.status.replace("_", " ") }}
              </UBadge>
              <span class="text-xs text-[var(--md-on-surface-variant)]">
                {{ session.runnerId }} · {{ session.hostId }}
              </span>
              <span
                v-if="session.streamState === 'disconnected'"
                class="text-xs text-[var(--md-error)]"
              >
                Live updates disconnected
              </span>
            </div>
            <h1 class="truncate text-lg font-semibold">{{ session.title }}</h1>
          </div>
          <UButton
            v-if="canCancel"
            size="sm"
            color="error"
            variant="soft"
            icon="i-lucide-square"
            :loading="pendingAction === 'cancel'"
            :disabled="Boolean(pendingAction)"
            @click="cancel"
          >
            Cancel
          </UButton>
        </div>
        <p
          v-if="session.actionError"
          class="mt-3 text-sm text-[var(--md-error)]"
        >
          {{ session.actionError }}
        </p>
      </header>

      <UAlert
        v-if="
          snapshot?.connectionState === 'offline' ||
          snapshot?.connectionState === 'disconnected'
        "
        color="warning"
        variant="soft"
        title="Host disconnected"
        description="Reconnect from the Agents sidebar to resume canonical updates."
      />
      <UAlert
        v-if="session.error"
        color="error"
        variant="soft"
        title="Agent error"
        :description="session.error"
      />

      <section v-if="pendingApprovals.length" class="space-y-2">
        <h2 class="text-sm font-semibold">Approvals</h2>
        <article
          v-for="approval in pendingApprovals"
          :key="approval.id"
          class="rounded-[var(--md-border-radius)] border border-[var(--md-extended-color-warning-color)]/50 p-3"
        >
          <strong class="text-sm">{{ approval.title }}</strong>
          <p
            v-if="approval.description"
            class="mt-1 text-sm text-[var(--md-on-surface-variant)]"
          >
            {{ approval.description }}
          </p>
          <div class="mt-3 flex flex-wrap justify-end gap-2">
            <UButton
              size="sm"
              color="error"
              variant="soft"
              :loading="pendingAction === `deny:${approval.id}`"
              :disabled="Boolean(pendingAction) || !canDecideApproval"
              @click="decide('deny', approval.id)"
            >
              Deny
            </UButton>
            <UButton
              size="sm"
              :loading="pendingAction === `approve:${approval.id}`"
              :disabled="Boolean(pendingAction) || !canDecideApproval"
              @click="decide('approve', approval.id)"
            >
              Approve
            </UButton>
          </div>
        </article>
      </section>

      <section v-if="session.artifacts.length" class="space-y-2">
        <h2 class="text-sm font-semibold">Files and diffs</h2>
        <div class="grid gap-2 lg:grid-cols-2">
          <article
            v-for="artifact in session.artifacts"
            :key="artifact.id"
            class="min-w-0 rounded-[var(--md-border-radius)] border border-[var(--md-outline-variant)] p-3"
          >
            <div class="flex items-center justify-between gap-2">
              <strong class="truncate text-sm">{{ artifact.label }}</strong>
              <div class="flex items-center gap-2">
                <UBadge color="neutral" variant="soft">{{
                  artifact.kind
                }}</UBadge>
                <UButton
                  v-if="artifact.artifactId && !artifact.content"
                  size="xs"
                  variant="soft"
                  :loading="pendingAction === `artifact:${artifact.id}`"
                  :disabled="
                    Boolean(pendingAction) || !canLoadArtifact(artifact.id)
                  "
                  @click="loadArtifact(artifact.id)"
                >
                  Load
                </UButton>
              </div>
            </div>
            <pre
              v-if="artifact.content"
              class="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words bg-[var(--md-surface-container-low)] p-2 text-xs"
              >{{ artifact.content }}</pre
            >
          </article>
        </div>
      </section>

      <section v-if="session.output" class="space-y-2">
        <h2 class="text-sm font-semibold">Output</h2>
        <pre
          class="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-[var(--md-border-radius)] bg-[var(--md-surface-container)] p-3 text-sm"
          >{{ session.output }}</pre
        >
      </section>

      <section class="space-y-2">
        <h2 class="text-sm font-semibold">Timeline</h2>
        <div
          v-if="!session.events.length"
          class="rounded-[var(--md-border-radius)] border border-dashed border-[var(--md-outline-variant)] p-6 text-center text-sm text-[var(--md-on-surface-variant)]"
        >
          Waiting for agent events…
        </div>
        <ol v-else class="space-y-2">
          <li
            v-for="event in session.events"
            :key="event.id"
            class="rounded-[var(--md-border-radius)] border border-[var(--md-outline-variant)] bg-[var(--md-surface-container-low)] p-3"
          >
            <div class="flex items-center justify-between gap-3">
              <span class="text-xs font-semibold uppercase tracking-wide">{{
                event.type
              }}</span>
              <time class="text-xs text-[var(--md-on-surface-variant)]">
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

      <form
        class="space-y-2 border-t border-[var(--md-outline-variant)] pt-4"
        @submit.prevent="followUp"
      >
        <label class="text-sm font-semibold" for="external-agent-follow-up"
          >Follow up</label
        >
        <UTextarea
          id="external-agent-follow-up"
          v-model="followUpText"
          :rows="3"
          autoresize
          class="w-full"
          placeholder="Ask the agent to continue, revise, or explain…"
        />
        <div class="flex justify-end">
          <UButton
            type="submit"
            :loading="pendingAction === 'follow-up'"
            :disabled="
              !followUpText.trim() ||
              Boolean(pendingAction) ||
              !connected ||
              !canFollowUp
            "
          >
            Send follow-up
          </UButton>
        </div>
      </form>
      <p
        v-if="connected && !canFollowUp"
        class="text-xs text-[var(--md-on-surface-variant)]"
      >
        Follow-up becomes available after the current turn finishes when the
        provider advertises continuation support.
      </p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import type {
  ExternalAgentSession,
  ExternalAgentTimelineEvent,
} from "~/core/external-agents/types";
import {
  decodeExternalAgentSessionRef,
  encodeExternalAgentSessionRef,
  EXTERNAL_AGENT_LAUNCHER_REF,
  EXTERNAL_AGENT_PANE_APP_ID,
} from "~/core/external-agents/refs";
import { useExternalAgentRuntime } from "~/core/external-agents/runtime";
import { getGlobalMultiPaneApi } from "~/utils/multiPaneApi";

const props = defineProps<{
  paneId: string;
  recordId?: string | null;
}>();

const runtime = useExternalAgentRuntime();
const snapshot = runtime.snapshot;
const loading = ref(false);
const loadError = ref<string | null>(null);
const followUpText = ref("");
const pendingAction = ref<string | null>(null);

const isLauncher = computed(
  () => !props.recordId || props.recordId === EXTERNAL_AGENT_LAUNCHER_REF,
);
const sessionRef = computed(() =>
  decodeExternalAgentSessionRef(props.recordId),
);
const session = computed(() => {
  const refValue = sessionRef.value;
  if (!refValue) return null;
  return (
    snapshot.value?.sessions.find(
      (candidate) =>
        candidate.hostId === refValue.hostId &&
        candidate.remoteSessionId === refValue.remoteSessionId,
    ) ?? null
  );
});
const connected = computed(
  () =>
    snapshot.value?.connectionState === "online" ||
    snapshot.value?.connectionState === "degraded",
);
const canCancel = computed(() =>
  Boolean(session.value && runtime.controller?.canCancel(session.value)),
);
const canDecideApproval = computed(() =>
  Boolean(
    session.value && runtime.controller?.canDecideApproval(session.value),
  ),
);
const canFollowUp = computed(() =>
  Boolean(session.value && runtime.controller?.canFollowUp(session.value)),
);
const pendingApprovals = computed(
  () =>
    session.value?.approvals.filter(
      (approval) => approval.status === "pending",
    ) ?? [],
);
const statusColor = computed(() => {
  if (session.value?.status === "failed") return "error";
  if (session.value?.status === "waiting_approval") return "warning";
  if (session.value?.status === "succeeded") return "success";
  return "neutral";
});

async function load() {
  const controller = runtime.controller;
  const refValue = sessionRef.value;
  if (!controller || !refValue || session.value) return;
  loading.value = true;
  loadError.value = null;
  try {
    await controller.ensureSession(refValue.hostId, refValue.remoteSessionId);
  } catch (cause) {
    loadError.value =
      cause instanceof Error ? cause.message : "Session load failed";
  } finally {
    loading.value = false;
  }
}

async function replaceWithSession(next: ExternalAgentSession) {
  const api = getGlobalMultiPaneApi();
  const index = api?.panes.value.findIndex((pane) => pane.id === props.paneId);
  if (!api || index === undefined || index < 0) return;
  await api.setPaneApp(index, EXTERNAL_AGENT_PANE_APP_ID, {
    recordId: encodeExternalAgentSessionRef({
      hostId: next.hostId,
      remoteSessionId: next.remoteSessionId,
    }),
  });
}

async function cancel() {
  if (!session.value || !runtime.controller) return;
  pendingAction.value = "cancel";
  try {
    await runtime.controller.cancel(session.value.remoteSessionId);
  } catch {
    // The controller preserves canonical state and exposes a retryable error.
  } finally {
    pendingAction.value = null;
  }
}

async function decide(decision: "approve" | "deny", approvalId: string) {
  if (!session.value || !runtime.controller) return;
  pendingAction.value = `${decision}:${approvalId}`;
  try {
    await runtime.controller.decideApproval(
      session.value.remoteSessionId,
      decision,
      approvalId,
    );
  } catch {
    // The controller preserves canonical state and exposes a retryable error.
  } finally {
    pendingAction.value = null;
  }
}

async function followUp() {
  if (!session.value || !runtime.controller) return;
  pendingAction.value = "follow-up";
  try {
    await runtime.controller.followUp(
      session.value.remoteSessionId,
      followUpText.value,
    );
    followUpText.value = "";
  } catch {
    // The controller exposes the canonical failure without clearing input.
  } finally {
    pendingAction.value = null;
  }
}

function canLoadArtifact(artifactId: string): boolean {
  return Boolean(
    session.value &&
    runtime.controller?.canReadArtifact(session.value, artifactId),
  );
}

async function loadArtifact(artifactId: string) {
  if (!session.value || !runtime.controller) return;
  pendingAction.value = `artifact:${artifactId}`;
  try {
    await runtime.controller.readArtifact(
      session.value.remoteSessionId,
      artifactId,
    );
  } catch {
    // The controller exposes a retryable artifact error on canonical state.
  } finally {
    pendingAction.value = null;
  }
}

function eventText(event: ExternalAgentTimelineEvent): string {
  if (event.text) return event.text;
  return Object.entries(event.payload)
    .filter(
      ([key, value]) =>
        value !== undefined && value !== null && key !== "rawType",
    )
    .map(
      ([key, value]) =>
        `${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`,
    )
    .join(" · ");
}

watch(
  () => props.recordId,
  () => void load(),
);
onMounted(() => void load());
</script>
