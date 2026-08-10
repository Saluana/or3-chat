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
            class="mb-5 grid size-14 place-items-center rounded-[var(--md-border-radius-small,var(--md-border-radius))] bg-[var(--md-surface-container)]"
          >
            <UIcon :name="iconBot" class="size-7" />
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
      v-else-if="hostCredentialLocked"
      class="grid min-h-0 flex-1 place-items-center px-5 py-10"
    >
      <form
        class="w-full max-w-sm rounded-[var(--md-border-radius)] border-[length:var(--md-border-width)] border-[var(--md-outline-variant)] bg-[var(--md-surface-container-lowest)] p-5 shadow-sm"
        aria-label="Unlock agent conversation"
        @submit.prevent="unlockConversation"
      >
        <span
          class="grid size-11 place-items-center rounded-full bg-[var(--md-primary-container)] text-[var(--md-on-primary-container)]"
        >
          <UIcon :name="iconLock" class="size-5" />
        </span>
        <h1 class="mt-4 text-lg font-semibold">Unlock this conversation</h1>
        <p
          class="mt-1 text-sm leading-relaxed text-[var(--md-on-surface-variant)]"
        >
          Enter your PIN to unlock {{ targetHostName }} and load this chat.
        </p>
        <UInput
          v-model="unlockPin"
          class="mt-5 w-full"
          type="password"
          inputmode="numeric"
          autocomplete="current-password"
          placeholder="Enter device PIN"
          aria-label="Conversation PIN"
          :icon="iconKey"
          autofocus
          :disabled="unlockPending"
        />
        <p
          v-if="unlockError"
          class="mt-2 text-sm text-[var(--md-error)]"
          role="alert"
        >
          {{ unlockError }}
        </p>
        <UButton
          class="mt-4 w-full justify-center"
          type="submit"
          :icon="iconUnlock"
          :loading="unlockPending"
          :disabled="!unlockPin.trim()"
        >
          Unlock conversation
        </UButton>
        <p class="mt-3 text-center text-xs text-[var(--md-on-surface-variant)]">
          Your PIN stays on this device.
        </p>
      </form>
    </div>

    <div
      v-else-if="loading"
      class="grid min-h-0 flex-1 place-items-center text-sm text-[var(--md-on-surface-variant)]"
    >
      <div class="flex items-center gap-2">
        <UIcon :name="iconLoading" class="size-4 animate-spin" />
        Loading conversation…
      </div>
    </div>

    <div
      v-else-if="loadError"
      class="grid min-h-0 flex-1 place-items-center p-6"
    >
      <div
        class="w-full max-w-md rounded-[var(--md-border-radius)] border-[length:var(--md-border-width)] border-[var(--md-error)]/40 bg-[var(--md-error-container)] p-5 text-[var(--md-on-error-container)]"
        role="alert"
        data-testid="conversation-load-recovery"
      >
        <span
          class="grid size-10 place-items-center rounded-full bg-[var(--md-surface-container-lowest)] text-[var(--md-error)]"
        >
          <UIcon :name="loadRecovery.icon" class="size-5" />
        </span>
        <h1 class="mt-4 text-lg font-semibold">
          {{ loadRecovery.title }}
        </h1>
        <p class="mt-1 text-sm leading-relaxed">
          {{ loadError }}
        </p>
        <p class="mt-2 text-xs opacity-80">
          {{ loadRecovery.guidance }}
        </p>
        <div class="mt-5 flex flex-wrap gap-2">
          <UButton
            :icon="iconRefresh"
            :loading="loading"
            @click="retryConversationLoad"
          >
            Retry
          </UButton>
          <UButton
            v-if="loadErrorCategory === 'offline'"
            color="neutral"
            variant="soft"
            :icon="iconConnect"
            :loading="recoveryPending"
            @click="reconnectConversation"
          >
            Reconnect host
          </UButton>
          <UButton
            v-if="
              loadErrorCategory === 'credential' ||
              loadErrorCategory === 'stale_host'
            "
            color="neutral"
            variant="soft"
            :icon="iconSettings"
            @click="openConnectionSettings"
          >
            Open connection settings
          </UButton>
        </div>
      </div>
    </div>

    <template v-else-if="session && projection">
      <div
        v-if="!projection.turns.length"
        class="grid min-h-0 flex-1 place-items-center text-sm text-[var(--md-on-surface-variant)]"
      >
        Waiting for the conversation to begin…
      </div>
      <ClientOnly v-else>
        <Or3Scroll
          ref="transcriptScroller"
          :items="conversationTurns"
          :item-key="(turn) => turn.id"
          :estimate-height="240"
          :overscan="5500"
          :prefetch-overscan="5500"
          :content-key="session.remoteSessionId"
          mutation-mode="arbitrary"
          maintain-bottom
          :bottom-threshold="5"
          :padding-top="28"
          :padding-bottom="192"
          class="chat-message-list min-h-0 flex-1"
          aria-live="polite"
        >
          <template #default="{ item: turn }">
            <article
              :key="turn.id"
              class="mx-auto w-full max-w-[768px] min-w-0"
            >
              <div
                v-if="turn.userMessage"
                :class="CHAT_MESSAGE_ROW_CLASS"
                :data-msg-id="turn.userMessage.id"
              >
                <component
                  :is="themedChatMessageComponent"
                  :message="turn.userMessage"
                  :interactive="false"
                  @content-resize="refreshTranscriptMeasurements"
                />
              </div>
              <div
                v-if="turn.assistantMessage"
                :class="CHAT_MESSAGE_ROW_CLASS"
                :data-msg-id="turn.assistantMessage.id"
              >
                <component
                  :is="themedChatMessageComponent"
                  :message="turn.assistantMessage"
                  :interactive="false"
                  @content-resize="refreshTranscriptMeasurements"
                />
              </div>

              <div
                v-if="commandChoicesForTurn(turn).length"
                class="mx-2 mb-4 flex flex-wrap gap-2 sm:mx-5"
                aria-label="Command options"
              >
                <UButton
                  v-for="choice in commandChoicesForTurn(turn)"
                  :key="choice.command"
                  size="sm"
                  color="neutral"
                  variant="soft"
                  :disabled="Boolean(pendingAction) || projection.isRunning"
                  @click="sendCommandChoice(choice.command)"
                >
                  {{ choice.label }}
                </UButton>
              </div>

              <div
                v-for="approval in turn.approvals"
                :key="approval.id"
                class="mx-2 mb-4 rounded-[var(--md-border-radius)] border-[length:var(--md-border-width)] border-[var(--md-extended-color-warning-color)]/60 bg-[var(--md-surface-container-low)] p-3 sm:mx-5"
              >
                <div class="flex items-start gap-3">
                  <UIcon
                    :name="iconShieldAlert"
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
                  class="min-w-0 rounded-[var(--md-border-radius)] border-[length:var(--md-border-width)] border-[var(--md-outline-variant)] bg-[var(--md-surface-container-low)] p-3"
                >
                  <div class="flex items-center gap-2">
                    <UIcon
                      :name="artifact.kind === 'diff' ? iconFileDiff : iconFile"
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
                      :icon="iconCopy"
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
                          label: 'Prepare retry',
                          onClick: () => retryTurn(turn.userMessage?.text),
                        },
                      ]
                    : undefined
                "
              />
            </article>
          </template>
        </Or3Scroll>
      </ClientOnly>

      <p
        v-if="session.actionError"
        class="absolute inset-x-5 bottom-44 z-30 mx-auto max-w-[728px] rounded-[var(--md-border-radius)] bg-[var(--md-error-container)] p-3 text-sm text-[var(--md-on-error-container)]"
      >
        {{ session.actionError }}
      </p>

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
            :settings-disabled="!connected"
            :attachments-enabled="attachmentsEnabled"
            :commands="followUpRunnerOption?.runner.commands ?? []"
            :placeholder="
              projection.isRunning
                ? 'The agent is working…'
                : 'Ask the agent to continue, revise, or explain…'
            "
            @send="followUp"
            @stop="cancel"
          >
            <template #leading>
              <UButton
                v-if="canCancel && !projection.isRunning"
                type="button"
                size="xs"
                color="neutral"
                variant="ghost"
                :icon="iconStop"
                aria-label="Stop agent"
                :loading="pendingAction === 'cancel'"
                :disabled="Boolean(pendingAction)"
                @click="cancel"
              />
              <span class="text-xs text-[var(--md-on-surface-variant)]">
                {{ composerHint }}
              </span>
            </template>
            <template #settings="{ close }">
              <ExternalAgentSettingsPanel
                v-model:runner-id="followUpRunnerId"
                v-model:mode="followUpMode"
                v-model:isolation="followUpIsolation"
                v-model:cwd="followUpCwd"
                v-model:model="followUpModel"
                v-model:thinking-level="followUpThinkingLevel"
                v-model:confirm-dangerous="followUpConfirmDangerous"
                :runners="snapshot?.runners ?? []"
                runner-locked
                @close="close"
              />
            </template>
          </ExternalAgentComposer>
        </div>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import {
  computed,
  getCurrentInstance,
  nextTick,
  onMounted,
  ref,
  type Component,
  watch,
} from "vue";
import { Or3Scroll } from "or3-scroll";
import "or3-scroll/style.css";
import ChatMessage from "~/components/chat/ChatMessage.vue";
import { CHAT_MESSAGE_ROW_CLASS } from "~/components/chat/message-layout";
import ExternalAgentComposer from "./ExternalAgentComposer.vue";
import ExternalAgentLauncher from "./ExternalAgentLauncher.vue";
import ExternalAgentSettingsPanel from "./ExternalAgentSettingsPanel.vue";
import type {
  ExternalAgentSession,
  ExternalAgentUploadAttachment,
} from "~/core/external-agents/types";
import {
  buildExternalAgentRunnerOptions,
  isValidExternalAgentPolicyCombination,
} from "~/core/external-agents/launcher";
import {
  classifyExternalAgentConversationLoadError,
  type ExternalAgentConversationRecoveryCategory,
} from "~/core/external-agents/recovery";
import { projectExternalAgentConversation } from "~/core/external-agents/presentation";
import { presentExternalAgentError } from "~/core/external-agents/presentation";
import {
  decodeExternalAgentSessionRef,
  encodeExternalAgentSessionRef,
  EXTERNAL_AGENT_LAUNCHER_REF,
  EXTERNAL_AGENT_OPEN_CONNECTIONS_EVENT,
  EXTERNAL_AGENT_PANE_APP_ID,
  EXTERNAL_AGENTS_SIDEBAR_PAGE_ID,
} from "~/core/external-agents/refs";
import type { AgentConversationTurn } from "~/core/external-agents/presentation";
import { useExternalAgentRuntime } from "~/core/external-agents/runtime";
import { useActiveSidebarPage } from "~/composables/sidebar/useActiveSidebarPage";
import { useIcon } from "~/composables/useIcon";
import { getGlobalMultiPaneApi } from "~/utils/multiPaneApi";

