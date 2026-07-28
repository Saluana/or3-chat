<template>
  <section class="flex h-full min-h-0 flex-col" aria-label="External Agents">
    <header
      class="shrink-0 space-y-3 border-b border-[var(--md-outline-variant)] px-3 py-3"
    >
      <div class="flex items-center justify-between gap-2">
        <div>
          <h1 class="font-semibold">External Agents</h1>
          <p class="text-xs text-[var(--md-on-surface-variant)]">
            Coding sessions run on your trusted or3-intern host.
          </p>
        </div>
        <UBadge :color="connectionColor" variant="soft">
          {{ connectionLabel }}
        </UBadge>
      </div>
      <p
        v-if="snapshot?.activeHostId"
        class="text-[11px] text-[var(--md-on-surface-variant)]"
      >
        Health: {{ snapshot.health?.status ?? "unavailable" }}
        · Readiness:
        {{
          snapshot.readiness
            ? snapshot.readiness.ready
              ? "ready"
              : snapshot.readiness.status
            : "unavailable"
        }}
      </p>

      <USelectMenu
        v-if="hostItems.length"
        :model-value="snapshot?.activeHostId ?? ''"
        :items="hostItems"
        value-key="value"
        label-key="label"
        class="w-full"
        aria-label="Trusted external agent host"
        @update:model-value="switchHost"
      />

      <div class="flex flex-wrap gap-2">
        <UButton
          v-if="
            snapshot?.activeHostId &&
            snapshot.connectionState !== 'online' &&
            snapshot.connectionState !== 'connecting'
          "
          size="xs"
          variant="soft"
          icon="i-lucide-refresh-cw"
          :loading="hostActionPending"
          @click="retryConnection"
        >
          Reconnect
        </UButton>
        <UButton
          v-if="connected"
          size="xs"
          variant="ghost"
          icon="i-lucide-unplug"
          @click="controller?.disconnect()"
        >
          Disconnect
        </UButton>
        <UButton
          size="xs"
          variant="ghost"
          icon="i-lucide-plus"
          @click="showEnrollment = !showEnrollment"
        >
          Add host
        </UButton>
      </div>

      <form
        v-if="showEnrollment"
        class="space-y-2 rounded-[var(--md-border-radius)] border border-[var(--md-outline-variant)] p-3"
        @submit.prevent="addHost"
      >
        <UInput
          v-model="hostName"
          placeholder="Host name"
          aria-label="Host name"
        />
        <UInput
          v-model="hostUrl"
          type="url"
          placeholder="http://127.0.0.1:9100"
          aria-label="Host URL"
        />
        <UInput
          v-model="hostToken"
          type="password"
          autocomplete="off"
          placeholder="Access token"
          aria-label="Host access token"
        />
        <p class="text-[11px] text-[var(--md-on-surface-variant)]">
          Enter a pre-issued service access token. Host metadata is saved; the
          token stays in memory unless a secure credential adapter is installed.
          Secure QR pairing is not supported on this surface yet.
        </p>
        <div class="flex justify-end gap-2">
          <UButton
            type="button"
            size="xs"
            variant="ghost"
            @click="cancelEnrollment"
            >Cancel</UButton
          >
          <UButton type="submit" size="xs" :loading="hostActionPending"
            >Save and connect</UButton
          >
        </div>
      </form>

      <form
        v-if="showCredential"
        class="space-y-2 rounded-[var(--md-border-radius)] border border-[var(--md-outline-variant)] p-3"
        @submit.prevent="reconnect"
      >
        <UInput
          v-model="hostToken"
          type="password"
          autocomplete="off"
          placeholder="Access token"
          aria-label="Reconnect access token"
        />
        <div class="flex justify-end gap-2">
          <UButton
            type="button"
            size="xs"
            variant="ghost"
            @click="cancelCredential"
            >Cancel</UButton
          >
          <UButton type="submit" size="xs" :loading="hostActionPending"
            >Reconnect</UButton
          >
        </div>
      </form>

      <UAlert
        v-if="connectionMessage"
        :color="snapshot?.connectionState === 'offline' ? 'error' : 'warning'"
        variant="soft"
        :title="
          snapshot?.connectionState === 'offline'
            ? 'Host offline'
            : 'Connection needs attention'
        "
        :description="connectionMessage"
      />
      <p v-if="formError" class="text-xs text-[var(--md-error)]">
        {{ formError }}
      </p>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto p-3">
      <section
        v-if="connected"
        class="mb-4 space-y-2 rounded-[var(--md-border-radius)] border border-[var(--md-outline-variant)] bg-[var(--md-surface-container-low)] p-3"
      >
        <h2 class="text-sm font-semibold">New session</h2>
        <ExternalAgentLauncher compact @launched="openSession" />
      </section>

      <div
        v-if="snapshot?.connectionState === 'connecting'"
        class="py-8 text-center text-sm text-[var(--md-on-surface-variant)]"
      >
        Connecting to trusted host…
      </div>
      <div
        v-else-if="!snapshot?.hosts.length"
        class="rounded-[var(--md-border-radius)] border border-dashed border-[var(--md-outline-variant)] p-6 text-center"
      >
        <UIcon name="i-lucide-server" class="mb-2 size-7" />
        <p class="text-sm font-medium">No trusted host</p>
        <p class="mt-1 text-xs text-[var(--md-on-surface-variant)]">
          Add the address and token for an or3-intern service.
        </p>
      </div>

      <template v-else>
        <SessionGroup
          title="Running"
          :sessions="running"
          empty-label="No agents running"
          @open="openSession"
        />
        <SessionGroup
          title="Approvals"
          :sessions="approvals"
          empty-label="No approvals pending"
          @open="openSession"
        />
        <SessionGroup
          title="Failed"
          :sessions="failed"
          empty-label="No failed sessions"
          @open="openSession"
        />
        <SessionGroup
          title="Recent"
          :sessions="recent"
          empty-label="No recent sessions"
          @open="openSession"
        />
      </template>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, ref } from "vue";
