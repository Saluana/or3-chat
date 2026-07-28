<template>
  <section
    class="relative flex h-full min-h-0 flex-col overflow-hidden bg-[var(--md-surface)]"
    aria-label="External agent conversation"
  >
    <template v-if="isLauncher">
      <div class="min-h-0 flex-1 overflow-y-auto">
        <div
          class="mx-auto flex min-h-full max-w-3xl flex-col items-center justify-center px-5 pb-40 pt-12 text-center"
        >
          <div
            class="mb-5 grid size-14 place-items-center rounded-[var(--md-border-radius)] bg-[var(--md-surface-container)]"
          >
            <UIcon name="i-lucide-bot" class="size-7" />
          </div>
          <h1 class="text-2xl font-semibold">What should the agent do?</h1>
          <p class="mt-2 max-w-xl text-sm text-[var(--md-on-surface-variant)]">
            Agents work like chat, with tools, approvals, and files appearing
            alongside the conversation.
          </p>
        </div>
      </div>
      <div
        class="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-[var(--md-surface)] via-[var(--md-surface)] to-transparent px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-12"
      >
        <div class="pointer-events-auto mx-auto max-w-3xl">
          <ExternalAgentLauncher @launched="replaceWithSession" />
        </div>
      </div>
    </template>

    <div
      v-else-if="loading"
      class="grid min-h-0 flex-1 place-items-center text-sm text-[var(--md-on-surface-variant)]"
    >
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
        Loading conversation…
      </div>
    </div>

    <div
      v-else-if="loadError"
      class="grid min-h-0 flex-1 place-items-center p-6"
    >
      <UAlert
        color="error"
        variant="soft"
        title="Conversation unavailable"
        :description="loadError"
      />
    </div>

    <template v-else-if="session && projection">
      <header
        class="z-10 flex shrink-0 items-center gap-3 border-b border-[var(--md-outline-variant)] bg-[var(--md-surface)]/95 px-3 py-2 backdrop-blur sm:px-5"
      >
        <div class="min-w-0 flex-1">
          <div class="flex min-w-0 items-center gap-2">
            <h1 class="truncate text-sm font-semibold">{{ session.title }}</h1>
            <span
              class="hidden truncate text-xs text-[var(--md-on-surface-variant)] sm:inline"
            >
              {{ runnerLabel }}
            </span>
          </div>
          <p
            v-if="connectionWarning"
            class="truncate text-xs text-[var(--md-error)]"
          >
            {{ connectionWarning }}
          </p>
        </div>
        <UBadge :color="statusColor" variant="soft">
          {{ statusLabel }}
        </UBadge>
        <UButton
          v-if="canCancel"
          size="sm"
          color="error"
          variant="ghost"
          icon="i-lucide-square"
          aria-label="Stop agent"
          :loading="pendingAction === 'cancel'"
          :disabled="Boolean(pendingAction)"
          @click="cancel"
        />
        <UPopover>
          <UButton
            size="sm"
            color="neutral"
            variant="ghost"
            icon="i-lucide-ellipsis"
            aria-label="Conversation options"
          />
          <template #content>
            <div class="w-72 space-y-2 p-3">
              <p class="text-xs text-[var(--md-on-surface-variant)]">
                Agent activity is summarized here. Operational details remain
                available for troubleshooting.
              </p>
              <details v-if="projection.diagnostics.length">
                <summary class="cursor-pointer text-xs font-medium">
                  Technical details
                </summary>
                <ol class="mt-2 max-h-56 space-y-2 overflow-y-auto">
                  <li
                    v-for="entry in projection.diagnostics"
                    :key="entry.id"
                    class="text-xs text-[var(--md-on-surface-variant)]"
                  >
                    {{ entry.summary }}
                  </li>
                </ol>
              </details>
            </div>
          </template>
        </UPopover>
      </header>

      <div ref="scroller" class="min-h-0 flex-1 overflow-y-auto">
        <main
          class="mx-auto flex w-full max-w-[768px] flex-col px-2 pb-48 pt-3 sm:px-4"
          aria-live="polite"
        >
          <div
            v-if="!projection.turns.length"
            class="grid min-h-52 place-items-center text-sm text-[var(--md-on-surface-variant)]"
          >
            Waiting for the conversation to begin…
          </div>

          <article
            v-for="turn in projection.turns"
            :key="turn.id"
            class="flex flex-col"
          >
            <ChatMessage
              v-if="turn.userMessage"
              :message="turn.userMessage"
              :interactive="false"
            />
            <ChatMessage
              v-if="turn.assistantMessage"
              :message="turn.assistantMessage"
              :interactive="false"
            />

            <div
              v-for="approval in turn.approvals"
              :key="approval.id"
              class="mx-2 mb-4 rounded-[var(--md-border-radius)] border border-[var(--md-extended-color-warning-color)]/60 bg-[var(--md-surface-container-low)] p-3 sm:mx-5"
            >
              <div class="flex items-start gap-3">
                <UIcon
                  name="i-lucide-shield-alert"
                  class="mt-0.5 size-5 shrink-0"
                />
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <strong class="text-sm">{{ approval.title }}</strong>
                    <UBadge
                      :color="
                        approval.status === 'pending'
                          ? 'warning'
                          : approval.status === 'approved'
                            ? 'success'
                            : 'neutral'
                      "
                      size="xs"
                      variant="soft"
                    >
                      {{ approval.status }}
                    </UBadge>
                  </div>
                  <p
                    v-if="approval.description"
                    class="mt-1 whitespace-pre-wrap text-sm text-[var(--md-on-surface-variant)]"
                  >
                    {{ approval.description }}
                  </p>
                  <div
                    v-if="approval.status === 'pending'"
                    class="mt-3 flex justify-end gap-2"
                  >
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
                </div>
              </div>
            </div>

            <div
              v-if="turn.artifacts.length"
              class="mx-2 mb-5 grid gap-2 sm:mx-5 sm:grid-cols-2"
            >
              <article
                v-for="artifact in turn.artifacts"
                :key="artifact.id"
                class="min-w-0 rounded-[var(--md-border-radius)] border border-[var(--md-outline-variant)] bg-[var(--md-surface-container-low)] p-3"
              >
                <div class="flex items-center gap-2">
                  <UIcon
                    :name="
                      artifact.kind === 'diff'
                        ? 'i-lucide-file-diff'
                        : 'i-lucide-file'
                    "
                    class="size-4 shrink-0"
                  />
                  <strong class="min-w-0 flex-1 truncate text-sm">
                    {{ artifact.label }}
                  </strong>
                  <UBadge size="xs" color="neutral" variant="soft">
                    {{ artifact.kind }}
                  </UBadge>
                </div>
                <pre
                  v-if="artifact.preview"
                  class="mt-2 line-clamp-5 whitespace-pre-wrap break-words text-xs text-[var(--md-on-surface-variant)]"
                  >{{ artifact.preview }}</pre
                >
                <div class="mt-3 flex flex-wrap justify-end gap-1">
                  <UButton
                    v-if="artifact.content"
                    size="xs"
                    variant="ghost"
                    icon="i-lucide-copy"
                    @click="copyArtifact(artifact.content)"
                  >
                    Copy
                  </UButton>
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
              </article>
            </div>

            <UAlert
              v-if="turn.error"
              class="mx-2 mb-5 sm:mx-5"
              color="error"
              variant="soft"
              title="The agent could not continue"
              :description="turn.error.message"
              :actions="
                turn.error.action === 'retry'
                  ? [
                      {
                        label: 'Try again',
                        onClick: retryTurn,
                      },
                    ]
                  : undefined
              "
            />
          </article>

          <p
            v-if="session.actionError"
            class="mx-5 mb-4 text-sm text-[var(--md-error)]"
          >
            {{ session.actionError }}
          </p>
        </main>
      </div>

      <div
        class="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-[var(--md-surface)] via-[var(--md-surface)] to-transparent px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-12"
      >
        <div class="pointer-events-auto mx-auto max-w-[768px]">
          <ExternalAgentComposer
            ref="composer"
            v-model="followUpText"
            :running="projection.isRunning"
            :loading="pendingAction === 'follow-up'"
            :disabled="!connected || (!canFollowUp && !projection.isRunning)"
            :placeholder="
              projection.isRunning
                ? 'The agent is working…'
                : 'Ask the agent to continue, revise, or explain…'
            "
            @send="followUp"
            @stop="cancel"
          >
            <template #leading>
              <span class="text-xs text-[var(--md-on-surface-variant)]">
                {{ composerHint }}
              </span>
            </template>
          </ExternalAgentComposer>
        </div>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import ExternalAgentComposer from "./ExternalAgentComposer.vue";