const props = defineProps<{
  paneId: string;
  recordId?: string | null;
}>();
const emit = defineEmits<{
  "tab-title": [title: string];
}>();

const runtime = useExternalAgentRuntime();
const { setActivePage } = useActiveSidebarPage();
const iconBot = useIcon("external-agent.bot");
const iconLock = useIcon("ui.lock");
const iconKey = useIcon("external-agent.key");
const iconUnlock = useIcon("ui.unlock");
const iconLoading = useIcon("ui.loading");
const iconRefresh = useIcon("ui.refresh");
const iconConnect = useIcon("external-agent.connect");
const iconSettings = useIcon("ui.settings");
const iconStop = useIcon("chat.stop");
const iconShieldAlert = useIcon("external-agent.shield.alert");
const iconFile = useIcon("external-agent.file");
const iconFileDiff = useIcon("external-agent.file.diff");
const iconCopy = useIcon("ui.copy");
const iconServerOff = useIcon("external-agent.server.off");
const iconLinkOff = useIcon("external-agent.link.off");
const snapshot = runtime.snapshot;
const loading = ref(false);
const loadInFlight = ref(false);
const loadError = ref<string | null>(null);
const loadErrorCategory =
  ref<ExternalAgentConversationRecoveryCategory>("transient");
const recoveryPending = ref(false);
const unlockPin = ref("");
const unlockPending = ref(false);
const unlockError = ref<string | null>(null);
const followUpText = ref("");
const pendingAction = ref<string | null>(null);
const composer = ref<{
  focus: () => void;
  clearAttachments: (
    expected?: readonly ExternalAgentUploadAttachment[],
  ) => boolean;
} | null>(null);
const transcriptScroller = ref<{
  refreshMeasurements: () => void;
} | null>(null);
const followUpRunnerId = ref("");
const followUpMode = ref("");
const followUpIsolation = ref("");
const followUpCwd = ref("");
const followUpModel = ref<string | null>(null);
const followUpThinkingLevel = ref<string | null>(null);
const followUpConfirmDangerous = ref(false);
const initializedSettingsSession = ref("");
const componentInstance = getCurrentInstance();
const themedChatMessageComponent = computed(() => {
  const theme = componentInstance?.appContext.config.globalProperties.$theme as
    | {
        activeComponents?: {
          value?: Record<string, Component>;
        };
      }
    | undefined;
  return theme?.activeComponents?.value?.["chat-message"] ?? ChatMessage;
});

