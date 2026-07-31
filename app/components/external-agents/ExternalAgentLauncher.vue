<template>
  <div class="space-y-3" aria-label="New external agent session">
    <div
      v-if="!availableOptions.length"
      class="rounded-[var(--md-border-radius)] border border-[var(--md-outline-variant)] bg-[var(--md-surface-container-lowest)] p-5 text-left shadow-sm"
      :aria-busy="recoveryPending"
      data-testid="external-agent-recovery"
    >
      <span
        class="grid size-11 place-items-center rounded-full bg-[var(--md-primary-container)] text-[var(--md-on-primary-container)]"
      >
        <UIcon :name="launcherRecovery.icon" class="size-5" />
      </span>
      <h2 class="mt-4 text-lg font-semibold">
        {{ launcherRecovery.title }}
      </h2>
      <p
        class="mt-1 max-w-xl text-sm leading-relaxed text-[var(--md-on-surface-variant)]"
      >
        {{ launcherRecovery.description }}
      </p>

      <div
        v-if="launcherRecovery.kind === 'connect'"
        class="mt-4 rounded-[var(--md-border-radius)] bg-[var(--md-surface-container)] p-3"
      >
        <p class="text-xs font-medium">Run this on the computer with your code:</p>
        <code class="mt-2 block select-all font-mono text-sm">{{
          CONNECT_COMMAND
        }}</code>
      </div>

      <div class="mt-5 flex flex-wrap gap-2">
        <UButton
          v-if="launcherRecovery.kind === 'connect'"
          icon="i-lucide-copy"
          @click="copyConnectCommand"
        >
          {{ connectCommandCopied ? "Copied" : "Copy Connect command" }}
        </UButton>
        <UButton
          v-else-if="
            launcherRecovery.kind === 'reconnect' ||
            launcherRecovery.kind === 'refresh' ||
            launcherRecovery.kind === 'install' ||
            launcherRecovery.kind === 'authenticate'
          "
          :icon="
            launcherRecovery.kind === 'reconnect'
              ? 'i-lucide-plug-zap'
              : 'i-lucide-refresh-cw'
          "
          :loading="recoveryPending"
          @click="retryConnection"
        >
          {{
            launcherRecovery.kind === "reconnect"
              ? "Reconnect"
              : "Refresh agents"
          }}
        </UButton>
        <UButton
          v-else-if="
            launcherRecovery.kind === 'unlock' ||
            launcherRecovery.kind === 'credential'
          "
          icon="i-lucide-key-round"
          @click="openConnectionSettings"
        >
          {{
            launcherRecovery.kind === "unlock"
              ? "Unlock saved token"
              : "Enter access token"
          }}
        </UButton>
        <UButton
          v-if="launcherRecovery.kind !== 'connecting'"
          color="neutral"
          variant="ghost"
          icon="i-lucide-settings-2"
          @click="openConnectionSettings"
        >
          Connection settings
        </UButton>
      </div>

      <details
        v-if="launcherRecovery.kind === 'connect'"
        class="mt-4 text-xs text-[var(--md-on-surface-variant)]"
      >
        <summary class="cursor-pointer font-medium">
          Advanced: connect by URL and token
        </summary>
        <p class="mt-2 leading-relaxed">
          Engineers can add an existing or3-intern endpoint directly in
          Connection settings.
        </p>
      </details>

      <p
        v-if="recoveryError"
        class="mt-3 text-sm text-[var(--md-error)]"
        role="alert"
      >
        {{ recoveryError }}
      </p>
    </div>

    <template v-else>
      <ExternalAgentComposer
        ref="composer"
        v-model="instruction"
        :loading="launching"
        placeholder="Describe the change, investigation, or review…"
        @send="launch"
      >
        <template #leading>
          <span class="truncate text-xs text-[var(--md-on-surface-variant)]">
            {{ selectedOption?.runner.display_name ?? "Choose an agent" }}
            <template v-if="cwd"> · {{ cwd }}</template>
          </span>
        </template>
        <template #settings>
          <ExternalAgentSettingsPanel
            v-model:runner-id="runnerId"
            v-model:mode="mode"
            v-model:isolation="isolation"
            v-model:cwd="cwd"
            v-model:model="model"
            v-model:thinking-level="thinkingLevel"
            v-model:confirm-dangerous="confirmDangerous"
            :runners="runners"
          />
        </template>
      </ExternalAgentComposer>

      <UAlert
        v-if="error"
        color="error"
        variant="soft"
        title="Could not launch agent"
        :description="error"
        role="alert"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import ExternalAgentComposer from "./ExternalAgentComposer.vue";
