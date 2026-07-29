<template>
  <main
    class="agent-visual-shell grid h-dvh min-h-0 overflow-hidden bg-[var(--md-surface)]"
    :style="{
      display: 'grid',
      gridTemplateColumns: narrow ? 'minmax(0, 1fr)' : '22rem minmax(0, 1fr)',
      height: '100dvh',
      minHeight: '0',
      overflow: 'hidden',
      background: 'var(--md-surface)',
    }"
  >
    <aside
      v-if="!narrow"
      class="agent-visual-sidebar"
      style="min-height: 0; border-right: 1px solid var(--md-outline-variant)"
    >
      <ExternalAgentsSidebarPage />
    </aside>
    <ExternalAgentSessionPane
      pane-id="visual-agent-pane"
      :record-id="recordId"
    />
    <output class="sr-only" data-testid="ready">ready</output>
  </main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import ExternalAgentsSidebarPage from "~/components/external-agents/ExternalAgentsSidebarPage.vue";
import ExternalAgentSessionPane from "~/components/external-agents/ExternalAgentSessionPane.vue";
import {
  encodeExternalAgentSessionRef,
  EXTERNAL_AGENT_LAUNCHER_REF,
} from "~/core/external-agents/refs";
import {
  resetExternalAgentRuntimeForTests,
  setExternalAgentController,
} from "~/core/external-agents/runtime";
import type {
  ExternalAgentSession,
  ExternalAgentStoreSnapshot,
  ExternalAgentStoreEvent,
} from "~/core/external-agents/types";
import type { ExternalAgentController } from "~/core/external-agents/controller";

const route = useRoute();
const narrow = ref(
  typeof window !== "undefined" &&
    window.matchMedia("(max-width: 720px)").matches,
);
const state = computed(() => String(route.query.state ?? "completed"));
const selectedId = computed(() =>
  state.value === "running"
    ? "running"
    : state.value === "approval"
      ? "approval"
      : state.value === "failed"
        ? "failed"
        : "completed",
);

const base = {
  hostId: "local-host",
  hostGeneration: 1,
  appSessionKey: "visual",
  runnerId: "codex",
  createdAt: "2026-07-27T20:00:00.000Z",
  updatedAt: new Date().toISOString(),
  streamState: "connected" as const,
  approvals: [],
  artifacts: [],
};