function refreshTranscriptMeasurements() {
  void nextTick(() => {
    transcriptScroller.value?.refreshMeasurements();
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => {
        transcriptScroller.value?.refreshMeasurements();
      });
    }
  });
}

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
const targetHost = computed(() => {
  const refValue = sessionRef.value;
  if (!refValue) return null;
  return (
    snapshot.value?.hosts.find((host) => host.id === refValue.hostId) ?? null
  );
});
const targetHostName = computed(
  () => targetHost.value?.name || "this agent host",
);
const hostCredentialLocked = computed(() => {
  const controller = runtime.controller;
  const refValue = sessionRef.value;
  // Credential lock state lives in the controller; reading the snapshot keeps
  // this projection reactive when unlock/reconnect emits its next state.
  void snapshot.value?.connectionState;
  return Boolean(
    controller &&
    refValue &&
    controller.isHostCredentialLocked(
      refValue.hostId,
      refValue.remoteSessionId,
    ),
  );
});
const projection = computed(() =>
  session.value ? projectExternalAgentConversation(session.value) : null,
);
const conversationTurns = computed(() =>
  projection.value ? [...projection.value.turns] : [],
);
function commandChoicesForTurn(turn: AgentConversationTurn) {
  if (turn.commandChoices.length) return turn.commandChoices;
  const input = turn.userMessage?.text.trim() ?? "";
  if (/^\/(?:help|commands)\s*$/iu.test(input)) {
    return (followUpRunnerOption.value?.runner.commands ?? []).map(
      (command) => ({
        label: command.command,
        command: command.command,
      }),
    );
  }
  if (/^\/(?:think|thinking|t)\s*$/iu.test(input)) {
    const models = followUpRunnerOption.value?.runner.models ?? [];
    const selected = models.find(
      (candidate) => candidate.id === followUpModel.value,
    );
    const levels = Array.isArray(selected?.reasoning)
      ? selected.reasoning
      : ["minimal", "low", "medium", "high", "xhigh"];
    return levels.flatMap((level) =>
      typeof level === "string"
        ? [{ label: level, command: `/think ${level}` }]
        : [],
    );
  }
  const bareCommand = /^\/([^\s]+)\s*$/u.exec(input)?.[1]?.toLowerCase();
  const argumentChoices = bareCommand
    ? followUpRunnerOption.value?.runner.commands?.find(
        (command) => command.name.toLowerCase() === bareCommand,
      )?.args?.[0]?.choices
    : undefined;
  if (argumentChoices?.length) {
    return argumentChoices.map((choice) => ({
      label: choice.label,
      command: `/${bareCommand} ${choice.value}`,
    }));
  }
  const match =
    /^\/(?:model|models)(?:\s+([^\s]+)(?:\s+page=(\d+))?)?\s*$/iu.exec(input);
  if (!match) return [];
  const models = followUpRunnerOption.value?.runner.models ?? [];
  const provider = match[1]?.toLowerCase();
  if (provider) {
    const providerModels = models.flatMap((candidate) => {
      const id = typeof candidate.id === "string" ? candidate.id : "";
      const modelProvider =
        typeof candidate.provider === "string" ? candidate.provider : "";
      if (!id || modelProvider.toLowerCase() !== provider) return [];
      const label =
        typeof candidate.display_name === "string"
          ? candidate.display_name
          : typeof candidate.name === "string"
            ? candidate.name
            : id;
      return [{ label, command: `/model ${id}` }];
    });
    const pageSize = 8;
    const pageCount = Math.max(1, Math.ceil(providerModels.length / pageSize));
    const page = Math.min(pageCount, Math.max(1, Number(match[2]) || 1));
    const choices = providerModels.slice(
      (page - 1) * pageSize,
      page * pageSize,
    );
    if (page > 1) {
      choices.push({
        label: "← Previous",
        command: `/models ${provider} page=${page - 1}`,
      });
    }
    if (page < pageCount) {
      choices.push({
        label: "Next →",
        command: `/models ${provider} page=${page + 1}`,
      });
    }
    choices.push({ label: "← Providers", command: "/models" });
    return choices;
  }
  const providers = new Map<string, { label: string; count: number }>();
  for (const candidate of models) {
    const providerId =
      typeof candidate.provider === "string" ? candidate.provider : "";
    if (!providerId) continue;
    const current = providers.get(providerId);
    providers.set(providerId, {
      label:
        typeof candidate.provider_name === "string"
          ? candidate.provider_name
          : providerId,
      count: (current?.count ?? 0) + 1,
    });
  }
  return [...providers].map(([providerId, details]) => ({
    label: `${details.label} (${details.count})`,
    command: `/models ${providerId}`,
  }));
}
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
const runnerLabel = computed(
  () =>
    (snapshot.value?.activeHostId === session.value?.hostId
      ? snapshot.value?.runners.find(
          (runner) => runner.id === session.value?.runnerId,
        )?.display_name
      : undefined) ??
    targetHost.value?.name ??
    session.value?.runnerId ??
    "Agent",
);
const runnerOptions = computed(() =>
  buildExternalAgentRunnerOptions(snapshot.value?.runners ?? []),
);
const followUpRunnerOption = computed(() =>
  runnerOptions.value.find(
    (option) => option.runner.id === session.value?.runnerId,
  ),
);
const attachmentsEnabled = computed(
  () =>
    targetHost.value?.driver !== "runs" ||
    followUpRunnerOption.value?.runner.chat_capabilities?.attachments === true,
);
const followUpIsolationItems = computed(() =>
  (followUpRunnerOption.value?.isolations ?? []).filter((item) =>
    isValidExternalAgentPolicyCombination(followUpMode.value, item.id),
  ),
);
const dangerousFollowUpSelection = computed(() => {
  const option = followUpRunnerOption.value;
  return Boolean(
    option?.modes.find((item) => item.id === followUpMode.value)?.dangerous ||
    option?.isolations.find((item) => item.id === followUpIsolation.value)
      ?.dangerous,
  );
});
const followUpModelLabel = computed(() => {
  if (!followUpModel.value) return "";
  const candidate = followUpRunnerOption.value?.runner.models?.find(
    (item) => item.id === followUpModel.value,
  );
  return typeof candidate?.display_name === "string" &&
    candidate.display_name.trim()
    ? candidate.display_name.trim()
    : followUpModel.value;
});
const followUpReasoningLabel = computed(() => {
  if (!followUpThinkingLevel.value) return "";
  const value = followUpThinkingLevel.value.toLowerCase();
  return value === "xhigh" || value === "extra-high"
    ? "Extra high reasoning"
    : `${value.charAt(0).toUpperCase()}${value.slice(1)} reasoning`;
});
const loadRecovery = computed(() => {
  switch (loadErrorCategory.value) {
    case "offline":
      return {
        icon: iconServerOff.value,
        title: "Conversation temporarily offline",
        guidance:
          "Reconnect the host here, then retry. This conversation link will stay open.",
      };
    case "credential":
      return {
        icon: iconKey.value,
        title: "This host needs its access token",
        guidance:
          "Update the selected trusted host in Connection settings, then retry here.",
      };
    case "stale_host":
      return {
        icon: iconLinkOff.value,
        title: "The saved host changed",
        guidance:
          "Choose or repair the trusted host in Connection settings. The conversation reference is preserved.",
      };
    default:
      return {
        icon: iconRefresh.value,
        title: "Conversation unavailable",
        guidance:
          "This may be temporary. Retry without leaving or losing the conversation link.",
      };
  }
});
const tabTitle = computed(() =>
  isLauncher.value
    ? "New agent"
    : session.value
      ? `${runnerLabel.value} · ${session.value.title}`
      : "Agent conversation",
);
watch(tabTitle, (title) => emit("tab-title", title), { immediate: true });
const composerHint = computed(() => {
  if (!connected.value) return "Reconnect the host to continue";
  if (session.value?.status === "waiting_approval")
    return "Resolve the approval above to continue";
  if (projection.value?.isRunning) return "Working — stop to interrupt";
  if (!canFollowUp.value) return "This agent can't continue this conversation";
  return [
    runnerLabel.value,
    followUpModelLabel.value,
    followUpReasoningLabel.value,
  ]
    .filter(Boolean)
    .join(" · ");
});

