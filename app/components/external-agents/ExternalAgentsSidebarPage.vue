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
        v-if="!connected || !hasAvailableRunner"
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
      :ui="{
        overlay: 'bg-black/35 backdrop-blur-[3px]',
        content:
          'sm:max-w-[900px] overflow-hidden border-[var(--md-border-width)] border-[var(--md-outline-variant)] bg-[var(--md-surface-container-lowest)] shadow-2xl',
        header: 'border-b border-[var(--md-outline-variant)] px-5 py-4 sm:px-6',
        body: 'p-0 sm:p-0',
        close: 'top-4 end-4',
      }"
    >
      <template #title>
        <span class="flex min-w-0 items-center gap-2">
          <span
            class="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--md-primary-container)] text-[var(--md-on-primary-container)]"
          >
            <UIcon name="i-lucide-network" class="size-4" />
          </span>
          <span class="truncate text-base font-semibold sm:text-lg">
            Agent connections
          </span>
        </span>
      </template>
      <template #description>
        <span
          class="hidden pl-10 text-xs text-[var(--md-on-surface-variant)] sm:block"
        >
          Connect OR3 to the trusted machines that run your agents.
        </span>
      </template>

      <template #body>
        <div
          class="grid max-h-[min(76vh,700px)] min-h-0 md:grid-cols-[240px_minmax(0,1fr)]"
          data-testid="agent-connections-modal"
        >
          <aside
            class="border-b border-[var(--md-outline-variant)] bg-[var(--md-surface-container-low)] p-4 md:border-b-0 md:border-r md:p-5"
            aria-label="Saved hosts"
          >
            <div class="mb-3 flex items-center justify-between">
              <div>
                <h3 class="text-xs font-semibold uppercase tracking-wider">
                  Trusted hosts
                </h3>
                <p
                  class="mt-0.5 text-[11px] text-[var(--md-on-surface-variant)]"
                >
                  {{ hostItems.length }}
                  {{ hostItems.length === 1 ? "connection" : "connections" }}
                </p>
              </div>
              <UButton
                size="xs"
                variant="outline"
                color="neutral"
                square
                icon="i-lucide-plus"
                aria-label="Add a trusted host"
                @click="focusAddHost"
              />
            </div>

            <div v-if="hostItems.length" class="space-y-1.5">
              <button
                v-for="host in hostItems"
                :key="host.value"
                type="button"
                class="group w-full rounded-[var(--md-border-radius)] border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-[var(--md-primary)]"
                :class="
                  host.value === snapshot?.activeHostId
                    ? 'border-[var(--md-primary)] bg-[var(--md-surface-container-lowest)] shadow-sm'
                    : 'border-transparent hover:border-[var(--md-outline-variant)] hover:bg-[var(--md-surface-container-lowest)]'
                "
                :aria-pressed="host.value === snapshot?.activeHostId"
                @click="switchHost(host.value)"
              >
                <div class="flex items-center gap-2">
                  <span
                    class="size-2 shrink-0 rounded-full"
                    :class="
                      host.value === snapshot?.activeHostId && connected
                        ? 'bg-[var(--md-extended-color-success-color)]'
                        : 'bg-[var(--md-on-surface-variant)] opacity-45'
                    "
                  />
                  <span class="min-w-0 flex-1 truncate text-sm font-medium">
                    {{ host.label }}
                  </span>
                  <span
                    v-if="host.value === snapshot?.activeHostId"
                    class="rounded-full bg-[var(--md-primary-container)] px-2 py-0.5 text-[10px] font-semibold text-[var(--md-on-primary-container)]"
                  >
                    Active
                  </span>
                </div>
                <p
                  class="mt-1 truncate pl-4 text-[11px] text-[var(--md-on-surface-variant)]"
                >
                  {{ host.description }}
                </p>
              </button>
            </div>

            <div
              v-else
              class="rounded-[var(--md-border-radius)] border border-dashed border-[var(--md-outline-variant)] bg-[var(--md-surface-container-lowest)] p-4 text-center"
            >
              <span
                class="mx-auto grid size-9 place-items-center rounded-full bg-[var(--md-primary-container)] text-[var(--md-on-primary-container)]"
              >
                <UIcon name="i-lucide-server-cog" class="size-4" />
              </span>
              <p class="mt-2 text-sm font-medium">No hosts yet</p>
              <p
                class="mt-1 text-xs leading-relaxed text-[var(--md-on-surface-variant)]"
              >
                Add the machine where your agent runtime is available.
              </p>
            </div>

            <div
              class="mt-4 hidden rounded-[var(--md-border-radius)] border border-[var(--md-outline-variant)] bg-[var(--md-surface-container-lowest)] p-3 md:block"
            >
              <div class="flex items-start gap-2">
                <UIcon
                  name="i-lucide-shield-check"
                  class="mt-0.5 size-4 shrink-0 text-[var(--md-primary)]"
                />
                <p
                  class="text-[11px] leading-relaxed text-[var(--md-on-surface-variant)]"
                >
                  Tokens stay on this device and are never included in chats or
                  Activity.
                </p>
              </div>
            </div>
          </aside>

          <div class="min-h-0 overflow-y-auto">
            <section
              v-if="activeHost"
              class="border-b border-[var(--md-outline-variant)] p-4 sm:p-5"
              aria-labelledby="current-connection-title"
            >
              <div class="flex flex-wrap items-start gap-3">
                <span
                  class="grid size-10 shrink-0 place-items-center rounded-[var(--md-border-radius)]"
                  :class="
                    connected
                      ? 'bg-[color-mix(in_srgb,var(--md-extended-color-success-color)_14%,transparent)] text-[var(--md-extended-color-success-color)]'
                      : 'bg-[var(--md-surface-container)] text-[var(--md-on-surface-variant)]'
                  "
                >
                  <UIcon
                    :name="
                      connected
                        ? 'i-lucide-circle-check'
                        : 'i-lucide-server-off'
                    "
                    class="size-5"
                  />
                </span>
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <h3
                      id="current-connection-title"
                      class="truncate text-sm font-semibold"
                    >
                      {{ activeHost.name }}
                    </h3>
                    <span
                      class="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                      :class="connectionStatusClasses"
                    >
                      {{ connectionStatusLabel }}
                    </span>
                  </div>
                  <p
                    class="mt-0.5 truncate text-xs text-[var(--md-on-surface-variant)]"
                  >
                    {{ activeHost.baseUrl }}
                  </p>
                  <p
                    v-if="
                      snapshot?.connectionError && !pinCredentialStatus.locked
                    "
                    class="mt-2 text-xs text-[var(--md-error)]"
                    role="status"
                  >
                    {{ snapshot.connectionError }}
                  </p>
                  <p
                    v-else-if="connected"
                    class="mt-2 text-xs text-[var(--md-on-surface-variant)]"
                  >
                    Connected and ready to start agent sessions.
                  </p>
                </div>
                <div
                  v-if="!pinCredentialStatus.locked"
                  class="flex shrink-0 flex-wrap gap-1"
                >
                  <UTooltip
                    :text="connected ? 'Refresh agents' : 'Reconnect'"
                    :delay-duration="0"
                  >
                    <UButton
                      size="sm"
                      variant="soft"
                      :icon="
                        connected ? 'i-lucide-refresh-cw' : 'i-lucide-plug-zap'
                      "
                      :loading="hostActionPending"
                      @click="retryConnection"
                    >
                      {{ connected ? "Refresh" : "Reconnect" }}
                    </UButton>
                  </UTooltip>
                  <UTooltip
                    v-if="connected"
                    text="Disconnect"
                    :delay-duration="0"
                  >
                    <UButton
                      size="sm"
                      variant="ghost"
                      color="neutral"
                      square
                      icon="i-lucide-unplug"
                      aria-label="Disconnect"
                      @click="controller?.disconnect()"
                    />
                  </UTooltip>
                  <UTooltip
                    v-if="pinCredentialStatus.configured"
                    text="Lock saved token"
                    :delay-duration="0"
                  >
                    <UButton
                      size="sm"
                      variant="ghost"
                      color="neutral"
                      square
                      icon="i-lucide-lock"
                      aria-label="Lock saved token"
                      @click="lockSavedCredentials"
                    />
                  </UTooltip>
                </div>
              </div>

              <div
                v-if="pinCredentialStatus.locked"
                class="mt-4 overflow-hidden rounded-[var(--md-border-radius)] border border-[var(--md-primary)] bg-[color-mix(in_srgb,var(--md-primary)_5%,var(--md-surface-container-lowest))]"
              >
                <div class="flex items-start gap-3 p-4">
                  <span
                    class="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--md-primary-container)] text-[var(--md-on-primary-container)]"
                  >
                    <UIcon name="i-lucide-lock-keyhole" class="size-4" />
                  </span>
                  <div>
                    <p class="text-sm font-semibold">Unlock saved token</p>
                    <p
                      class="mt-0.5 text-xs leading-relaxed text-[var(--md-on-surface-variant)]"
                    >
                      Enter your device PIN to decrypt the token for this
                      browser session.
                    </p>
                  </div>
                </div>
                <div
                  class="grid gap-2 border-t border-[var(--md-outline-variant)] bg-[var(--md-surface-container-lowest)] p-3 sm:grid-cols-[minmax(0,1fr)_auto]"
                >
                  <UInput
                    v-model="unlockPin"
                    type="password"
                    inputmode="numeric"
                    autocomplete="current-password"
                    placeholder="Enter device PIN"
                    aria-label="Device PIN"
                    icon="i-lucide-key-round"
                    @keyup.enter="unlockAndReconnect"
                  />
                  <UButton
                    icon="i-lucide-unlock"
                    :loading="hostActionPending"
                    @click="unlockAndReconnect"
                  >
                    Unlock and reconnect
                  </UButton>
                  <UButton
                    class="justify-self-start sm:col-span-2"
                    size="xs"
                    variant="link"
                    color="error"
                    @click="clearSavedCredential"
                  >
                    Forget saved token
                  </UButton>
                </div>
              </div>
            </section>

            <form
              ref="addHostSection"
              class="p-4 sm:p-5"
              @submit.prevent="addHost"
            >
              <div class="mb-4 flex items-start gap-3">
                <span
                  class="grid size-9 shrink-0 place-items-center rounded-[var(--md-border-radius)] bg-[var(--md-surface-container-low)] text-[var(--md-primary)]"
                >
                  <UIcon name="i-lucide-server-cog" class="size-4" />
                </span>
                <div>
                  <h3 class="text-sm font-semibold">Add a trusted host</h3>
                  <p class="mt-0.5 text-xs text-[var(--md-on-surface-variant)]">
                    Use the URL and access token provided by or3-intern.
                  </p>
                </div>
              </div>

              <div class="grid gap-3 sm:grid-cols-2">
                <label class="space-y-1.5">
                  <span class="text-xs font-medium">Name</span>
                  <UInput
                    v-model="hostName"
                    class="w-full"
                    placeholder="Host name"
                    aria-label="Host name"
                    icon="i-lucide-tag"
                  />
                </label>
                <label class="space-y-1.5">
                  <span class="text-xs font-medium">Host URL</span>
                  <UInput
                    v-model="hostUrl"
                    class="w-full"
                    type="url"
                    placeholder="http://127.0.0.1:9100"
                    aria-label="Host URL"
                    icon="i-lucide-link"
                    required
                  />
                </label>
                <label class="space-y-1.5 sm:col-span-2">
                  <span class="text-xs font-medium">Access token</span>
                  <UInput
                    v-model="hostToken"
                    class="w-full"
                    type="password"
                    autocomplete="off"
                    placeholder="Access token"
                    aria-label="Access token"
                    icon="i-lucide-key-round"
                    required
                  />
                </label>
              </div>

              <div
                v-if="pinCredentialStatus.supported"
                class="mt-4 rounded-[var(--md-border-radius)] border border-[var(--md-outline-variant)] bg-[var(--md-surface-container-low)] p-3"
              >
                <UCheckbox
                  v-model="rememberToken"
                  label="Remember token on this device"
                />
                <p
                  class="mt-1 pl-7 text-[11px] leading-relaxed text-[var(--md-on-surface-variant)]"
                >
                  {{
                    rememberToken
                      ? "Encrypted with your PIN and stored only in this browser."
                      : "Session only — the token is forgotten when OR3 reloads."
                  }}
                </p>

                <div
                  v-if="rememberToken"
                  class="mt-3 border-t border-[var(--md-outline-variant)] pt-3"
                >
                  <div class="mb-3 flex items-start gap-2">
                    <UIcon
                      name="i-lucide-shield-alert"
                      class="mt-0.5 size-4 shrink-0 text-[var(--md-extended-color-warning-color)]"
                    />
                    <p
                      class="text-[11px] leading-relaxed text-[var(--md-on-surface-variant)]"
                    >
                      <strong class="font-semibold text-[var(--md-on-surface)]"
                        >Local encrypted storage.</strong
                      >
                      Use a unique PIN. A short or reused PIN may be
                      brute-forced if browser data is copied, and a forgotten
                      PIN cannot be recovered.
                    </p>
                  </div>
                  <div class="grid gap-2 sm:grid-cols-2">
                    <UInput
                      v-model="credentialPin"
                      type="password"
                      inputmode="numeric"
                      autocomplete="new-password"
                      placeholder="PIN (6+ digits)"
                      aria-label="Credential PIN"
                      icon="i-lucide-lock-keyhole"
                    />
                    <UInput
                      v-model="credentialPinConfirmation"
                      type="password"
                      inputmode="numeric"
                      autocomplete="new-password"
                      placeholder="Confirm PIN"
                      aria-label="Confirm credential PIN"
                      icon="i-lucide-check"
                    />
                  </div>
                </div>
              </div>
              <p
                v-else
                class="mt-3 text-xs text-[var(--md-on-surface-variant)]"
              >
                Session only: the token is forgotten when OR3 reloads and is
                never shown in conversations or Activity.
              </p>

              <div
                class="mt-4 flex flex-col-reverse gap-3 border-t border-[var(--md-outline-variant)] pt-4 sm:flex-row sm:items-center"
              >
                <p
                  v-if="formError"
                  class="min-w-0 flex-1 text-xs text-[var(--md-error)]"
                  role="alert"
                >
                  {{ formError }}
                </p>
                <p
                  v-else
                  class="min-w-0 flex-1 text-[11px] text-[var(--md-on-surface-variant)]"
                >
                  Credentials are sent in authorization headers, never URLs.
                </p>
                <UButton
                  type="submit"
                  class="justify-center sm:min-w-36"
                  icon="i-lucide-plug-zap"
                  :loading="hostActionPending"
                >
                  Save and connect
                </UButton>
              </div>
            </form>
          </div>
        </div>
      </template>
    </UModal>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
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
const rememberToken = ref(false);
const credentialPin = ref("");
const credentialPinConfirmation = ref("");
const unlockPin = ref("");
const credentialStateVersion = ref(0);
const hostActionPending = ref(false);
const formError = ref<string | null>(null);
const collapsed = ref(new Set<TimeGroup>());
const addHostSection = ref<HTMLElement | null>(null);