import ExternalAgentLauncher from "./ExternalAgentLauncher.vue";
import type { ExternalAgentSession } from "~/core/external-agents/types";
import { projectExternalAgentConversation } from "~/core/external-agents/presentation";
import { presentExternalAgentError } from "~/core/external-agents/presentation";
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
const scroller = ref<HTMLElement | null>(null);
const composer = ref<{ focus: () => void } | null>(null);

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
const projection = computed(() =>
  session.value ? projectExternalAgentConversation(session.value) : null,
);
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
const statusColor = computed(() => {
  if (session.value?.status === "failed") return "error";
  if (session.value?.status === "waiting_approval") return "warning";
  if (session.value?.status === "succeeded") return "success";
  return "neutral";
});
const statusLabel = computed(() =>
  session.value?.status === "waiting_approval"
    ? "needs approval"
    : (session.value?.status ?? "queued").replace("_", " "),
);
const runnerLabel = computed(
  () =>
    snapshot.value?.runners.find(
      (runner) => runner.id === session.value?.runnerId,
    )?.display_name ??
    session.value?.runnerId ??
    "Agent",
);
const connectionWarning = computed(() => {
  if (session.value?.streamState === "disconnected")
    return "Live updates paused";
  if (!connected.value) return "Host disconnected";
  return null;
});
const composerHint = computed(() => {
  if (!connected.value) return "Reconnect the host to continue";
  if (session.value?.status === "waiting_approval")
    return "Resolve the approval above to continue";
  if (projection.value?.isRunning) return "Working — stop to interrupt";
  if (!canFollowUp.value) return "This provider cannot continue this session";
  return `${runnerLabel.value} · follow-up`;
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
    loadError.value = presentExternalAgentError(
      cause,
      "This conversation could not be loaded.",
    ).message;
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
  } finally {
    pendingAction.value = null;
  }
}

async function followUp() {
  if (!session.value || !runtime.controller || !followUpText.value.trim())
    return;
  pendingAction.value = "follow-up";
  try {
    await runtime.controller.followUp(
      session.value.remoteSessionId,
      followUpText.value,
    );
    followUpText.value = "";
    await nextTick();
    composer.value?.focus();
  } finally {
    pendingAction.value = null;
  }
}

async function retryTurn() {
  composer.value?.focus();
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
  } finally {
    pendingAction.value = null;
  }
}

async function copyArtifact(content: string) {
  await navigator.clipboard?.writeText(content);
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight;
  });
}

watch(
  () => props.recordId,
  () => void load(),
);
watch(
  () => [
    session.value?.events.length,
    session.value?.turns.length,
    session.value?.status,
  ],
  scrollToBottom,
);
onMounted(() => {
  void load();
  scrollToBottom();
});
</script>