async function load(ignoreCredentialLock = false, activateHost = false) {
  const controller = runtime.controller;
  const refValue = sessionRef.value;
  if (!controller || !refValue) return;
  if (!ignoreCredentialLock && hostCredentialLocked.value) {
    loadError.value = null;
    loading.value = false;
    return;
  }
  if (
    session.value &&
    (!activateHost ||
      (snapshot.value?.activeHostId === refValue.hostId &&
        session.value.hostGeneration === snapshot.value?.generation))
  ) {
    loadError.value = null;
    loading.value = false;
    return;
  }
  if (snapshot.value?.connectionState === "connecting") {
    loadError.value = null;
    loading.value = true;
    return;
  }
  if (loadInFlight.value) return;
  loadInFlight.value = true;
  loading.value = true;
  loadError.value = null;
  try {
    const loaded = await controller.ensureSession(
      refValue.hostId,
      refValue.remoteSessionId,
    );
    loadError.value = null;
    if (loaded.hostId !== refValue.hostId) {
      await replaceWithSession(loaded);
    }
  } catch (cause) {
    const presented = presentExternalAgentError(
      cause,
      "This conversation could not be loaded.",
    ).message;
    loadError.value = presented;
    loadErrorCategory.value = classifyExternalAgentConversationLoadError({
      cause,
      message: presented,
      connectionState: snapshot.value?.connectionState,
    });
  } finally {
    loadInFlight.value = false;
    loading.value = false;
  }
}