import ExternalAgentSettingsPanel from "./ExternalAgentSettingsPanel.vue";
import type {
  ExternalAgentSession,
  ExternalAgentUploadAttachment,
} from "~/core/external-agents/types";
import {
  buildExternalAgentRunnerOptions,
  isValidExternalAgentPolicyCombination,
  resolveExternalAgentModelReasoning,
} from "~/core/external-agents/launcher";
import {
  EXTERNAL_AGENT_OPEN_CONNECTIONS_EVENT,
  EXTERNAL_AGENTS_SIDEBAR_PAGE_ID,
} from "~/core/external-agents/refs";
import { presentExternalAgentError } from "~/core/external-agents/presentation";
import { useExternalAgentRuntime } from "~/core/external-agents/runtime";
import { useActiveSidebarPage } from "~/composables/sidebar/useActiveSidebarPage";

const CONNECT_COMMAND = "npx @or3/connect";

const props = withDefaults(
  defineProps<{
    compact?: boolean;
  }>(),
  { compact: false },
);

const emit = defineEmits<{
  launched: [session: ExternalAgentSession];
}>();

const runtime = useExternalAgentRuntime();
const { setActivePage } = useActiveSidebarPage();
const composer = ref<{
  clearAttachments: (
    expected?: readonly ExternalAgentUploadAttachment[],
  ) => boolean;
} | null>(null);
const runnerId = ref("");
const instruction = ref("");
const mode = ref("review");
const isolation = ref("host_readonly");
const cwd = ref("");
const model = ref<string | null>(null);
const thinkingLevel = ref<string | null>(null);
const confirmDangerous = ref(false);
const launching = ref(false);
const error = ref<string | null>(null);
const recoveryPending = ref(false);
const recoveryError = ref<string | null>(null);
const connectCommandCopied = ref(false);