const pinCredentialStatus = computed(() => {
  credentialStateVersion.value;
  return (
    controller?.pinCredentialStatus ?? {
      supported: false as const,
      configured: false,
      locked: false,
      persistedCredentialCount: 0,
    }
  );
});
const connected = computed(
  () =>
    snapshot.value?.connectionState === "online" ||
    snapshot.value?.connectionState === "degraded",
);
const hasAvailableRunner = computed(() =>
  (snapshot.value?.runners ?? []).some(
    (runner) =>
      runner.status === "available" &&
      (runner.auth_status === "ready" ||
        runner.auth_status === "unknown" ||
        !runner.auth_status),
  ),
);
const hostItems = computed(() =>
  (snapshot.value?.hosts ?? []).map((host) => ({
    value: host.id,
    label: host.name,
    description: host.baseUrl,
  })),
);
const activeHost = computed(
  () =>
    snapshot.value?.hosts.find(
      (host) => host.id === snapshot.value?.activeHostId,
    ) ?? null,
);
const connectionStatusLabel = computed(() => {
  if (pinCredentialStatus.value.locked) return "Locked";
  if (snapshot.value?.connectionState === "connecting") return "Connecting";
  if (snapshot.value?.connectionState === "degraded") return "Limited";
  if (snapshot.value?.connectionState === "online") return "Connected";
  if (snapshot.value?.connectionState === "offline") return "Offline";
  return "Disconnected";
});
const connectionStatusClasses = computed(() => {
  if (connected.value) {
    return "bg-[color-mix(in_srgb,var(--md-extended-color-success-color)_14%,transparent)] text-[var(--md-extended-color-success-color)]";
  }
  if (snapshot.value?.connectionState === "connecting") {
    return "bg-[var(--md-primary-container)] text-[var(--md-on-primary-container)]";
  }
  return "bg-[var(--md-surface-container)] text-[var(--md-on-surface-variant)]";
});
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
  if (!hasAvailableRunner.value) return "No agents are ready";
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