async function retryConversationLoad() {
  await load(true, true);
}

async function reconnectConversation() {
  const controller = runtime.controller;
  const refValue = sessionRef.value;
  if (!controller || !refValue) return;
  recoveryPending.value = true;
  try {
    await runtime.refreshCloudHosts?.();
    if (
      targetHost.value &&
      snapshot.value?.activeHostId !== targetHost.value.id
    ) {
      await controller.switchHost(targetHost.value.id);
    } else {
      await controller.reconnect();
    }
    await load(true);
  } catch (cause) {
    const presented = presentExternalAgentError(
      cause,
      "The host could not reconnect.",
    ).message;
    loadError.value = presented;
    loadErrorCategory.value = classifyExternalAgentConversationLoadError({
      cause,
      message: presented,
      connectionState: snapshot.value?.connectionState,
    });
  } finally {
    recoveryPending.value = false;
  }
}

async function openConnectionSettings() {
  await setActivePage(EXTERNAL_AGENTS_SIDEBAR_PAGE_ID);
  await nextTick();
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(EXTERNAL_AGENT_OPEN_CONNECTIONS_EVENT),
    );
  }
}

async function unlockConversation() {
  const controller = runtime.controller;
  const refValue = sessionRef.value;
  if (!controller || !refValue || !unlockPin.value.trim()) return;
  unlockPending.value = true;
  unlockError.value = null;
  try {
    const connected = await controller.unlockHostCredential(
      refValue.hostId,
      unlockPin.value,
      refValue.remoteSessionId,
    );
    if (!connected) {
      unlockError.value = "This agent host could not reconnect. Try again.";
      return;
    }
    unlockPin.value = "";
    await load(true);
  } catch (cause) {
    unlockError.value = presentExternalAgentError(
      cause,
      "That PIN did not work. Try again.",
    ).message;
  } finally {
    unlockPending.value = false;
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
    // The controller records and renders the actionable session error.
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
    // The controller records and renders the actionable session error.
  } finally {
    pendingAction.value = null;
  }
}