const options = computed(() =>
  buildExternalAgentRunnerOptions(runtime.snapshot.value?.runners ?? []),
);
const runners = computed(() => runtime.snapshot.value?.runners ?? []);
const availableOptions = computed(() =>
  options.value.filter((option) => option.available),
);
const selectedOption = computed(() =>
  options.value.find((option) => option.runner.id === runnerId.value),
);
const availableRunnerIds = computed(() =>
  availableOptions.value.map((option) => option.runner.id).join("\u0000"),
);
const selectedCapabilityFingerprint = computed(() => {
  const option = selectedOption.value;
  if (!option) return "";
  return JSON.stringify({
    id: option.runner.id,
    status: option.runner.status,
    authStatus: option.runner.auth_status,
    modes: option.modes.map((item) => item.id),
    isolations: option.isolations.map((item) => item.id),
    roots: option.roots,
    customCwd: option.customCwd,
    defaultMode: option.defaultMode,
    defaultIsolation: option.defaultIsolation,
    defaultCwd: option.defaultCwd,
    models: (option.runner.models ?? []).map((candidate) => ({
      id: candidate.id,
      default: candidate.default === true,
      reasoning: candidate.reasoning,
      reasoningDefault: candidate.reasoning_default,
      options: candidate.options,
    })),
  });
});
const launcherRecovery = computed(() => {
  const current = runtime.snapshot.value;
  const controller = runtime.controller;
  void current?.generation;
  if (!current?.hosts.length || !current.activeHostId) {
    return {
      kind: "connect" as const,
      icon: "i-lucide-monitor-up",
      title: "Connect your computer",
      description:
        "Run one command on the computer that should run agents, then enter the code it shows.",
    };
  }
  if (controller?.pinCredentialStatus.locked) {
    return {
      kind: "unlock" as const,
      icon: "i-lucide-lock-keyhole",
      title: "Unlock the saved token",
      description:
        "Enter your device PIN in Connection settings to use this trusted computer.",
    };
  }
  if (current.connectionState === "connecting") {
    return {
      kind: "connecting" as const,
      icon: "i-lucide-loader-circle",
      title: "Connecting to your computer",
      description: "OR3 is checking the host and discovering its agents.",
    };
  }
  if (
    /credential|required|access token|unauthori[sz]ed/i.test(
      current.connectionError ?? "",
    )
  ) {
    return {
      kind: "credential" as const,
      icon: "i-lucide-key-round",
      title: "Enter the access token again",
      description:
        "This trusted host used a session-only token, so OR3 forgot it when the page reloaded.",
    };
  }
  if (
    current.connectionState !== "online" &&
    current.connectionState !== "degraded"
  ) {
    return {
      kind: "reconnect" as const,
      icon: "i-lucide-server-off",
      title: "Your computer is offline",
      description:
        current.connectionError ||
        "Reconnect the trusted host without losing this pending agent request.",
    };
  }
  const issue = options.value.find((option) => !option.available);
  if (issue?.usability.code === "authentication_required") {
    return {
      kind: "authenticate" as const,
      icon: "i-lucide-log-in",
      title: `Sign in to ${issue.runner.display_name}`,
      description: `${issue.usability.reason}. Sign in on ${current.hosts.find((host) => host.id === current.activeHostId)?.name ?? "the host"}, then refresh agents.`,
    };
  }
  if (issue?.usability.code === "provider_unavailable") {
    return {
      kind: "install" as const,
      icon: "i-lucide-package-plus",
      title: `Set up ${issue.runner.display_name}`,
      description: `${issue.usability.reason}. Install or start it on the host, then refresh agents.`,
    };
  }
  return {
    kind: "refresh" as const,
    icon: "i-lucide-refresh-cw",
    title: current.runners.length
      ? "This agent cannot start a chat"
      : "No agent runner was found",
    description:
      issue?.usability.reason ??
      "Install or start Codex or OpenCode on the host, then refresh discovery.",
  };
});

const isolationItems = computed(() =>
  (selectedOption.value?.isolations ?? [])
    .filter((item) =>
      isValidExternalAgentPolicyCombination(mode.value, item.id),
    )
    .map((item) => ({
      value: item.id,
      label: item.dangerous ? `${item.label} ⚠` : item.label,
    })),
);
const dangerousSelection = computed(() => {
  const option = selectedOption.value;
  return Boolean(
    option?.modes.find((item) => item.id === mode.value)?.dangerous ||
    option?.isolations.find((item) => item.id === isolation.value)?.dangerous,
  );
});

watch(
  availableRunnerIds,
  () => {
    const next = availableOptions.value;
    if (!next.some((option) => option.runner.id === runnerId.value)) {
      runnerId.value = next[0]?.runner.id ?? "";
    }
  },
  { immediate: true },
);

watch(
  runnerId,
  () => {
    const option = selectedOption.value;
    if (!option) return;
    mode.value = option.defaultMode;
    isolation.value = option.defaultIsolation;
    cwd.value = option.defaultCwd || option.roots[0] || "";
    model.value = null;
    thinkingLevel.value = null;
    confirmDangerous.value = false;
  },
  { immediate: true },
);