const sessions: ExternalAgentSession[] = [
  {
    ...base,
    remoteSessionId: "running",
    title: "Polish the agent conversation",
    status: "running",
    activeTurnId: "turn-running",
    turns: [
      {
        id: "turn-running",
        session_id: "running",
        sequence: 1,
        status: "running",
        continuation_mode: "native",
        requested_at: Date.now() - 12_000,
        user_message:
          "Make the Agents experience feel native to OR3 Chat and run the relevant tests.",
      },
    ],
    events: [
      {
        id: "running-text",
        hostId: "local-host",
        hostGeneration: 1,
        sessionId: "running",
        turnId: "turn-running",
        sequence: 1,
        occurredAt: new Date().toISOString(),
        type: "message",
        text: "I’m aligning the transcript and composer with the existing chat primitives.",
        payload: { rawType: "text_delta" },
      },
      {
        id: "running-read",
        hostId: "local-host",
        hostGeneration: 1,
        sessionId: "running",
        turnId: "turn-running",
        sequence: 2,
        occurredAt: new Date().toISOString(),
        type: "tool",
        payload: {
          rawType: "tool.completed",
          operation_id: "read",
          name: "read files",
          status: "completed",
        },
      },
      {
        id: "running-follow-up",
        hostId: "local-host",
        hostGeneration: 1,
        sessionId: "running",
        turnId: "turn-running",
        sequence: 3,
        occurredAt: new Date().toISOString(),
        type: "message",
        text: " Next I’m **running the focused tests",
        payload: { rawType: "text_delta" },
      },
      {
        id: "running-tests",
        hostId: "local-host",
        hostGeneration: 1,
        sessionId: "running",
        turnId: "turn-running",
        sequence: 4,
        occurredAt: new Date().toISOString(),
        type: "tool",
        payload: {
          rawType: "tool.started",
          operation_id: "tests",
          name: "vitest",
          status: "running",
        },
      },
    ],
  },
  {
    ...base,
    remoteSessionId: "approval",
    title: "Update the workspace settings",
    status: "waiting_approval",
    activeTurnId: "turn-approval",
    turns: [
      {
        id: "turn-approval",
        session_id: "approval",
        sequence: 1,
        status: "waiting_approval",
        continuation_mode: "native",
        requested_at: Date.now() - 60_000,
        user_message: "Update the workspace settings and verify the migration.",
      },
    ],
    events: [
      {
        id: "approval-tool",
        hostId: "local-host",
        hostGeneration: 1,
        sessionId: "approval",
        turnId: "turn-approval",
        sequence: 1,
        occurredAt: new Date().toISOString(),
        type: "tool",
        payload: {
          rawType: "tool.started",
          operation_id: "edit",
          name: "edit config",
          status: "running",
        },
      },
    ],
    approvals: [
      {
        id: "approval-1",
        turnId: "turn-approval",
        title: "Allow changes to workspace settings?",
        description:
          "The agent wants to edit config/workspace.json and run the migration.",
        status: "pending",
      },
    ],
  },
  {
    ...base,
    remoteSessionId: "completed",
    title: "Polish the mobile composer",
    status: "succeeded",
    completedAt: new Date().toISOString(),
    activeTurnId: "turn-completed",
    output:
      "Done. The composer now matches OR3 Chat on desktop and mobile, restores focus after sending, and keeps advanced execution settings out of the conversation.",
    turns: [
      {
        id: "turn-completed",
        session_id: "completed",
        sequence: 1,
        status: "succeeded",
        continuation_mode: "native",
        requested_at: Date.now() - 120_000,
        completed_at: Date.now() - 30_000,
        user_message:
          "Polish the mobile agent composer and keep the execution controls compact.",
        final_text:
          "Done. The composer now matches OR3 Chat on desktop and mobile, restores focus after sending, and keeps advanced execution settings out of the conversation.",
      },
    ],
    events: [
      {
        id: "completed-edit",
        hostId: "local-host",
        hostGeneration: 1,
        sessionId: "completed",
        turnId: "turn-completed",
        sequence: 1,
        occurredAt: new Date().toISOString(),
        type: "tool",
        payload: {
          rawType: "item.completed",
          operation_id: "edit",
          item_type: "file_change",
          title: "Edit file",
          status: "completed",
          detail: "app/components/ExternalAgentComposer.vue",
        },
      },
      {
        id: "completed-read",
        hostId: "local-host",
        hostGeneration: 1,
        sessionId: "completed",
        turnId: "turn-completed",
        sequence: 2,
        occurredAt: new Date().toISOString(),
        type: "tool",
        payload: {
          rawType: "item.completed",
          operation_id: "read",
          item_type: "dynamic_tool_call",
          title: "read",
          status: "completed",
          detail: "app/components/chat/ChatInputDropper.vue",
        },
      },
      {
        id: "completed-command",
        hostId: "local-host",
        hostGeneration: 1,
        sessionId: "completed",
        turnId: "turn-completed",
        sequence: 3,
        occurredAt: new Date().toISOString(),
        type: "tool",
        payload: {
          rawType: "item.completed",
          operation_id: "command",
          item_type: "command_execution",
          title: "Command run",
          status: "completed",
          detail: "bun run test -- ExternalAgents",
        },
      },
      {
        id: "completed-search",
        hostId: "local-host",
        hostGeneration: 1,
        sessionId: "completed",
        turnId: "turn-completed",
        sequence: 4,
        occurredAt: new Date().toISOString(),
        type: "tool",
        payload: {
          rawType: "item.completed",
          operation_id: "search",
          item_type: "dynamic_tool_call",
          title: "glob",
          status: "completed",
          detail: "4 matching files",
        },
      },
    ],
    artifacts: [
      {
        id: "composer-diff",
        turnId: "turn-completed",
        kind: "diff",
        label: "ExternalAgentComposer.vue",
        content:
          "+ Shared OR3 composer shell\n+ Compact settings popover\n+ Mobile safe-area support",
      },
      {
        id: "test-report",
        turnId: "turn-completed",
        kind: "artifact",
        label: "Test report",
        content: "38 tests passed",
      },
    ],
  },
  {
    ...base,
    remoteSessionId: "failed",
    title: "Generate the release notes",
    status: "failed",
    completedAt: new Date().toISOString(),
    activeTurnId: "turn-failed",
    error:
      'POST https://provider.example/v1/jobs failed: insufficient credits; responseHeaders={"set-cookie":"secret"}',
    turns: [
      {
        id: "turn-failed",
        session_id: "failed",
        sequence: 1,
        status: "failed",
        continuation_mode: "native",
        requested_at: Date.now() - 180_000,
        completed_at: Date.now() - 160_000,
        user_message: "Generate concise release notes for this change.",
        error:
          'POST https://provider.example/v1/jobs failed: insufficient credits; responseHeaders={"set-cookie":"secret"}',
      },
    ],
    events: [],
  },
];

