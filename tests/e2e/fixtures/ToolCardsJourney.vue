<script setup lang="ts">
import ToolCardHelpers from "./ToolCardHelpers.vue";
import trustedPackage from "../../plugin-runtime/fixtures/trusted-card/client.mjs";
import { createTrustedRuntimeServices } from "~/composables/plugins/trusted-runtime-services";
import probeModule from "../../plugin-runtime/fixtures/tool-card-probes/probe.mjs?raw";
import { onMounted, onBeforeUnmount, ref } from "vue";
import { useRoute, useNuxtApp } from "#imports";
import ChatContainer from "~/components/chat/ChatContainer.vue";
import { getDb } from "~/db/client";
import { ensureThreadHistoryLoaded } from "~/utils/chat/history";
import { persistUserApiKey } from "~/core/auth/useUserApiKey";
import { useModelStore } from "~/composables/chat/useModelStore";
import { useToolRegistry } from "~/utils/chat/tool-registry";
import { registerCardTool } from "~/utils/chat/tool-cards-public";
import { registerToolCardBinding } from "~/composables/chat/tool-cards";
import { createManagedWorkspacePluginRuntime } from "~/composables/plugins/workspace-runtime";
import { createTrustedHostContext } from "~/composables/plugins/trusted-host-context";
import { defineToolCard } from "@or3/plugin-sdk/cards";
import { useHooks } from "~/core/hooks/useHooks";
import { patchMessageInDb } from "~/db/messages";
import { patchMessageDataEntry } from "~/db/messages";
import ToolCardFrameHost from "~/components/chat/tool-cards/ToolCardFrameHost.vue";
import { provideToolCardFrameBudget } from "~/composables/chat/tool-card-frame-budget";
import { createToolCardContext } from "~/utils/chat/tool-card-context";
import type { ToolCardBinding } from "~/composables/chat/tool-cards";
import { pluginOk } from "@or3/plugin-sdk";
import { sha256Identity } from "~~/shared/plugins/digest";
import {
  quizCard,
  registerQuizExample,
} from "~/plugins/examples/quiz-card-example.client";
import {
  mapCard,
  registerMapExample,
} from "~/plugins/examples/map-card-example.client";
import { registerWeatherExample } from "~/plugins/examples/weather-card-example.client";
import type { ChatMessage } from "~/utils/chat/types";
const nuxtApp = useNuxtApp();
const trustedCleanups = ref(0);
const recordTrustedCleanup = () => trustedCleanups.value++;
const ready = ref(false);
const threadId = ref("");
const history = ref<ChatMessage[]>([]);
const receipt = ref("");
const fixtureRoute = useRoute();
const scenario = String(fixtureRoute.query.scenario ?? "quiz");
provideToolCardFrameBudget();
const budgetBinding = ref<ToolCardBinding>();
const releaseFirst = ref(false);
const budgetCards = Array.from({ length: 13 }, (_, i) =>
  createToolCardContext({
    call: {
      id: "budget-" + i,
      name: "fixture_frame",
      status: "complete",
      args: "{}",
    },
    messageId: "budget",
    state: null,
    theme: { mode: "light", tokens: {} },
    setState: async () => pluginOk(undefined),
    send: async () => pluginOk(undefined),
    openLink: async () => pluginOk(undefined),
  }),
);
async function resetSavedQuiz() {
  await patchMessageDataEntry(
    getDb(),
    "scroll-0",
    "tool_cards",
    "quiz-0",
    null,
  );
}
const handles: { dispose(): unknown }[] = [];
let trusted: ReturnType<typeof createTrustedHostContext> | undefined;
const runtime = createManagedWorkspacePluginRuntime({
  pluginId: "or3.tool-card-fixture",
});
const hooks = useHooks();
const events: unknown[] = [];
const record = (payload: unknown) => {
  events.push(payload);
  receipt.value = JSON.stringify(events);
};
const frameModule =
  scenario === "probe"
    ? probeModule
    : 'export default { mount(el, card) { const button = document.createElement("button"); button.textContent="Frame answer"; button.onclick=async()=>{ const sent=await card.send("Frame answer"); el.dataset.result=sent.ok ? "sent" : sent.error.code; }; el.append(button); const nav=document.createElement("button"); nav.textContent="Navigate frame"; nav.onclick=()=>location.href="/or3/tool-card-probe?navigation-attempt"; el.append(nav); const p=document.createElement("p"); p.textContent=card.theme.mode; el.append(p); const stop=card.onUpdate(()=>p.textContent=card.theme.mode); return ()=>stop(); } };';
