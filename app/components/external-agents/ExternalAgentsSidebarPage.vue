<template>
  <section class="flex h-full min-h-0 flex-col" aria-label="Agents">
    <header class="shrink-0 space-y-2 px-3 py-2">
      <div class="flex items-center justify-between gap-2">
        <UButton
          variant="ghost"
          color="neutral"
          size="sm"
          icon="i-lucide-chevron-left"
          @click="setActivePage('sidebar-home')"
        >
          Home
        </UButton>
        <div class="flex items-center gap-1">
          <UTooltip text="Connection settings" :delay-duration="0">
            <UButton
              variant="ghost"
              color="neutral"
              size="sm"
              icon="i-lucide-settings-2"
              aria-label="Connection settings"
              @click="showConnections = true"
            />
          </UTooltip>
          <UButton
            size="sm"
            variant="soft"
            icon="i-lucide-bot"
            @click="openLauncher"
          >
            New agent
          </UButton>
        </div>
      </div>

      <UInput
        v-model="query"
        icon="i-lucide-search"
        placeholder="Search agent sessions"
        aria-label="Search agent sessions"
        class="w-full"
      />
    </header>

    <div
      v-if="connectionNotice"
      class="mx-3 mb-2 flex items-center gap-2 rounded-[var(--md-border-radius)] bg-[var(--md-surface-container-low)] px-3 py-2"
    >
      <span
        class="size-2 shrink-0 rounded-full"
        :class="
          connected
            ? 'bg-[var(--md-extended-color-success-color)]'
            : 'bg-[var(--md-error)]'
        "
      />
      <p class="min-w-0 flex-1 truncate text-xs">{{ connectionNotice }}</p>
      <UButton
        v-if="!connected"
        size="xs"
        variant="ghost"
        @click="showConnections = true"
      >
        Fix
      </UButton>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
      <SidebarEmptyState
        v-if="!history.length"
        title="No agent sessions yet"
        description="Start with an instruction. Tools, approvals, and results will appear in the conversation."
        icon="i-lucide-bot"
      >
        <template #actions>
          <UButton size="sm" @click="openLauncher">New agent</UButton>
          <UButton
            v-if="!snapshot?.hosts.length"
            size="sm"
            variant="soft"
            @click="showConnections = true"
          >
            Connect host
          </UButton>
        </template>
      </SidebarEmptyState>

      <div
        v-else-if="!filteredHistory.length"
        class="grid min-h-48 place-items-center px-4 text-center"
      >
        <div>
          <UIcon
            name="i-lucide-search-x"
            class="mx-auto mb-2 size-6 text-[var(--md-on-surface-variant)]"
          />
          <p class="text-sm font-medium">No matching sessions</p>
          <p class="mt-1 text-xs text-[var(--md-on-surface-variant)]">
            Try a different title, provider, or result.
          </p>
        </div>
      </div>

      <section
        v-for="group in groupedHistory"
        v-else
        :key="group.key"
        class="mb-2"
      >
        <SidebarGroupHeader
          :label="group.label"
          :collapsed="collapsed.has(group.key)"
          @toggle="toggleGroup(group.key)"
        />
        <div v-if="!collapsed.has(group.key)" class="space-y-0.5">
          <button
            v-for="item in group.items"
            :key="item.key"
            type="button"
            class="group w-full rounded-[var(--md-border-radius)] px-2.5 py-2 text-left transition-colors hover:bg-[var(--md-surface-hover)] focus-visible:outline-2 focus-visible:outline-[var(--md-primary)]"
            :class="
              activeRecordId === item.recordId
                ? 'bg-[var(--md-surface-active)]'
                : ''
            "
            :aria-current="
              activeRecordId === item.recordId ? 'page' : undefined
            "
            @click="openHistory(item)"
          >
            <div class="flex items-start gap-2">
              <span class="mt-1 grid size-4 shrink-0 place-items-center">
                <UIcon
                  v-if="item.status === 'running' || item.status === 'queued'"
                  name="i-lucide-loader-circle"
                  class="size-3.5 animate-spin"
                />
                <UIcon
                  v-else-if="item.pendingApprovalCount"
                  name="i-lucide-shield-alert"
                  class="size-3.5 text-[var(--md-extended-color-warning-color)]"
                />
                <UIcon
                  v-else-if="item.status === 'failed'"
                  name="i-lucide-circle-alert"
                  class="size-3.5 text-[var(--md-error)]"
                />
                <UIcon
                  v-else
                  name="i-lucide-bot"
                  class="size-3.5 text-[var(--md-on-surface-variant)]"
                />
              </span>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span class="min-w-0 flex-1 truncate text-sm font-medium">
                    {{ item.title }}
                  </span>
                  <UBadge
                    v-if="item.pendingApprovalCount"
                    color="warning"
                    variant="soft"
                    size="xs"
                    :aria-label="`${item.pendingApprovalCount} pending approvals`"
                  >
                    {{ item.pendingApprovalCount }}
                  </UBadge>
                  <time
                    class="shrink-0 text-[10px] text-[var(--md-on-surface-variant)]"
                  >
                    {{ item.timeLabel }}
                  </time>
                </div>
                <p
                  v-if="item.preview"
                  class="mt-0.5 line-clamp-2 text-xs text-[var(--md-on-surface-variant)]"
                >
                  {{ item.preview }}
                </p>
                <p
                  class="mt-0.5 truncate text-[10px] text-[var(--md-on-surface-variant)] opacity-70"
                >
                  {{ item.runnerLabel }} · {{ statusText(item.status) }}
                </p>
              </div>
            </div>
          </button>
        </div>
      </section>
    </div>

    <footer
      class="flex shrink-0 items-center gap-2 border-t border-[var(--md-outline-variant)] px-3 py-2"
    >
      <span
        class="size-2 rounded-full"
        :class="
          connected
            ? 'bg-[var(--md-extended-color-success-color)]'
            : 'bg-[var(--md-on-surface-variant)]'
        "
      />
      <span
        class="min-w-0 flex-1 truncate text-xs text-[var(--md-on-surface-variant)]"
      >
        {{ activeHostName }}
      </span>
      <span v-if="runningCount" class="text-xs"
        >{{ runningCount }} running</span
      >
      <span v-if="approvalCount" class="text-xs"
        >{{ approvalCount }} waiting</span
      >
    </footer>

    <UModal
      v-model:open="showConnections"
      title="Agent connections"
      description="Manage trusted or3-intern hosts and credentials."
    >
      <template #body>
        <div class="space-y-4">
          <div v-if="hostItems.length" class="space-y-2">
            <label class="text-xs font-semibold">Trusted host</label>
            <USelectMenu
              :model-value="snapshot?.activeHostId ?? ''"
              :items="hostItems"
              value-key="value"
              label-key="label"
              class="w-full"
              @update:model-value="switchHost"
            />
            <div class="flex flex-wrap gap-2">
              <UButton
                v-if="!connected"
                size="sm"
                variant="soft"
                icon="i-lucide-refresh-cw"
                :loading="hostActionPending"
                @click="retryConnection"
              >
                Reconnect
              </UButton>
              <UButton
                v-if="connected"
                size="sm"
                variant="ghost"
                icon="i-lucide-unplug"
                @click="controller?.disconnect()"
              >
                Disconnect
              </UButton>
            </div>
          </div>

          <form class="space-y-3" @submit.prevent="addHost">
            <h3 class="text-sm font-semibold">Add a trusted host</h3>
            <UInput v-model="hostName" placeholder="Host name" />
            <UInput
              v-model="hostUrl"
              type="url"
              placeholder="http://127.0.0.1:9100"
            />
            <UInput
              v-model="hostToken"
              type="password"
              autocomplete="off"
              placeholder="Access token"
            />
            <p class="text-xs text-[var(--md-on-surface-variant)]">
              The token is kept in the configured credential vault. It is never
              shown in conversations or activity.
            </p>
            <div class="flex justify-end">
              <UButton type="submit" size="sm" :loading="hostActionPending">
                Save and connect
              </UButton>
            </div>
          </form>

          <p v-if="formError" class="text-sm text-[var(--md-error)]">
            {{ formError }}
          </p>
        </div>
      </template>
    </UModal>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import type {
  ExternalAgentRunStatus,
  ExternalAgentSessionRef,
} from "~/core/external-agents/types";
import {
  encodeExternalAgentSessionRef,
  EXTERNAL_AGENT_LAUNCHER_REF,
  EXTERNAL_AGENT_PANE_APP_ID,
} from "~/core/external-agents/refs";
import { useExternalAgentRuntime } from "~/core/external-agents/runtime";
import { useActiveSidebarPage } from "~/composables/sidebar/useActiveSidebarPage";
import { getGlobalMultiPaneApi } from "~/utils/multiPaneApi";
import {
  computeTimeGroup,
  formatTimeDisplay,
  getTimeGroupLabel,
  type TimeGroup,
} from "~/utils/sidebar/sidebarTimeUtils";