function attachmentOnlyFollowUp(
  attachments: readonly ExternalAgentUploadAttachment[],
): string {
  if (attachments.length === 1) {
    return `Use ${attachments[0]?.name || "the attached file"} as additional context.`;
  }
  return `Use the ${attachments.length} attached files as additional context.`;
}

async function followUp(
  attachments: readonly ExternalAgentUploadAttachment[] = [],
) {
  if (
    !session.value ||
    !runtime.controller ||
    (!followUpText.value.trim() && !attachments.length)
  )
    return;
  const submittedText = followUpText.value;
  const submittedAttachments = [...attachments];
  const isSlashCommand = /^\/\S+(?:\s|$)/u.test(submittedText.trim());
  pendingAction.value = "follow-up";
  try {
    await runtime.controller.followUp(session.value.remoteSessionId, {
      instruction:
        submittedText.trim() || attachmentOnlyFollowUp(submittedAttachments),
      // Runtime slash commands own their configuration. Re-sending the
      // composer's previous model/thinking settings here would silently undo
      // a successful `/model` or `/think` command on the next turn.
      mode: followUpMode.value,
      isolation: followUpIsolation.value,
      ...(isSlashCommand
        ? {}
        : {
            cwd: followUpCwd.value || undefined,
            model: followUpModel.value ?? undefined,
            thinkingLevel: followUpThinkingLevel.value ?? undefined,
            confirmDangerous: followUpConfirmDangerous.value,
          }),
      ...(submittedAttachments.length
        ? { attachments: submittedAttachments }
        : {}),
    });
    const selectedModel = /^\/model\s+(.+)$/iu
      .exec(submittedText.trim())?.[1]
      ?.trim();
    if (selectedModel) followUpModel.value = selectedModel;
    const selectedThinking = /^\/(?:think|thinking|t)\s+(.+)$/iu
      .exec(submittedText.trim())?.[1]
      ?.trim();
    if (selectedThinking) followUpThinkingLevel.value = selectedThinking;
    if (
      followUpText.value === submittedText &&
      (composer.value?.clearAttachments(submittedAttachments) ??
        submittedAttachments.length === 0)
    ) {
      followUpText.value = "";
    }
    await nextTick();
    composer.value?.focus();
  } catch (cause) {
    if (session.value) {
      session.value.actionError = presentExternalAgentError(
        cause,
        "The agent could not continue.",
      ).message;
    }
  } finally {
    pendingAction.value = null;
  }
}