import type { ExternalAgentSession } from "~/core/external-agents/types";
import {
  encodeExternalAgentSessionRef,
  EXTERNAL_AGENT_PANE_APP_ID,
} from "~/core/external-agents/refs";
import { useExternalAgentRuntime } from "~/core/external-agents/runtime";
import { getGlobalMultiPaneApi } from "~/utils/multiPaneApi";

const runtime = useExternalAgentRuntime();
const controller = runtime.controller;
const snapshot = runtime.snapshot;
const showEnrollment = ref(!snapshot.value?.hosts.length);
const showCredential = ref(false);
const hostName = ref("");
const hostUrl = ref("");
const hostToken = ref("");
const hostActionPending = ref(false);
const formError = ref<string | null>(null);

const connected = computed(
  () =>
    snapshot.value?.connectionState === "online" ||
    snapshot.value?.connectionState === "degraded",
);
const connectionLabel = computed(() =>
  (snapshot.value?.connectionState ?? "disconnected").replace("_", " "),
);
const connectionColor = computed(() => {
  if (snapshot.value?.connectionState === "online") return "success";
  if (snapshot.value?.connectionState === "offline") return "error";
  if (snapshot.value?.connectionState === "degraded") return "warning";
  return "neutral";
});
const connectionMessage = computed(
  () => snapshot.value?.connectionError ?? null,
);
const hostItems = computed(() =>
  (snapshot.value?.hosts ?? []).map((host) => ({
    value: host.id,
    label: host.name,
  })),
);
const activeSessions = computed(() =>
  (snapshot.value?.sessions ?? []).filter(
    (session) => session.hostId === snapshot.value?.activeHostId,
  ),
);
const running = computed(() =>
  activeSessions.value.filter(
    (session) => session.status === "queued" || session.status === "running",
  ),
);
const approvals = computed(() =>
  activeSessions.value.filter((session) =>
    session.approvals.some((approval) => approval.status === "pending"),
  ),
);
const failed = computed(() =>
  activeSessions.value.filter((session) => session.status === "failed"),
);
const recent = computed(() =>
  activeSessions.value.filter(
    (session) =>
      session.status === "succeeded" || session.status === "cancelled",
  ),
);

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
    showEnrollment.value = false;
  } catch (cause) {
    formError.value =
      cause instanceof Error ? cause.message : "Host enrollment failed";
  } finally {
    hostActionPending.value = false;
  }
}