const snapshot: ExternalAgentStoreSnapshot = {
  hosts: [
    {
      id: "local-host",
      name: "Local or3-intern",
      baseUrl: "http://127.0.0.1:9100",
      credentialRef: "visual-only",
      trustedAt: new Date().toISOString(),
    },
  ],
  activeHostId: "local-host",
  connectionState: "online",
  connectionError: null,
  generation: 1,
  health: { status: "ok", runtimeAvailable: true },
  readiness: { status: "ready", ready: true },
  capabilities: {
    hostId: "local-host",
    execAvailable: true,
    approvalBroker: { enabled: true, available: true },
  },
  runners: [
    {
      id: "codex",
      display_name: "Codex",
      status: "available",
      auth_status: "ready",
      supports: {
        chat: {
          chatSelectable: true,
          chatReplay: true,
          cancel: true,
          approvalDecisions: true,
        },
      },
      models: [
        {
          id: "gpt-5.6-luna",
          display_name: "GPT-5.6 Luna",
          provider_name: "OpenAI Codex",
        },
        {
          id: "gpt-5.6-sol",
          display_name: "GPT-5.6 Sol",
          provider_name: "OpenAI Codex",
        },
      ],
    },
  ],
  sessions: state.value === "empty" || state.value === "new" ? [] : sessions,
  sessionRefs: [],
};

const listeners = new Set<(event: ExternalAgentStoreEvent) => void>();
const fakeController = {
  snapshot,
  pinCredentialStatus: {
    supported: true,
    configured: false,
    locked: false,
    persistedCredentialCount: 0,
  },
  subscribe(listener: (event: ExternalAgentStoreEvent) => void) {
    listeners.add(listener);
    listener({ type: "snapshot", snapshot });
    return () => listeners.delete(listener);
  },
  canCancel(session: ExternalAgentSession) {
    return session.status === "running";
  },
  canDecideApproval(session: ExternalAgentSession) {
    return session.status === "waiting_approval";
  },
  canFollowUp(session: ExternalAgentSession) {
    return session.status === "succeeded" || session.status === "failed";
  },
  canReadArtifact() {
    return true;
  },
  async ensureSession() {},
  async cancel() {},
  async decideApproval() {},
  async followUp() {},
  async readArtifact() {},
  async addTrustedHost() {},
  async reconnect() {
    return true;
  },
  async unlockCredentials() {},
  lockCredentials() {},
  async clearActiveHostCredential() {},
  async switchHost() {
    return true;
  },
  disconnect() {},
} as unknown as ExternalAgentController;

setExternalAgentController(fakeController);

const recordId = computed(() =>
  state.value === "new" || state.value === "empty"
    ? EXTERNAL_AGENT_LAUNCHER_REF
    : encodeExternalAgentSessionRef({
        hostId: "local-host",
        remoteSessionId: selectedId.value,
      }),
);

if (route.query.theme === "dark") {
  useColorMode().preference = "dark";
}

onBeforeUnmount(resetExternalAgentRuntimeForTests);
</script>

<style scoped>
.agent-visual-shell {
  display: grid;
  grid-template-columns: 22rem minmax(0, 1fr);
  height: 100dvh;
  min-height: 0;
  overflow: hidden;
  background: var(--md-surface);
}

.agent-visual-sidebar {
  min-height: 0;
  border-right: 1px solid var(--md-outline-variant);
}

@media (max-width: 720px) {
  .agent-visual-shell {
    grid-template-columns: minmax(0, 1fr);
  }

  .agent-visual-sidebar {
    display: none;
  }
}
</style>
