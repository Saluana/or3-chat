import assert from "node:assert/strict";
import { test } from "node:test";
import { Or3RunsBridge } from "../src/bridge.js";

function control() {
  const calls = { start: 0, configure: [], decide: [] };
  return {
    calls,
    async models() {
      return {
        models: [
          { provider: "portal", id: "portal/model-a", name: "Model A" },
          { provider: "portal", id: "portal/model-b", name: "Model B" },
        ],
      };
    },
    async commands() {
      return { commands: [] };
    },
    async agents() {
      return { agents: [{ id: "main", thinkingLevels: [{ id: "low" }] }] };
    },
    async createSession() {},
    async configure(value) {
      calls.configure.push(value);
    },
    async decide(value) {
      calls.decide.push(value);
    },
    async start() {
      calls.start += 1;
      return { runId: "unexpected" };
    },
  };
}

test("picker commands complete locally instead of starting an agent run", async () => {
  const runtime = control();
  const bridge = new Or3RunsBridge({ agentId: "main", control: runtime });
  await bridge.capabilities();
  await bridge.createSession("session-1");

  const providers = await bridge.startRun("session-1", { input: "/models" });
  assert.equal(providers.status, "completed");
  assert.equal(runtime.calls.start, 0);
  assert.equal(providers.events.at(0).event, "command.choices");
  assert.equal(providers.events.at(0).seq, 1);
  assert.deepEqual(providers.events.at(0).choices, [
    { label: "portal (2)", command: "/models portal" },
  ]);

  const model = await bridge.startRun("session-1", {
    input: "/model portal/model-b",
  });
  assert.equal(model.status, "completed");
  assert.equal(runtime.calls.start, 0);
  assert.deepEqual(runtime.calls.configure, [
    { key: "agent:main:or3:c2vzc2lvbi0x", model: "portal/model-b" },
  ]);
});

test("deduplicates concurrent Gateway capability discovery", async () => {
  const runtime = control();
  let modelCalls = 0;
  const models = runtime.models;
  runtime.models = async () => {
    modelCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return models();
  };
  const bridge = new Or3RunsBridge({ agentId: "main", control: runtime });

  await Promise.all([bridge.capabilities(), bridge.capabilities()]);
  assert.equal(modelCalls, 1);
});

test("keeps the first chat delta when Gateway publishes before start resolves", async () => {
  let bridge;
  const runtime = control();
  runtime.start = async (params) => {
    bridge.handleChatEvent({
      runId: "gateway-run",
      sessionKey: params.sessionKey,
      state: "delta",
      deltaText: "first token",
    });
    return { runId: "gateway-run" };
  };
  runtime.wait = async () => ({ status: "ok" });
  runtime.messages = async () => ({
    messages: [{ role: "assistant", content: "first token" }],
  });
  bridge = new Or3RunsBridge({ agentId: "main", control: runtime });
  await bridge.capabilities();
  await bridge.createSession("session-early");

  const run = await bridge.startRun("session-early", { input: "hello" });
  assert.equal(run.output, "first token");
  assert.equal(run.events[0].event, "message.delta");
  assert.equal(run.events[0].delta, "first token");
});

test("matches an early chat event by session when Gateway omits its run id", async () => {
  let bridge;
  const runtime = control();
  runtime.start = async (params) => {
    bridge.handleChatEvent({
      sessionKey: params.sessionKey,
      state: "delta",
      deltaText: "session-matched token",
    });
    return { runId: "gateway-run-without-first-event" };
  };
  bridge = new Or3RunsBridge({ agentId: "main", control: runtime });
  await bridge.capabilities();
  await bridge.createSession("session-without-run-id");

  const run = await bridge.startRun("session-without-run-id", { input: "hello" });
  assert.equal(run.output, "session-matched token");
});

test("ignores a foreign chat event whose session does not match a pending run", async () => {
  const bridge = new Or3RunsBridge({ agentId: "main", control: control() });

  assert.doesNotThrow(() => {
    bridge.handleChatEvent({
      runId: "foreign-run",
      sessionKey: "agent:main:or3:foreign-session",
      state: "delta",
      deltaText: "must be ignored",
    });
  });
  assert.equal(bridge.runAliases.has("foreign-run"), false);
});

test("rejects unsupported approval scopes instead of widening them permanently", async () => {
  const runtime = control();
  const bridge = new Or3RunsBridge({ agentId: "main", control: runtime });
  bridge.runs.set("run-1", {
    id: "run-1",
    approval: { id: "approval-1", kind: "exec" },
  });

  await assert.rejects(
    () => bridge.decideRun("run-1", "session"),
    (error) => error?.status === 400 && error.message === "Unsupported approval choice",
  );
  await assert.rejects(
    () => bridge.decideRun("run-1", undefined),
    (error) => error?.status === 400,
  );
  assert.deepEqual(runtime.calls.decide, []);

  await bridge.decideRun("run-1", "once");
  assert.deepEqual(runtime.calls.decide, [
    { method: "exec.approval.resolve", id: "approval-1", decision: "allow-once" },
  ]);
});
