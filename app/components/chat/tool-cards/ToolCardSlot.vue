<script setup lang="ts">
import {
  ref,
  computed,
  watch,
  onMounted,
  onBeforeUnmount,
  defineAsyncComponent,
} from "vue";
import type { ToolCardTheme } from "@or3/plugin-sdk/cards";
import { liveQuery, type Subscription } from "dexie";
import { getDb, getWorkspaceGeneration } from "~/db/client";
import { pluginError, pluginOk, type PluginResult } from "@or3/plugin-sdk";
import type { ToolCardBinding } from "~/composables/chat/tool-cards";
import {
  captureCardChatScope,
  useToolCardChatBridge,
} from "~/composables/chat/tool-card-chat-bridge";
import { createToolCardContext } from "~/utils/chat/tool-card-context";
import { readToolCardTheme } from "~/utils/chat/tool-card-theme";
import { utf8Bytes, readToolCardStates } from "~~/shared/chat/tool-card-data";
import type { UiChatMessage, ToolCallInfo } from "~/utils/chat/uiMessages";
import { useHooks } from "~/core/hooks/useHooks";
import ToolCallIndicator from "../ToolCallIndicator.vue";
import ToolCardPageHost from "./ToolCardPageHost.vue";
const ToolCardFrameHost = defineAsyncComponent(
  () => import("./ToolCardFrameHost.vue"),
);
const props = defineProps<{
  binding: ToolCardBinding;
  call: ToolCallInfo;
  message: UiChatMessage;
}>();
const emit = defineEmits<{ resize: [] }>();
const bridge = useToolCardChatBridge();
const scope = captureCardChatScope(bridge?.threadId.value ?? null);
const root = ref<HTMLElement>();
const near = ref(false);
const mountMs = ref<number>();
let mountStarted = 0;
const visible = ref(false);
const failure = ref("");
const theme = ref<ToolCardTheme>({ mode: "light", tokens: {} });
const label = computed(
  () => props.binding.label || props.call.label || props.call.name,
);
const hooks = useHooks();
let reported = false;
function report(event: "mounted" | "failed", code?: string) {
  if (event === "mounted")
    mountMs.value = Math.round((performance.now() - mountStarted) * 100) / 100;
  const payload = {
    pluginId: props.binding.ownerPluginId,
    tool: props.call.name,
    callId: props.call.id ?? "",
    runtime:
      props.binding.source.kind === "page"
        ? ("page" as const)
        : ("frame" as const),
    ...(code ? { code } : {}),
  };
  void hooks
    .doAction(
      event === "mounted"
        ? "ui.chat.tool-card:action:mounted"
        : "ui.chat.tool-card:action:failed",
      payload,
    )
    .catch(() => {});
}
function fail(code: string) {
  if (reported) return;
  reported = true;
  failure.value = code;
  live.dispose();
  console.warn(
    "[tool-card]",
    props.binding.ownerPluginId ?? "source",
    props.call.name,
    code,
  );
  report("failed", code);
}
const activated = () => navigator.userActivation?.isActive === true;
async function send(
  text: string,
  activation = activated(),
): Promise<PluginResult<void>> {
  let refused: PluginResult<void> | undefined;
  if (!bridge)
    refused = pluginError("unsupported", "This card is outside a chat pane");
  else if (!activation)
    refused = pluginError("permission-denied", "A user gesture is required", {
      details: { reason: "no-user-activation" },
    });
  else if (!visible.value)
    refused = pluginError("permission-denied", "Card must be visible", {
      details: { reason: "not-visible" },
    });
  else if (typeof text !== "string" || !text.trim() || utf8Bytes(text) > 8192)
    refused = pluginError(
      "invalid-input",
      "Send text must be nonempty and within 8 KiB",
    );
  else if (!bridge.canSend(props.message.id + ":" + props.call.id))
    refused = pluginError(
      "quota-exceeded",
      "Wait three seconds before sending again",
      { retryable: true },
    );
  else if (bridge.busy.value)
    refused = pluginError("conflict", "Chat is busy", {
      retryable: true,
      details: { reason: "chat-busy" },
    });
  else if (!bridge.reserveSend(props.message.id + ":" + props.call.id))
    refused = pluginError(
      "quota-exceeded",
      "Wait three seconds before sending again",
      { retryable: true },
    );
  if (refused) {
    console.info(
      "[tool-card]",
      props.binding.ownerPluginId ?? "source",
      props.call.name,
      refused.ok ? "" : refused.error.code,
    );
    return refused;
  }
  return bridge!.send(
    text,
    {
      plugin_id: props.binding.ownerPluginId,
      tool: props.call.name,
      call_id: props.call.id ?? "",
      message_id: props.message.id,
      label: label.value,
    },
    scope,
  );
}
async function openLink(
  url: string,
  activation = activated(),
): Promise<PluginResult<void>> {
  if (!activation)
    return pluginError("permission-denied", "A user gesture is required", {
      details: { reason: "no-user-activation" },
    });
  try {
    const parsed = new URL(url);
    if (
      typeof url !== "string" ||
      utf8Bytes(url) > 2048 ||
      !["http:", "https:"].includes(parsed.protocol)
    )
      throw new Error();
    window.open(parsed.href, "_blank", "noopener,noreferrer");
    return pluginOk(undefined);
  } catch {
    return pluginError(
      "invalid-input",
      "Link must be HTTP or HTTPS within 2 KiB",
    );
  }
}
const state = () =>
  props.call.id
    ? (props.message.toolCards?.[props.call.id]?.state ?? null)
    : null;
