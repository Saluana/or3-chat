import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { Or3RunsBridge, createOr3RunsHttpHandler } from "../src/bridge.js";

function sessionKeyFor(agentId, sessionId) {
  const digest = createHash("sha256").update(sessionId, "utf8").digest("hex");
  return `agent:${agentId}:or3:${digest}`;
}

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
  const session = await bridge.createSession("session-1");

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
    { key: session.sessionKey, model: "portal/model-b" },
  ]);
});

test("uses collision-resistant lowercase session keys", async () => {
  const bridge = new Or3RunsBridge({ agentId: "main", control: control() });
  const first = await bridge.createSession("aaa");
  const second = await bridge.createSession("aaG");

  assert.notEqual(first.sessionKey, second.sessionKey);
  assert.match(first.sessionKey, /^agent:main:or3:[0-9a-f]{64}$/u);
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

test("rejects unknown HTTP wrapper routes without starting or configuring a run", async () => {
  const runtime = control();
  const bridge = new Or3RunsBridge({ agentId: "main", control: runtime });
  const request = new EventEmitter();
  request.method = "POST";
  request.url = "/v1/not-a-run";
  request.headers = { authorization: "Bearer test-token" };
  const response = {
    statusCode: 200,
    setHeader() {},
    end() {},
  };

  await createOr3RunsHttpHandler(bridge, () => ({ token: "test-token" }))(
    request,
    response,
  );

  assert.equal(response.statusCode, 404);
  assert.equal(runtime.calls.start, 0);
  assert.deepEqual(runtime.calls.configure, []);
  assert.deepEqual(runtime.calls.decide, []);
});

test("reconciles missing final output after partial streamed deltas", () => {
  const bridge = new Or3RunsBridge({ agentId: "main", control: control() });
  const run = {
    id: "run-final",
    sessionKey: "agent:main:or3:session",
    status: "running",
    output: "partial",
    events: [],
    nextEventSequence: 1,
    listeners: new Set(),
    commandChoices: [],
  };
  bridge.runs.set(run.id, run);

  bridge.handleChatEvent({
    runId: run.id,
    sessionKey: run.sessionKey,
    state: "final",
    message: { content: "partial response" },
  });

  assert.equal(run.output, "partial response");
  assert.deepEqual(
    run.events.map((event) => [event.event, event.delta ?? event.output]),
    [
      ["message.delta", " response"],
      ["run.completed", "partial response"],
    ],
  );
});

test("settles from assistant history created after the run started", async () => {
  const runtime = control();
  runtime.wait = async () => ({ status: "ok" });
  runtime.messages = async () => ({
    messages: [
      { id: "before", role: "assistant", content: "previous answer" },
      { id: "current", role: "assistant", content: "current answer" },
    ],
  });
  const bridge = new Or3RunsBridge({ agentId: "main", control: runtime });
  bridge.ensureSession("session-history");
  const run = {
    id: "run-history",
    sessionId: "session-history",
    status: "running",
    output: "",
    events: [],
    nextEventSequence: 1,
    listeners: new Set(),
    commandChoices: [],
    historyMessageIds: new Set(["before"]),
  };
  bridge.runs.set(run.id, run);

  await bridge.settleRun(run);

  assert.equal(run.output, "current answer");
  assert.deepEqual(
    run.events.map((event) => [event.event, event.delta ?? event.output]),
    [
      ["message.delta", "current answer"],
      ["run.completed", "current answer"],
    ],
  );
});

test("streams events appended during SSE replay exactly once", async () => {
  const bridge = new Or3RunsBridge({ agentId: "main", control: control() });
  const run = {
    id: "run-sse",
    status: "running",
    output: "",
    events: [],
    nextEventSequence: 1,
    listeners: new Set(),
  };
  bridge.runs.set(run.id, run);
  bridge.append(run, { event: "message.delta", delta: "first" });

  const request = new EventEmitter();
  request.method = "GET";
  request.url = "/v1/runs/run-sse/events";
  request.headers = { authorization: "Bearer test-token" };
  const writes = [];
  let appended = false;
  const response = {
    setHeader() {},
    write(chunk) {
      writes.push(chunk);
      if (!appended && chunk.includes('"seq":1')) {
        appended = true;
        bridge.append(run, { event: "message.delta", delta: "second" });
      }
    },
    end() {},
  };

  await createOr3RunsHttpHandler(bridge, () => ({ token: "test-token" }))(
    request,
    response,
  );
  request.emit("close");

  const events = writes
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => JSON.parse(chunk.slice(6)));
  assert.deepEqual(
    events.map((event) => [event.seq, event.delta]),
    [
      [1, "first"],
      [2, "second"],
    ],
  );
});

test("expires abandoned active runs and asks OpenClaw to stop them", () => {
  const runtime = control();
  const stops = [];
  runtime.stop = async (request) => stops.push(request);
  const bridge = new Or3RunsBridge({ agentId: "main", control: runtime });
  const run = {
    id: "stale-run",
    controlRunId: "gateway-stale-run",
    sessionKey: "agent:main:or3:stale",
    status: "running",
    output: "",
    events: [],
    nextEventSequence: 1,
    listeners: new Set(),
    commandChoices: [],
    updatedAt: Date.now() / 1_000 - 31 * 60,
  };
  bridge.runs.set(run.id, run);

  bridge.prune();

  assert.equal(run.status, "cancelled");
  assert.match(run.error, /expired/u);
  assert.deepEqual(stops, [
    { sessionKey: "agent:main:or3:stale", runId: "gateway-stale-run" },
  ]);
});

test("rejects new work when fresh active runs have reached the bridge limit", async () => {
  const bridge = new Or3RunsBridge({ agentId: "main", control: control() });
  const updatedAt = Date.now() / 1_000;
  for (let index = 0; index < 200; index += 1) {
    bridge.runs.set(`active-${index}`, {
      id: `active-${index}`,
      status: "running",
      output: "",
      events: [],
      nextEventSequence: 1,
      listeners: new Set(),
      commandChoices: [],
      updatedAt,
    });
  }

  await assert.rejects(
    () => bridge.startRun("new-session", { input: "hello" }),
    (error) => error?.status === 429,
  );
});

test("bounds accumulated output and replay-event bytes for an active run", () => {
  const bridge = new Or3RunsBridge({ agentId: "main", control: control() });
  const run = {
    id: "bounded-run",
    sessionKey: "agent:main:or3:bounded",
    status: "running",
    output: "",
    events: [],
    nextEventSequence: 1,
    listeners: new Set(),
    commandChoices: [],
  };
  bridge.runs.set(run.id, run);

  for (let index = 0; index < 4; index += 1) {
    bridge.append(run, {
      event: "tool.started",
      tool: "large tool event",
      preview: "x".repeat(700 * 1024),
    });
  }
  assert.ok(run.eventBytes <= 2 * 1024 * 1024);
  assert.ok(run.events.length < 4);

  bridge.append(run, {
    event: "message.delta",
    delta: "x".repeat(512 * 1024 + 1),
  });
  assert.equal(run.status, "cancelled");
  assert.match(run.error, /output exceeded/u);
  assert.ok(run.output.length === 0);
});

test("restores a historical session without stamping the current time", async () => {
  const historical = 1_700_000_000;
  const key = sessionKeyFor("main", "old-session");
  const runtime = control();
  runtime.sessions = async (params) => {
    assert.equal(params.search, key);
    return { sessions: [{ key, lastActivityAt: historical, updatedAt: historical }] };
  };
  const bridge = new Or3RunsBridge({ agentId: "main", control: runtime });

  const session = await bridge.resolveSession("old-session");

  assert.equal(session.updatedAt, historical);
  assert.equal(session.createdAt, historical);
  assert.equal(session.sessionKey, key);
  assert.ok(Math.abs(Date.now() / 1_000 - session.updatedAt) > 86400);
});

test("prefers lastActivityAt and falls back to updatedAt", async () => {
  const key = sessionKeyFor("main", "fallback-session");
  const runtime = control();
  runtime.sessions = async () => ({
    sessions: [{ key, lastActivityAt: 1_700_000_100, updatedAt: 1_700_000_000 }],
  });
  const bridge = new Or3RunsBridge({ agentId: "main", control: runtime });
  assert.equal((await bridge.resolveSession("fallback-session")).updatedAt, 1_700_000_100);

  const updatedOnlyKey = sessionKeyFor("main", "updated-only");
  const updatedOnly = control();
  updatedOnly.sessions = async () => ({
    sessions: [{ key: updatedOnlyKey, updatedAt: 1_700_000_050 }],
  });
  const second = new Or3RunsBridge({ agentId: "main", control: updatedOnly });
  assert.equal((await second.resolveSession("updated-only")).updatedAt, 1_700_000_050);
});

test("requires an exact session-key match and leaves the map untouched when missing", async () => {
  const key = sessionKeyFor("main", "missing-session");
  const runtime = control();
  runtime.sessions = async () => ({
    sessions: [{ key: `${key}-other`, lastActivityAt: 1_700_000_000 }],
  });
  const bridge = new Or3RunsBridge({ agentId: "main", control: runtime });

  await assert.rejects(() => bridge.resolveSession("missing-session"), (error) => error?.status === 404);
  assert.equal(bridge.sessions.has("missing-session"), false);
});

test("returns 404 without mutation when native timestamps are unusable", async () => {
  const key = sessionKeyFor("main", "undated-session");
  const runtime = control();
  runtime.sessions = async () => ({ sessions: [{ key }] });
  const bridge = new Or3RunsBridge({ agentId: "main", control: runtime });

  await assert.rejects(() => bridge.resolveSession("undated-session"), (error) => error?.status === 404);
  assert.equal(bridge.sessions.has("undated-session"), false);
});

test("surfaces a 503 without mutation when sessions.list fails", async () => {
  const runtime = control();
  runtime.sessions = async () => {
    throw new Error("gateway down");
  };
  const bridge = new Or3RunsBridge({ agentId: "main", control: runtime });

  await assert.rejects(() => bridge.resolveSession("failing-session"), (error) => error?.status === 503);
  assert.equal(bridge.sessions.has("failing-session"), false);
});

test("normalizes seconds, milliseconds, and ISO timestamps to the same instant", async () => {
  const historical = 1_700_000_000;
  const key = sessionKeyFor("main", "format-session");
  const runtime = control();
  runtime.sessions = async () => ({ sessions: [{ key, updatedAt: historical }] });
  runtime.messages = async () => ({
    messages: [
      { id: "sec", role: "assistant", content: "a", timestamp: historical },
      { id: "ms", role: "assistant", content: "b", timestamp: historical * 1_000 },
      { id: "iso", role: "assistant", content: "c", createdAt: new Date(historical * 1_000).toISOString() },
      { id: "undated", role: "assistant", content: "d" },
    ],
  });
  const bridge = new Or3RunsBridge({ agentId: "main", control: runtime });

  const messages = await bridge.messages("format-session");

  for (const message of messages) assert.equal(message.timestamp, historical);
});

test("GET session restores history and missing rows stay 404 without creating state", async () => {
  const historical = 1_700_000_000;
  const key = sessionKeyFor("main", "http-session");
  const runtime = control();
  runtime.sessions = async () => ({ sessions: [{ key, lastActivityAt: historical }] });
  const bridge = new Or3RunsBridge({ agentId: "main", control: runtime });
  const handler = createOr3RunsHttpHandler(bridge, () => ({ token: "test-token", allowedOrigins: [] }));
  const get = async (url) => {
    const request = new EventEmitter();
    request.method = "GET";
    request.url = url;
    request.headers = { authorization: "Bearer test-token" };
    const response = { statusCode: 200, setHeader() {}, end(body) { this.body = body; } };
    await handler(request, response);
    return response;
  };

  const restored = await get("/or3/api/sessions/http-session");
  assert.equal(restored.statusCode, 200);
  assert.equal(JSON.parse(restored.body).session.last_active, historical);

  const missing = await get("/or3/api/sessions/unknown-session");
  assert.equal(missing.statusCode, 404);
  assert.equal(bridge.sessions.has("unknown-session"), false);
});

test("new sessions and runs still initialize from the current clock", async () => {
  const before = Date.now() / 1_000;
  const bridge = new Or3RunsBridge({ agentId: "main", control: control() });
  const session = await bridge.createSession("fresh-session");
  assert.ok(session.createdAt >= before - 1 && session.updatedAt >= before - 1);

  const runBridge = new Or3RunsBridge({ agentId: "main", control: control() });
  await runBridge.capabilities();
  await runBridge.createSession("active-session");
  const beforeRun = Date.now() / 1_000;
  const run = await runBridge.startRun("active-session", { input: "/models" });
  assert.equal(run.status, "completed");
  assert.ok(runBridge.sessions.get("active-session").updatedAt >= beforeRun - 1);
  assert.ok(run.updatedAt >= beforeRun - 1);
});
