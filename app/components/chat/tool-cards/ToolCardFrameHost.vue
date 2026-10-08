<script setup lang="ts">
import { useRuntimeConfig } from "#imports";
import { ref, onMounted, onBeforeUnmount, watch } from "vue";
import type { ToolCardContext } from "@or3/plugin-sdk/cards";
import { pluginError, type PluginResult } from "@or3/plugin-sdk";
import type { ToolCardBinding } from "~/composables/chat/tool-cards";
import { toolCardEngineQualified } from "~~/shared/plugins/isolation/portable-bootstrap";
import { loadToolCardBundle } from "~/utils/chat/tool-card-bundles";
import {
  validateCardFrameMessage,
  validateCardSnapshot,
  createCardProtocolBudget,
} from "~~/shared/plugins/isolation/tool-card-protocol";
import { useToolCardFrameBudget } from "~/composables/chat/tool-card-frame-budget";
const props = defineProps<{
  binding: ToolCardBinding;
  card: ToolCardContext;
  label: string;
  visible: boolean;
  send(text: string, activated: boolean): Promise<PluginResult<void>>;
  openLink(url: string, activated: boolean): Promise<PluginResult<void>>;
}>();
const emit = defineEmits<{ mounted: []; failed: [code: string] }>();
const container = ref<HTMLElement>();
const height = ref(props.binding.minHeight ?? 64);
const mounted = ref(false);
const budget = useToolCardFrameBudget();
const id = Symbol("card-frame");
let frame: HTMLIFrameElement | undefined;
let port: MessagePort | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let disposed = false;
let suspended = false;
let starting = false;
let epoch = 0;
const source = props.binding.source;
const harness =
  import.meta.dev &&
  useRuntimeConfig().public.toolCardsTestHarness === true &&
  source.kind === "frame" &&
  source.pluginId === "or3.tool-card-fixture";
const snapshot = () =>
  JSON.parse(
    JSON.stringify({
      tool: props.card.tool,
      callId: props.card.callId,
      messageId: props.card.messageId,
      runtime: "frame" as const,
      status: props.card.status,
      args: props.card.args,
      result: props.card.result,
      error: props.card.error,
      state: props.card.state,
      theme: props.card.theme,
    }),
  );
function teardown(release = true) {
  epoch++;
  clearTimeout(timer);
  try {
    port?.postMessage({ type: "teardown" });
  } catch {}
  port?.close();
  port = undefined;
  frame?.remove();
  frame = undefined;
  mounted.value = false;
  starting = false;
  if (release) budget?.release(id);
}
function fail(code: string) {
  if (disposed) return;
  disposed = true;
  teardown();
  emit("failed", code);
}
async function start() {
  if (disposed || starting || frame || source.kind !== "frame") return;
  if (!toolCardEngineQualified() && !harness) {
    fail("runtime-unsupported");
    return;
  }
  starting = true;
  const token = ++epoch;
  let bundle: Awaited<ReturnType<typeof loadToolCardBundle>>;
  try {
    bundle = await loadToolCardBundle(source);
  } catch {
    if (token === epoch) fail("bundle-unavailable");
    return;
  }
  if (disposed || token !== epoch || !container.value) return;
  suspended = false;
  const admitted = budget?.acquire(
    id,
    () => {
      suspended = true;
      teardown(false);
    },
    props.visible,
    () => {
      if (!disposed) void start();
    },
  );
  if (admitted === false) {
    suspended = true;
    starting = false;
    return;
  }
  frame = document.createElement("iframe");
  frame.sandbox.add("allow-scripts");
  frame.setAttribute("allow", "");
  frame.referrerPolicy = "no-referrer";
  frame.loading = "lazy";
  frame.title = props.label;
  frame.style.cssText =
    "width:100%;border:0;display:block;visibility:hidden;height:" +
    height.value +
    "px";
  frame.src = harness
    ? "/or3/tool-card-probe"
    : "/or3/tool-card-frame/" +
      [source.pluginId, source.packageDigest, source.card.id]
        .map(encodeURIComponent)
        .join("/");
  let loads = 0;
  let ready = false;
  let didMount = false;
  let invalid = 0;
  const limits = createCardProtocolBudget();
  const actionIds = new Set<string>();
  frame.onload = () => {
    if (++loads > 1) {
      fail("frame-navigated");
      return;
    }
    const channel = new MessageChannel();
    port = channel.port1;
    port.onmessage = async (event) => {
      if (disposed || token !== epoch) return;
      const message = event.data;
      if (!validateCardFrameMessage(message) || !limits.accept(message)) {
        if (++invalid >= 3) fail("protocol-violation");
        return;
      }
      if (message.type === "ready") {
        if (ready || didMount) {
          fail("protocol-violation");
          return;
        }
        ready = true;
        const context = snapshot();
        if (!validateCardSnapshot(context)) {
          fail("protocol-violation");
          return;
        }
        port?.postMessage(
          {
            type: "boot",
            module: bundle.module,
            stylesheet: bundle.stylesheet,
            snapshot: context,
          },
          [bundle.module],
        );
      } else if (message.type === "mounted") {
        if (!ready || didMount) {
          fail("protocol-violation");
          return;
        }
        didMount = true;
        clearTimeout(timer);
        mounted.value = true;
        starting = false;
        if (frame) frame.style.visibility = "visible";
        emit("mounted");
      } else if (message.type === "resize") {
        if (!didMount) {
          if (++invalid >= 3) fail("protocol-violation");
          return;
        }
        height.value = message.height;
        if (frame) frame.style.height = message.height + "px";
      } else if (message.type === "error")
        fail(
          [
            "runtime-unsupported",
            "frame-navigated",
            "protocol-violation",
          ].includes(message.code)
            ? message.code
            : "mount-error",
        );
      else if (message.type === "action") {
        if (!didMount || actionIds.has(message.id)) {
          if (++invalid >= 3) fail("protocol-violation");
          return;
        }
        actionIds.add(message.id);
        if (actionIds.size > 1024)
          actionIds.delete(actionIds.values().next().value!);
        let result: PluginResult<void>;
        try {
          result =
            message.name === "send"
              ? await props.send(message.payload as string, message.activated)
              : message.name === "openLink"
                ? await props.openLink(
                    message.payload as string,
                    message.activated,
                  )
                : await props.card.setState(message.payload);
        } catch {
          result = pluginError("internal", "Card action failed");
        }
        if (!disposed && token === epoch)
          port?.postMessage({
            type: "action-result",
            id: message.id,
            result,
          });
      }
    };
    port.start();
    frame?.contentWindow?.postMessage(
      { type: "or3-card:connect", protocol: 1 },
      "*",
      [channel.port2],
    );
  };
  container.value.append(frame);
  timer = setTimeout(() => fail("boot-timeout"), 5000);
}
const stop = props.card.onUpdate(() => {
  const context = snapshot();
  if (!mounted.value) return;
  if (!validateCardSnapshot(context)) {
    fail("protocol-violation");
    return;
  }
  port?.postMessage({ type: "update", snapshot: context });
});
watch(
  () => props.visible,
  (value) => {
    budget?.touch(id, value);
    if (value && suspended) void start();
  },
);
onMounted(() => {
  void start();
});
onBeforeUnmount(() => {
  disposed = true;
  stop();
  teardown();
});
</script>
<template>
  <div
    ref="container"
    class="min-w-0 max-w-full"
    :style="{ minHeight: height + 'px' }"
    :data-card-frame-mounted="mounted"
  />
</template>