function toggleTheme() {
  document.documentElement.classList.toggle("dark");
}
async function updateTrustedPlugin() {
  await trusted?.dispose();
  trusted = nuxtApp.runWithContext(() =>
    createTrustedHostContext({
      pluginId: "or3.trusted-card-fixture",
      version: "0.2.0",
      grants: ["tools.register.client", "chat.tool.card"],
      features: ["or3-trusted-host-v1", "or3-trusted-ui-kit-v1"],
      requestedFeatures: ["or3-trusted-ui-kit-v1"],
      runtimeServices: createTrustedRuntimeServices,
    }),
  );
  handles.push({ dispose: trustedPackage.setup(trusted.context) });
}
async function disablePlugin() {
  await trusted?.dispose();
  await runtime.dispose();
}
async function completeCall() {
  await patchMessageInDb(getDb(), "fixture-message", {
    data: {
      tool_calls: [
        {
          id: "always-call",
          name: "fixture_always",
          status: "complete",
          args: "{}",
          result: "{}",
        },
      ],
    },
  });
  await ensureThreadHistoryLoaded(threadId, ref(null), history);
}
onMounted(async () => {
  window.addEventListener("or3:trusted-card-cleanup", recordTrustedCleanup);
  const registry = useToolRegistry();
  if (!registry.getTool("quiz_ask")) handles.push(registerQuizExample());
  if (!registry.getTool("weather_show")) handles.push(registerWeatherExample());
  if (!registry.getTool("map_show")) handles.push(registerMapExample());
  for (const name of ["quiz_ask", "weather_show", "map_show"])
    registry.setEnabled(name, true);
  hooks.addAction("ui.chat.tool-card:action:mounted", record);
  hooks.addAction("ui.chat.tool-card:action:failed", record);
  handles.push(
    registerCardTool({
      name: "fixture_throw",
      description: "Throwing card",
      parameters: { type: "object", properties: {} },
      label: "Broken plugin",
      card: defineToolCard({
        mount() {
          throw new Error("fixture");
        },
      }),
    }),
  );
  handles.push(
    registerCardTool({
      name: "fixture_end",
      description: "End card",
      parameters: { type: "object", properties: {} },
      label: "End card",
      placement: "end",
      card: defineToolCard({
        mount(el) {
          el.textContent = "End placed card";
        },
      }),
    }),
  );
  handles.push(
    registerCardTool({
      name: "fixture_always",
      description: "Always card",
      parameters: { type: "object", properties: {} },
      label: "Always card",
      renderWhile: "always",
      card: defineToolCard({
        mount(el, card) {
          const render = () => {
            el.textContent = "Status: " + card.status;
          };
          render();
          return card.onUpdate(render);
        },
      }),
    }),
  );
  handles.push(
    registerCardTool({
      name: "fixture_guards",
      description: "Guard card",
      parameters: { type: "object", properties: {} },
      label: "Guards",
      card: defineToolCard({
        mount(el, card) {
          const output = document.createElement("output");
          output.dataset.guardResult = "";
          const button = document.createElement("button");
          button.textContent = "Send twice";
          button.onclick = async () => {
            clearTimeout(timer);
            const first = await card.send("Guard first answer");
            const second = await card.send("Guard second answer");
            output.textContent = JSON.stringify([first, second]);
          };
          const timer = setTimeout(async () => {
            const result = await card.send("Timer answer");
            output.textContent = JSON.stringify(result);
          }, 6000);
          const actions: [string, () => Promise<unknown>][] = [
            ["Oversized state", () => card.setState("x".repeat(17000))],
            ["Invalid state", () => card.setState({ bad: NaN })],
            ["Send empty", () => card.send(" ")],
            ["Invalid link", () => card.openLink("javascript:alert(1)")],
          ];
          for (const [label, action] of actions) {
            const control = document.createElement("button");
            control.textContent = label;
            control.onclick = async () => {
              clearTimeout(timer);
              output.textContent = JSON.stringify(await action());
            };
            el.append(control);
          }
          el.append(button, output);
          return () => clearTimeout(timer);
        },
      }),
    }),
  );
  trusted = createTrustedHostContext({
    pluginId: "or3.trusted-card-fixture",
    version: "0.1.0",
    grants: ["tools.register.client", "chat.tool.card"],
    features: ["or3-trusted-host-v1", "or3-trusted-ui-kit-v1"],
    requestedFeatures: ["or3-trusted-ui-kit-v1"],
    runtimeServices: createTrustedRuntimeServices,
  });
  const packageCleanup = trustedPackage.setup(trusted.context);
  handles.push({ dispose: packageCleanup });
  runtime.api.registerTool(
    {
      type: "function",
      function: {
        name: "fixture_frame",
        description: "Frame card",
        parameters: { type: "object", properties: {} },
      },
    },
    () => "{}",
  );
  const digest = await sha256Identity(frameModule);
  budgetBinding.value = {
    tool: "fixture_frame",
    ownerPluginId: "or3.tool-card-fixture",
    source: {
      kind: "frame",
      pluginId: "or3.tool-card-fixture",
      packageDigest: digest,
      card: {
        id: "frame",
        tool: "fixture_frame",
        entry: "frame.mjs",
        entrySha256: digest,
      },
    },
    label: "Frame fixture",
  };
  handles.push(
    registerToolCardBinding({
      tool: "fixture_frame",
      ownerPluginId: "or3.tool-card-fixture",
      source: {
        kind: "frame",
        pluginId: "or3.tool-card-fixture",
        packageDigest: digest,
        card: {
          id: "frame",
          tool: "fixture_frame",
          entry: "frame.mjs",
          entrySha256: digest,
        },
      },
      label: "Frame fixture",
    }),
  );
  localStorage.setItem(
    "or3:server-route-available",
    JSON.stringify({ available: false, timestamp: Date.now() }),
  );
  await persistUserApiKey("sk-or-v1-tool-cards-disposable-test-key");
  await useModelStore().addFavoriteModel({
    id: "~openai/gpt-luna-latest",
    name: "Tool card fixture model",
    context_length: 1000000,
    top_provider: { max_completion_tokens: 65536 },
    supported_parameters: ["tools"],
    architecture: {
      input_modalities: ["text"],
      output_modalities: ["text"],
    },
    pricing: { prompt: "0", completion: "0" },
  });
  const key = "or3:e2e:tool-card-thread:" + scenario;
  threadId.value = localStorage.getItem(key) ?? "";
  if (!threadId.value) {
    const { createThread } = await import("~/db/threads");
    const thread = await createThread({ title: "Tool cards fixture" });
    threadId.value = thread.id;
    localStorage.setItem(key, thread.id);
    const forecast = {
      place: "Paris, France",
      isDay: true,
      current: { temperature: 22, summary: "Clear sky" },
      hourly: Array.from({ length: 12 }, (_, i) => ({
        time: "2026-10-07T" + String(i + 8).padStart(2, "0") + ":00",
        temperature: 20 + i,
      })),
      daily: Array.from({ length: 7 }, (_, i) => ({
        date: "2026-10-" + String(i + 7).padStart(2, "0"),
        low: 14,
        high: 22 + i,
        summary: "Clear sky",
      })),
    };
    const call = (
      name: string,
      id: string,
      result: unknown = {},
      args: unknown = {},
    ) => ({
      name,
      id,
      status: "complete",
      args: JSON.stringify(args),
      result: JSON.stringify(result),
    });
    let calls: unknown[] = [];
    if (scenario === "examples")
      calls = [
        call(
          "quiz_ask",
          "quiz",
          { shown: true },
          {
            question: "Capital of France?",
            choices: ["Paris", "Rome"],
          },
        ),
        call("weather_show", "weather", forecast),
        call(
          "map_show",
          "map",
          {
            latitude: 48.85,
            longitude: 2.35,
            place: "Paris, France",
          },
          { query: "Paris" },
        ),
      ];
    if (scenario === "layout")
      calls = [
        call("fixture_end", "end"),
        call("fixture_throw", "throw"),
        call("fixture_guards", "guards"),
      ];
    if (scenario === "always")
      calls = [{ ...call("fixture_always", "always-call"), status: "loading" }];
    if (scenario === "trusted")
      calls = [call("fixture_trusted", "trusted", forecast)];
    if (scenario === "frame" || scenario === "probe")
      calls = [
        call(
          "fixture_frame",
          "frame",
          {},
          {
            channel: String(fixtureRoute.query.channel ?? ""),
            target: String(fixtureRoute.query.target ?? ""),
            stun: String(fixtureRoute.query.stun ?? ""),
            context: "contained",
          },
        ),
      ];
    if (calls.length)
      await getDb().messages.put({
        id: "fixture-message",
        thread_id: thread.id,
        role: "assistant",
        index: 1000,
        created_at: 1,
        updated_at: 1,
        deleted: false,
        clock: 1,
        data: {
          content: "Message body after tools.",
          tool_calls: calls,
        },
      });
    if (scenario === "scroll" || scenario === "frame-scroll")
      await getDb().messages.bulkPut(
        Array.from({ length: 30 }, (_, i) => ({
          id: "scroll-" + i,
          thread_id: thread.id,
          role: "assistant" as const,
          index: (i + 1) * 1000,
          created_at: 1,
          updated_at: 1,
          deleted: false,
          clock: 1,
          data: {
            content: "Card " + i,
            tool_calls: [
              call(
                scenario === "frame-scroll" ? "fixture_frame" : "quiz_ask",
                "quiz-" + i,
                {},
                {
                  question: "Question " + i,
                  choices: ["A", "B"],
                },
              ),
            ],
          },
        })),
      );
  }
  await ensureThreadHistoryLoaded(threadId, ref(null), history);
  ready.value = true;
});
onBeforeUnmount(() => {
  window.removeEventListener("or3:trusted-card-cleanup", recordTrustedCleanup);
  for (const handle of handles) handle.dispose();
  for (const card of budgetCards) card.dispose();
  void trusted?.dispose();
  void runtime.dispose();
  hooks.removeAction("ui.chat.tool-card:action:mounted", record);
  hooks.removeAction("ui.chat.tool-card:action:failed", record);
});
</script>
<template>
  <main class="h-dvh flex flex-col min-w-0">
    <ToolCardHelpers v-if="scenario === 'helpers'" />
    <nav class="flex flex-wrap gap-3 p-2">
      <button @click="toggleTheme">Toggle theme</button
      ><button @click="disablePlugin">Disable fixture plugin</button
      ><button @click="completeCall">Complete fixture call</button>
      <button @click="updateTrustedPlugin">Update fixture plugin</button>
      <button @click="resetSavedQuiz">Reset saved quiz</button>
      <button @click="releaseFirst = true">Release first frame</button>
      <output data-trusted-cleanups>{{ trustedCleanups }}</output>
    </nav>
    <ChatContainer
      v-if="ready && scenario !== 'frame-budget'"
      :thread-id="threadId"
      :message-history="history"
      pane-id="tool-cards-journey"
      class="flex-1 min-h-0"
    />
    <template v-if="ready && scenario === 'frame-budget' && budgetBinding">
      <template v-for="(card, index) in budgetCards" :key="index">
        <ToolCardFrameHost
          v-if="index !== 0 || !releaseFirst"
          :binding="budgetBinding"
          :card="card.card"
          :label="'Budget ' + (index + 1)"
          :visible="index < 12"
          :send="async () => pluginOk(undefined)"
          :open-link="async () => pluginOk(undefined)"
        />
      </template>
    </template>
    <output class="sr-only" data-card-receipt>{{ receipt }}</output>
    <pre class="sr-only" data-frame-module>{{ frameModule }}</pre>
  </main>
</template>