interface HistoryItem {
  key: string;
  recordId: string;
  hostId: string;
  remoteSessionId: string;
  title: string;
  runnerLabel: string;
  updatedAt: string;
  status: ExternalAgentRunStatus;
  pendingApprovalCount: number;
  preview?: string;
  timeGroup: TimeGroup;
  timeLabel: string;
}

const runtime = useExternalAgentRuntime();
const controller = runtime.controller;
const snapshot = runtime.snapshot;
const { setActivePage } = useActiveSidebarPage();
const query = ref("");
const showConnections = ref(false);
const hostName = ref("");
const hostUrl = ref("http://127.0.0.1:9100");
const hostToken = ref("");
const hostActionPending = ref(false);
const formError = ref<string | null>(null);
const collapsed = ref(new Set<TimeGroup>());

const connected = computed(
  () =>
    snapshot.value?.connectionState === "online" ||
    snapshot.value?.connectionState === "degraded",
);
const hostItems = computed(() =>
  (snapshot.value?.hosts ?? []).map((host) => ({
    value: host.id,
    label: host.name,
  })),
);
const activeHostName = computed(
  () =>
    snapshot.value?.hosts.find(
      (host) => host.id === snapshot.value?.activeHostId,
    )?.name ?? "No agent host",
);
const connectionNotice = computed(() => {
  if (!snapshot.value?.hosts.length) return "Connect an agent host";
  if (!connected.value)
    return snapshot.value.connectionError ?? "Agent host disconnected";
  if (snapshot.value.connectionState === "degraded")
    return "Agent host has limited availability";
  return null;
});
const runnerNames = computed(
  () =>
    new Map(
      (snapshot.value?.runners ?? []).map((runner) => [
        runner.id,
        runner.display_name,
      ]),
    ),
);
const activeRecordId = computed(() => {
  const api = getGlobalMultiPaneApi();
  const pane = api?.panes.value[api.activePaneIndex.value];
  return pane?.mode === EXTERNAL_AGENT_PANE_APP_ID
    ? (pane.documentId ?? null)
    : null;
});
const history = computed<HistoryItem[]>(() => {
  const refs = new Map<string, ExternalAgentSessionRef>();
  for (const item of snapshot.value?.sessionRefs ?? []) {
    refs.set(`${item.hostId}:${item.remoteSessionId}`, item);
  }
  for (const session of snapshot.value?.sessions ?? []) {
    refs.set(`${session.hostId}:${session.remoteSessionId}`, {
      hostId: session.hostId,
      remoteSessionId: session.remoteSessionId,
      title: session.title,
      runnerId: session.runnerId,
      updatedAt: session.updatedAt,
      status: session.status,
      pendingApprovalCount: session.approvals.filter(
        (approval) => approval.status === "pending",
      ).length,
      preview:
        session.output ??
        session.turns.at(-1)?.final_text ??
        session.turns.at(-1)?.user_message,
    });
  }
  return [...refs.values()]
    .map((item) => {
      const updatedAt = item.updatedAt ?? new Date(0).toISOString();
      const timestamp = Number.isFinite(Date.parse(updatedAt))
        ? Date.parse(updatedAt) / 1000
        : 0;
      const timeGroup = computeTimeGroup(timestamp);
      return {
        key: `${item.hostId}:${item.remoteSessionId}`,
        recordId: encodeExternalAgentSessionRef(item),
        hostId: item.hostId,
        remoteSessionId: item.remoteSessionId,
        title: item.title?.trim() || "Untitled agent session",
        runnerLabel:
          runnerNames.value.get(item.runnerId ?? "") ??
          item.runnerId ??
          "Agent",
        updatedAt,
        status: item.status ?? "succeeded",
        pendingApprovalCount: item.pendingApprovalCount ?? 0,
        preview: item.preview?.slice(0, 240),
        timeGroup,
        timeLabel: formatTimeDisplay(timestamp, timeGroup),
      };
    })
    .sort(
      (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
    );
});
const filteredHistory = computed(() => {
  const needle = query.value.trim().toLowerCase();
  if (!needle) return history.value;
  return history.value.filter((item) =>
    [item.title, item.runnerLabel, item.preview]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(needle)),
  );
});
const groupedHistory = computed(() => {
  const order: TimeGroup[] = [
    "today",
    "yesterday",
    "earlierThisWeek",
    "thisMonth",
    "older",
  ];
  return order
    .map((key) => ({
      key,
      label: getTimeGroupLabel(key),
      items: filteredHistory.value.filter((item) => item.timeGroup === key),
    }))
    .filter((group) => group.items.length);
});
const runningCount = computed(
  () =>
    history.value.filter(
      (item) => item.status === "running" || item.status === "queued",
    ).length,
);
const approvalCount = computed(() =>
  history.value.reduce((total, item) => total + item.pendingApprovalCount, 0),
);