function cancelEnrollment() {
  hostToken.value = "";
  showEnrollment.value = false;
  formError.value = null;
}

function cancelCredential() {
  hostToken.value = "";
  showCredential.value = false;
  formError.value = null;
}

async function reconnect() {
  if (!controller) return;
  hostActionPending.value = true;
  formError.value = null;
  try {
    const connected = await controller.reconnect(hostToken.value);
    if (!connected) {
      formError.value =
        controller.snapshot.connectionError ?? "Reconnect failed";
      return;
    }
    hostToken.value = "";
    showCredential.value = false;
  } catch (cause) {
    formError.value =
      cause instanceof Error ? cause.message : "Reconnect failed";
  } finally {
    hostActionPending.value = false;
  }
}

async function retryConnection() {
  if (!controller) return;
  hostActionPending.value = true;
  formError.value = null;
  try {
    const connected = await controller.reconnect();
    if (connected) {
      hostToken.value = "";
      showCredential.value = false;
      return;
    }
    formError.value = controller.snapshot.connectionError ?? "Reconnect failed";
    if (controller.snapshot.connectionState === "disconnected") {
      showCredential.value = true;
    }
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
    if (controller?.snapshot.connectionState === "disconnected") {
      showCredential.value = true;
    }
  } catch (cause) {
    formError.value =
      cause instanceof Error ? cause.message : "Host switch failed";
  }
}

async function openSession(session: ExternalAgentSession) {
  const api = getGlobalMultiPaneApi();
  if (!api) {
    formError.value = "The workspace pane host is unavailable.";
    return;
  }
  await api.newPaneForApp(EXTERNAL_AGENT_PANE_APP_ID, {
    initialRecordId: encodeExternalAgentSessionRef({
      hostId: session.hostId,
      remoteSessionId: session.remoteSessionId,
    }),
  });
}

const SessionGroup = defineComponent({
  name: "ExternalAgentSessionGroup",
  props: {
    title: { type: String, required: true },
    sessions: {
      type: Array as () => ExternalAgentSession[],
      required: true,
    },
    emptyLabel: { type: String, required: true },
  },
  emits: ["open"],
  setup(props, { emit }) {
    return () =>
      h("section", { class: "mb-4 space-y-2" }, [
        h(
          "h2",
          { class: "text-xs font-semibold uppercase tracking-wide" },
          props.title,
        ),
        props.sessions.length
          ? h(
              "div",
              { class: "space-y-1" },
              props.sessions.map((session) =>
                h(
                  "button",
                  {
                    type: "button",
                    class:
                      "w-full rounded-[var(--md-border-radius)] border border-[var(--md-outline-variant)] p-2 text-left hover:bg-[var(--md-surface-variant)]",
                    onClick: () => emit("open", session),
                  },
                  [
                    h(
                      "div",
                      {
                        class: "flex items-center justify-between gap-2",
                      },
                      [
                        h(
                          "span",
                          {
                            class: "truncate text-sm font-medium",
                          },
                          session.title,
                        ),
                        h(
                          "span",
                          {
                            class:
                              "shrink-0 text-[10px] uppercase text-[var(--md-on-surface-variant)]",
                          },
                          session.status.replace("_", " "),
                        ),
                      ],
                    ),
                    h(
                      "p",
                      {
                        class:
                          "mt-1 truncate text-xs text-[var(--md-on-surface-variant)]",
                      },
                      `${session.runnerId} · ${new Date(session.updatedAt).toLocaleString()}`,
                    ),
                  ],
                ),
              ),
            )
          : h(
              "p",
              {
                class: "text-xs text-[var(--md-on-surface-variant)]",
              },
              props.emptyLabel,
            ),
      ]);
  },
});
</script>