async function sendCommandChoice(command: string) {
  if (pendingAction.value || projection.value?.isRunning) return;
  const model = /^\/model\s+(.+)$/iu.exec(command)?.[1]?.trim();
  if (model) followUpModel.value = model;
  const thinking = /^\/(?:think|thinking|t)\s+(.+)$/iu
    .exec(command)?.[1]
    ?.trim();
  if (thinking) followUpThinkingLevel.value = thinking;
  followUpText.value = command;
  await followUp();
}

async function retryTurn(message?: string) {
  if (!followUpText.value.trim() && message?.trim()) {
    followUpText.value = message.trim();
  }
  await nextTick();
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

watch(
  () => props.recordId,
  () => void load(false, true),
);
watch(
  () => [
    snapshot.value?.connectionState,
    session.value?.hostId,
    hostCredentialLocked.value,
  ],
  () => void load(),
);
watch(
  [session, followUpRunnerOption],
  ([currentSession, option]) => {
    if (!currentSession || !option) return;
    const sessionKey = `${currentSession.hostId}:${currentSession.remoteSessionId}`;
    if (initializedSettingsSession.value === sessionKey) return;
    const latest = currentSession.turns.at(-1);
    followUpRunnerId.value = currentSession.runnerId;
    followUpMode.value =
      latest?.mode ?? currentSession.mode ?? option.defaultMode;
    followUpIsolation.value =
      latest?.isolation ?? currentSession.isolation ?? option.defaultIsolation;
    followUpCwd.value =
      latest?.cwd ??
      currentSession.cwd ??
      option.defaultCwd ??
      option.roots[0] ??
      "";
    followUpModel.value = latest?.model ?? currentSession.model ?? null;
    followUpThinkingLevel.value =
      latest?.thinking_level ?? currentSession.thinkingLevel ?? null;
    followUpConfirmDangerous.value = false;
    initializedSettingsSession.value = sessionKey;
  },
  { immediate: true },
);
watch(followUpMode, () => {
  if (
    !followUpIsolationItems.value.some(
      (item) => item.id === followUpIsolation.value,
    )
  ) {
    followUpIsolation.value = followUpIsolationItems.value[0]?.id ?? "";
  }
});
watch(
  () => session.value?.model,
  (model) => {
    if (model) followUpModel.value = model;
  },
);
watch(
  () => session.value?.thinkingLevel,
  (level) => {
    if (level) followUpThinkingLevel.value = level;
  },
);
watch([followUpMode, followUpIsolation], () => {
  if (!dangerousFollowUpSelection.value) {
    followUpConfirmDangerous.value = false;
  }
});
onMounted(() => {
  void load(false, true);
});
</script>