if (!bridge)
  watch(
    () => props.message.toolCards,
    () => {
      live.updateState(state());
    },
    { deep: true },
  );
let stateSubscription: Subscription | undefined;
const stateMessageId = props.message.id;
const stateCallId = props.call.id ?? "";
let persistedRevision = 0;
const workspaceCurrent = () =>
  scope.db === getDb() && scope.generation === getWorkspaceGeneration();
async function readPersistedState() {
  const row = await scope.db.messages.get(stateMessageId);
  const data = row?.data;
  return row &&
    !row.deleted &&
    row.thread_id === scope.threadId &&
    data &&
    typeof data === "object" &&
    "tool_cards" in data
    ? (readToolCardStates(data.tool_cards)?.[stateCallId]?.state ?? null)
    : null;
}
const live = createToolCardContext({
  call: props.call,
  messageId: props.message.id,
  state: state(),
  theme: theme.value,
  runtime: props.binding.source.kind === "page" ? "page" : "frame",
  setState: async (value) => {
    const result = await (bridge?.writeState(
      props.message.id,
      props.call.id ?? "",
      value,
      scope,
    ) ??
      Promise.resolve(
        pluginError("unsupported", "This card is outside a chat pane"),
      ));
    if (bridge && workspaceCurrent() && !live.card.signal.aborted) {
      try {
        // Hooks may normalize the input or delay completion after another
        // write. Reconcile from storage even when liveQuery has not fired yet.
        const revision = persistedRevision;
        const saved = await readPersistedState();
        if (
          workspaceCurrent() &&
          !live.card.signal.aborted &&
          revision === persistedRevision
        ) {
          persistedRevision++;
          live.updateState(saved);
        }
      } catch {
        fail("state-unavailable");
      }
    }
    return result;
  },
  send,
  openLink,
  onError: () => fail("mount-error"),
});
watch([() => props.call, theme], () => live.update(props.call, theme.value), {
  deep: true,
});
let lazyObserver: IntersectionObserver | undefined;
let visibilityObserver: IntersectionObserver | undefined;
let resizeObserver: ResizeObserver | undefined;
let themeObserver: MutationObserver | undefined;
onMounted(() => {
  if (!root.value) return;
  if (props.binding.source.kind === "unsupported") {
    fail(props.binding.source.code);
    return;
  }
  if (bridge && props.call.id) {
    stateSubscription = liveQuery(readPersistedState).subscribe({
      next: (value) => {
        if (workspaceCurrent()) {
          persistedRevision++;
          live.updateState(value);
        }
      },
      error: () => fail("state-unavailable"),
    });
  }
  theme.value = readToolCardTheme(root.value);
  const scrollRoot = root.value.closest(".chat-message-list");
  lazyObserver = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        mountStarted = performance.now();
        near.value = true;
        lazyObserver?.disconnect();
      }
    },
    { root: scrollRoot, rootMargin: "600px" },
  );
  lazyObserver.observe(root.value);
  visibilityObserver = new IntersectionObserver(
    (entries) => {
      visible.value = (entries[0]?.intersectionRatio ?? 0) >= 0.25;
    },
    { root: scrollRoot, threshold: [0.25] },
  );
  visibilityObserver.observe(root.value);
  resizeObserver = new ResizeObserver(() => emit("resize"));
  resizeObserver.observe(root.value);
  themeObserver = new MutationObserver(() => {
    if (root.value) theme.value = readToolCardTheme(root.value);
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    subtree: false,
  });
  themeObserver.observe(document.body, { attributes: true });
});
onBeforeUnmount(() => {
  stateSubscription?.unsubscribe();
  live.dispose();
  lazyObserver?.disconnect();
  visibilityObserver?.disconnect();
  resizeObserver?.disconnect();
  themeObserver?.disconnect();
  void bridge?.flush(props.message.id, props.call.id);
});
</script>
<template>
  <div
    ref="root"
    class="tool-card-slot min-w-0 max-w-full"
    role="group"
    :aria-label="label"
    :data-tool-card="call.name"
    :data-card-mount-ms="mountMs"
    :style="{
      minHeight: failure ? undefined : (binding.minHeight ?? 64) + 'px',
    }"
    :data-card-chrome="binding.chrome ?? 'card'"
  >
    <template v-if="failure"
      ><ToolCallIndicator :tool-calls="[call]" />
      <p class="text-xs opacity-60">
        {{ label }} card unavailable ({{ failure }})
      </p></template
    >
    <template v-else-if="near">
      <ToolCardPageHost
        v-if="binding.source.kind === 'page'"
        :module="binding.source.module"
        :card="live.card"
        @mounted="report('mounted')"
        @failed="fail"
      />
      <ToolCardFrameHost
        v-else
        :binding="binding"
        :card="live.card"
        :label="label"
        :visible="visible"
        :send="send"
        :open-link="openLink"
        @mounted="report('mounted')"
        @failed="fail"
      />
    </template>
  </div>
</template>
<style scoped>
.tool-card-slot {
  overflow: hidden;
  overflow-wrap: anywhere;
}
.tool-card-slot[data-card-chrome="card"] {
  background: var(--md-surface-container-low);
  border: var(--md-border-width-subtle, 1px) solid var(--md-outline-variant);
  border-radius: var(--md-border-radius);
  padding: 12px;
}
.tool-card-slot :deep(iframe),
.tool-card-slot :deep(img) {
  max-width: 100%;
}
</style>