async function focusAddHost() {
  await nextTick();
  addHostSection.value?.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
  addHostSection.value
    ?.querySelector<HTMLInputElement>('[aria-label="Host name"]')
    ?.focus();
}

function requestedPersistencePin(): string | undefined {
  if (!rememberToken.value) return undefined;
  if (credentialPin.value !== credentialPinConfirmation.value) {
    throw new Error("The PIN confirmation does not match.");
  }
  if (!/^\d{6,}$/.test(credentialPin.value.trim())) {
    throw new Error("Use a PIN with at least 6 digits.");
  }
  return credentialPin.value.trim();
}

function clearCredentialForm() {
  hostToken.value = "";
  credentialPin.value = "";
  credentialPinConfirmation.value = "";
  unlockPin.value = "";
  rememberToken.value = false;
  credentialStateVersion.value += 1;
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
      persistencePin: requestedPersistencePin(),
    });
    clearCredentialForm();
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
    const didConnect = await controller.reconnect(
      hostToken.value || undefined,
      requestedPersistencePin(),
    );
    if (didConnect) {
      clearCredentialForm();
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

async function unlockAndReconnect() {
  if (!controller) return;
  hostActionPending.value = true;
  formError.value = null;
  try {
    await controller.unlockCredentials(unlockPin.value);
    credentialStateVersion.value += 1;
    const didConnect = await controller.reconnect();
    if (!didConnect) {
      formError.value =
        controller.snapshot.connectionError ?? "Reconnect failed";
    } else {
      unlockPin.value = "";
    }
  } catch (cause) {
    formError.value =
      cause instanceof Error ? cause.message : "Could not unlock the token";
  } finally {
    hostActionPending.value = false;
  }
}

function lockSavedCredentials() {
  controller?.lockCredentials();
  credentialStateVersion.value += 1;
}

async function clearSavedCredential() {
  if (!controller) return;
  hostActionPending.value = true;
  formError.value = null;
  try {
    await controller.clearActiveHostCredential();
    clearCredentialForm();
  } catch (cause) {
    formError.value =
      cause instanceof Error ? cause.message : "Could not remove the token";
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