function statusText(status: ExternalAgentRunStatus) {
  if (status === "waiting_approval") return "needs approval";
  if (status === "succeeded") return "completed";
  return status;
}

function toggleGroup(group: TimeGroup) {
  const next = new Set(collapsed.value);
  if (next.has(group)) next.delete(group);
  else next.add(group);
  collapsed.value = next;
}

async function openRecord(recordId: string) {
  const api = getGlobalMultiPaneApi();
  if (!api) {
    formError.value = "The workspace pane host is unavailable.";
    return;
  }
  const index = api.activePaneIndex.value;
  if (api.panes.value[index]) {
    await api.setPaneApp(index, EXTERNAL_AGENT_PANE_APP_ID, { recordId });
  } else {
    await api.newPaneForApp(EXTERNAL_AGENT_PANE_APP_ID, {
      initialRecordId: recordId,
    });
  }
}

async function openHistory(item: HistoryItem) {
  await openRecord(item.recordId);
}

async function openLauncher() {
  await openRecord(EXTERNAL_AGENT_LAUNCHER_REF);
}

async function addHost() {
  if (!controller) return;
  hostActionPending.value = true;
  formError.value = null;
  try {
    await controller.addTrustedHost({
      name: hostName.value,
      baseUrl: hostUrl.value,
      token: hostToken.value,
    });
    hostToken.value = "";
    hostName.value = "";
    showConnections.value = false;
  } catch (cause) {
    formError.value =
      cause instanceof Error ? cause.message : "Host enrollment failed";
  } finally {
    hostActionPending.value = false;
  }
}

async function retryConnection() {
  if (!controller) return;
  hostActionPending.value = true;
  formError.value = null;
  try {
    const didConnect = await controller.reconnect(hostToken.value || undefined);
    if (didConnect) {
      hostToken.value = "";
      return;
    }
    formError.value = controller.snapshot.connectionError ?? "Reconnect failed";
  } catch (cause) {
    formError.value =
      cause instanceof Error ? cause.message : "Reconnect failed";
  } finally {
    hostActionPending.value = false;
  }
}

async function switchHost(value: string) {
  formError.value = null;
  try {
    await controller?.switchHost(value);
  } catch (cause) {
    formError.value =
      cause instanceof Error ? cause.message : "Host switch failed";
  }
}
</script>