watch(selectedCapabilityFingerprint, () => {
  const option = selectedOption.value;
  if (!option) return;
  if (!option.modes.some((item) => item.id === mode.value)) {
    mode.value = option.defaultMode;
  }
  const compatible = option.isolations.filter((item) =>
    isValidExternalAgentPolicyCombination(mode.value, item.id),
  );
  if (!compatible.some((item) => item.id === isolation.value)) {
    isolation.value =
      compatible.find((item) => item.id === option.defaultIsolation)?.id ??
      compatible[0]?.id ??
      "";
  }
  const validCwds = [
    ...option.roots,
    ...(option.defaultCwd ? [option.defaultCwd] : []),
  ];
  if (!option.customCwd && cwd.value && !validCwds.includes(cwd.value)) {
    cwd.value = option.defaultCwd || option.roots[0] || "";
  }
  if (
    model.value &&
    !option.runner.models?.some((candidate) => candidate.id === model.value)
  ) {
    model.value = null;
  }
  const reasoning = resolveExternalAgentModelReasoning(
    option.runner,
    model.value,
  );
  if (
    thinkingLevel.value &&
    !reasoning?.values.includes(thinkingLevel.value)
  ) {
    thinkingLevel.value = null;
  }
});

watch(mode, () => {
  const compatible = isolationItems.value;
  if (!compatible.some((item) => item.value === isolation.value)) {
    isolation.value = compatible[0]?.value ?? "";
  }
});

watch([mode, isolation], () => {
  if (!dangerousSelection.value) confirmDangerous.value = false;
});

async function openConnectionSettings() {
  await setActivePage(EXTERNAL_AGENTS_SIDEBAR_PAGE_ID);
  await nextTick();
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(EXTERNAL_AGENT_OPEN_CONNECTIONS_EVENT),
    );
  }
}

async function copyConnectCommand() {
  recoveryError.value = null;
  try {
    await navigator.clipboard.writeText(CONNECT_COMMAND);
    connectCommandCopied.value = true;
  } catch {
    recoveryError.value = `Copy failed. Run “${CONNECT_COMMAND}” in a terminal.`;
  }
}

async function retryConnection() {
  const controller = runtime.controller;
  if (!controller) return;
  recoveryPending.value = true;
  recoveryError.value = null;
  try {
    await runtime.refreshCloudHosts?.();
    const connected = await controller.reconnect();
    if (!connected) {
      recoveryError.value =
        controller.snapshot.connectionError ?? "The host did not reconnect.";
    }
  } catch (cause) {
    recoveryError.value = presentExternalAgentError(
      cause,
      "The host did not reconnect.",
    ).message;
  } finally {
    recoveryPending.value = false;
  }
}

function attachmentOnlyInstruction(
  attachments: readonly ExternalAgentUploadAttachment[],
): string {
  if (attachments.length === 1) {
    return `Review ${attachments[0]?.name || "the attached file"}.`;
  }
  return `Review the ${attachments.length} attached files.`;
}

async function launch(
  attachments: readonly ExternalAgentUploadAttachment[] = [],
) {
  const controller = runtime.controller;
  if (!controller) {
    error.value = "External Agents is not available.";
    return;
  }
  const submittedText = instruction.value;
  const submittedAttachments = [...attachments];
  launching.value = true;
  error.value = null;
  try {
    const session = await controller.launch({
      runnerId: runnerId.value,
      instruction:
        submittedText.trim() ||
        attachmentOnlyInstruction(submittedAttachments),
      cwd: cwd.value || undefined,
      mode: mode.value,
      isolation: isolation.value,
      model: model.value ?? undefined,
      thinkingLevel: thinkingLevel.value ?? undefined,
      confirmDangerous: confirmDangerous.value,
      ...(submittedAttachments.length
        ? { attachments: submittedAttachments }
        : {}),
    });
    if (
      instruction.value === submittedText &&
      (composer.value?.clearAttachments(submittedAttachments) ??
        submittedAttachments.length === 0)
    ) {
      instruction.value = "";
    }
    emit("launched", session);
  } catch (cause) {
    error.value = presentExternalAgentError(
      cause,
      "The agent could not be started.",
    ).message;
  } finally {
    launching.value = false;
  }
}
</script>
