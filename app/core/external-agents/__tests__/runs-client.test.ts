import { describe, expect, it, vi } from "vitest";
import {
  createRunsExternalAgentClient,
  RunsClientError,
  type RunsFetch,
} from "../runs-client";
import { ExternalAgentController } from "../controller";
import type {
  ExternalAgentCredentialVault,
  ExternalAgentPersistence,
  ExternalAgentPersistenceSnapshot,
} from "../types";

// Captured from Hermes Agent v0.16.0 (tag v2026.6.5). The tests below keep
// Hermes's native field names so the production client remains runtime-neutral.
const capabilities = {
  object: "hermes.api_server.capabilities",
  platform: "hermes-agent",
  model: "hermes-agent",
  features: {
    session_resources: true,
    run_events_sse: true,
    run_stop: true,
    run_approval_response: true,
    tool_progress_events: true,
  },
  endpoints: {
    sessions: { method: "GET", path: "/api/sessions" },
    session_messages: {
      method: "GET",
      path: "/api/sessions/{session_id}/messages",
    },
    run_events: { method: "GET", path: "/v1/runs/{run_id}/events" },
    run_stop: { method: "POST", path: "/v1/runs/{run_id}/stop" },
    run_approval: {
      method: "POST",
      path: "/v1/runs/{run_id}/approval",
    },
  },
};

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function sse(chunks: readonly string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream" },
  });
}

function pathOf(input: RequestInfo | URL): string {
  return new URL(String(input)).pathname;
}

function clientWith(fetch: RunsFetch) {
  return createRunsExternalAgentClient({
    baseUrl: "http://127.0.0.1:8642",
    resolveCredential: async () => "hermes-secret",
    fetch,
  });
}

function controllerPersistence(): ExternalAgentPersistence {
  let saved: ExternalAgentPersistenceSnapshot = {
    hosts: [],
    activeHostId: null,
    sessionRefs: [],
  };
  return {
    bind: (workspaceId) => ({
      workspaceId,
      load: async () => structuredClone(saved),
      save: async (snapshot) => {
        saved = structuredClone(snapshot);
      },
    }),
  };
}

function controllerVault(): ExternalAgentCredentialVault {
  const values = new Map<string, string>();
  return {
    put: async (reference, secret) => void values.set(reference, secret),
    resolve: async (reference) => values.get(reference) ?? null,
    remove: async (reference) => void values.delete(reference),
  };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for controller state");
}

describe("RunsExternalAgentClient", () => {
  it("authenticates health and synthesizes a usable capability-backed runner", async () => {
    const fetch = vi.fn<RunsFetch>(async (input, init) => {
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        "Bearer hermes-secret",
      );
      expect(init?.cache).toBe("no-store");
      return pathOf(input) === "/health"
        ? json({ status: "ok", platform: "hermes-agent" })
        : json(capabilities);
    });
    const client = clientWith(fetch);

    await expect(client.health()).resolves.toMatchObject({
      status: "ok",
      runtimeAvailable: true,
    });
    await expect(client.capabilities()).resolves.toMatchObject({
      execAvailable: true,
      runtimeProduct: "hermes-agent",
      approvalBroker: { enabled: true, available: true },
    });
    await expect(client.listRunners()).resolves.toMatchObject({
      default_runner: "agent",
      runners: [
        {
          id: "agent",
          display_name: "Hermes Agent",
          status: "available",
          auth_status: "ready",
        },
      ],
    });
  });

  it("discovers the current provider's models from its advertised endpoint", async () => {
    const requests: Array<{ path: string; body?: unknown }> = [];
    const fetch = vi.fn<RunsFetch>(async (input, init) => {
      const path = pathOf(input);
      requests.push({
        path,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (path === "/v1/capabilities") {
        return json({
          ...capabilities,
          model: "vendor/reasoning-model",
          endpoints: {
            ...capabilities.endpoints,
            model_options: { method: "GET", path: "/api/model/options" },
          },
        });
      }
      if (path === "/api/model/options") {
        return json({
          provider: "portal",
          model: "vendor/reasoning-model",
          providers: [
            {
              slug: "portal",
              name: "Portal",
              authenticated: true,
              is_current: true,
              models: ["vendor/reasoning-model", "vendor/fast-model"],
              capabilities: {
                "vendor/reasoning-model": { reasoning: true },
                "vendor/fast-model": { reasoning: false },
              },
            },
            {
              slug: "second-provider",
              name: "Second Provider",
              authenticated: true,
              models: ["second/model"],
              capabilities: { "second/model": { reasoning: true } },
            },
          ],
        });
      }
      if (path === "/api/sessions" && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        return json({
          session: {
            id: body.id,
            model: body.model,
            started_at: 1_750_000_000,
          },
        });
      }
      if (path === "/v1/runs") {
        return json({ run_id: "run-model", status: "started" }, 202);
      }
      if (path === "/v1/runs/run-model/events") {
        return sse(['data: {"event":"run.completed","output":"done"}\n\n']);
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const client = clientWith(fetch);

    await expect(client.listRunners()).resolves.toMatchObject({
      runners: [
        {
          models: [
            {
              id: "vendor/reasoning-model",
              provider: "portal",
              provider_name: "Portal",
              default: true,
              reasoning: ["minimal", "low", "medium", "high", "xhigh"],
            },
            { id: "vendor/fast-model", provider: "portal" },
            {
              id: "second/model",
              provider: "second-provider",
              provider_name: "Second Provider",
            },
          ],
        },
      ],
    });
    await client.createSession({
      app_session_key: "session-1",
      runner_id: "agent",
      model: "second/model",
    });
    await client.startTurn("session-1", {
      user_message: "hello",
      model: "second/model",
      thinking_level: "high",
    });
    expect(requests).toContainEqual({
      path: "/api/sessions",
      body: expect.objectContaining({
        model: "second/model",
        provider: "second-provider",
      }),
    });
    expect(requests).toContainEqual({
      path: "/v1/runs",
      body: expect.objectContaining({
        model: "second/model",
        provider: "second-provider",
        model_options: { reasoning_effort: "high" },
      }),
    });
  });

  it("falls back to Hermes's stable model-options route when capabilities omit it", async () => {
    const requests: string[] = [];
    const fetch = vi.fn<RunsFetch>(async (input) => {
      const path = pathOf(input);
      requests.push(path);
      if (path === "/v1/capabilities") {
        // This is the shape returned by older Hermes API servers: Runs is
        // advertised, but model_options is not yet listed in endpoints.
        return json({
          object: "hermes.api_server.capabilities",
          platform: "hermes-agent",
          model: "hermes-agent",
          features: {
            session_resources: true,
            run_events_sse: true,
            run_stop: true,
          },
        });
      }
      if (path === "/api/model/options") {
        return json({
          provider: "portal",
          model: "portal/model-a",
          providers: [
            {
              slug: "portal",
              name: "Nous Portal",
              authenticated: true,
              is_current: true,
              models: ["portal/model-a", "portal/model-b"],
              capabilities: {
                "portal/model-a": { reasoning: true },
              },
            },
          ],
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const client = clientWith(fetch);

    await expect(client.listRunners()).resolves.toMatchObject({
      runners: [
        {
          status: "available",
          models: [
            expect.objectContaining({
              id: "portal/model-a",
              provider: "portal",
              default: true,
            }),
            expect.objectContaining({ id: "portal/model-b" }),
          ],
        },
      ],
    });
    expect(requests).toEqual(["/v1/capabilities", "/api/model/options"]);
  });

  it("keeps duplicate model ids selectable by provider", async () => {
    const requests: Array<{ path: string; body?: unknown }> = [];
    const fetch = vi.fn<RunsFetch>(async (input, init) => {
      const path = pathOf(input);
      requests.push({
        path,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (path === "/v1/capabilities") {
        return json({
          ...capabilities,
          endpoints: {
            ...capabilities.endpoints,
            model_options: { method: "GET", path: "/api/model/options" },
          },
        });
      }
      if (path === "/api/model/options") {
        return json({
          providers: [
            {
              slug: "portal",
              name: "Portal",
              authenticated: true,
              models: ["shared-model"],
            },
            {
              slug: "fallback",
              name: "Fallback",
              authenticated: true,
              models: ["shared-model"],
            },
          ],
        });
      }
      if (path === "/v1/runs") {
        return json({ run_id: "run-duplicate-model", status: "started" }, 202);
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const client = clientWith(fetch);

    const runners = await client.listRunners();
    expect(runners.runners[0]?.models).toEqual([
      expect.objectContaining({
        id: "portal/shared-model",
        provider: "portal",
      }),
      expect.objectContaining({
        id: "fallback/shared-model",
        provider: "fallback",
      }),
    ]);
    await client.startTurn("session-duplicate-model", {
      user_message: "use fallback",
      model: "fallback/shared-model",
    });
    expect(requests.at(-1)).toEqual({
      path: "/v1/runs",
      body: expect.objectContaining({
        model: "shared-model",
        provider: "fallback",
      }),
    });
  });

  it("deduplicates concurrent capability discovery", async () => {
    let capabilityRequests = 0;
    const fetch = vi.fn<RunsFetch>(async (input) => {
      if (pathOf(input) !== "/v1/capabilities")
        throw new Error(`Unexpected request: ${pathOf(input)}`);
      capabilityRequests += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return json(capabilities);
    });
    const client = clientWith(fetch);

    await Promise.all([
      client.capabilities(),
      client.listRunners(),
      client.capabilities(),
    ]);
    expect(capabilityRequests).toBe(1);
  });

  it("handles fallback control commands locally without starting generation", async () => {
    const requests: string[] = [];
    const fetch = vi.fn<RunsFetch>(async (input) => {
      const path = pathOf(input);
      requests.push(path);
      if (path === "/v1/capabilities") {
        return json({
          ...capabilities,
          endpoints: {
            ...capabilities.endpoints,
            model_options: { method: "GET", path: "/api/model/options" },
          },
        });
      }
      if (path === "/api/model/options") {
        return json({
          provider: "portal",
          model: "vendor/model",
          providers: [
            {
              slug: "portal",
              name: "Portal",
              authenticated: true,
              models: ["vendor/model"],
            },
          ],
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const client = clientWith(fetch);
    await client.listRunners();
    const started = await client.startTurn("session-local", {
      user_message: "/models",
    });
    const events = [];
    for await (const event of client.streamTurn(
      "session-local",
      started.turn_id,
    )) {
      events.push(event.json);
    }

    expect(started.status).toBe("completed");
    expect(requests).toEqual(["/v1/capabilities", "/api/model/options"]);
    expect(events).toEqual([
      expect.objectContaining({
        type: "command.choices",
        payload: {
          rawType: "command.choices",
          choices: [{ label: "Portal (1)", command: "/models portal" }],
        },
      }),
      expect.objectContaining({
        type: "turn.completed",
        payload: { status: "completed" },
      }),
    ]);
  });

  it("shows model choices locally and applies a selected model without generation", async () => {
    const requests: Array<{ path: string; method?: string }> = [];
    const fetch = vi.fn<RunsFetch>(async (input, init) => {
      const path = pathOf(input);
      requests.push({ path, method: init?.method });
      if (path === "/v1/capabilities") {
        return json({
          ...capabilities,
          model: "vendor/model-a",
          endpoints: {
            ...capabilities.endpoints,
            model_options: { method: "GET", path: "/api/model/options" },
          },
        });
      }
      if (path === "/api/model/options") {
        return json({
          provider: "portal",
          model: "vendor/model-a",
          providers: [
            {
              slug: "portal",
              name: "Portal",
              authenticated: true,
              models: ["vendor/model-a", "vendor/model-b"],
            },
          ],
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const client = clientWith(fetch);
    await client.listRunners();
    const provider = await client.startTurn("session-model", {
      user_message: "/models",
    });
    const providerEvents = [];
    for await (const event of client.streamTurn(
      "session-model",
      provider.turn_id,
    )) {
      providerEvents.push(event.json);
    }
    expect(providerEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "command.choices" }),
      ]),
    );

    const selected = await client.startTurn("session-model", {
      user_message: "/model vendor/model-b",
    });
    expect(selected.status).toBe("completed");
    expect(requests.map(({ path }) => path)).toEqual([
      "/v1/capabilities",
      "/api/model/options",
    ]);
  });

  it("forwards advertised interactive model selections to the runtime", async () => {
    const requests: Array<{ path: string; body?: unknown }> = [];
    const fetch = vi.fn<RunsFetch>(async (input, init) => {
      const path = pathOf(input);
      requests.push({
        path,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (path === "/v1/capabilities") {
        return json({
          ...capabilities,
          features: {
            ...capabilities.features,
            interactive_commands: true,
          },
          model: "vendor/model-a",
          endpoints: {
            ...capabilities.endpoints,
            model_options: { method: "GET", path: "/api/model/options" },
          },
        });
      }
      if (path === "/api/model/options") {
        return json({
          provider: "portal",
          model: "vendor/model-a",
          providers: [
            {
              slug: "portal",
              name: "Portal",
              authenticated: true,
              models: ["vendor/model-a", "vendor/model-b"],
            },
          ],
        });
      }
      if (path === "/v1/runs") {
        return json(
          { run_id: "run-interactive-model", status: "started" },
          202,
        );
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const client = clientWith(fetch);
    await client.listRunners();

    const selected = await client.startTurn("session-interactive", {
      user_message: "/model vendor/model-b",
    });

    expect(selected.status).toBe("queued");
    expect(requests).toContainEqual({
      path: "/v1/runs",
      body: expect.objectContaining({ input: "/model vendor/model-b" }),
    });
  });

  it("maps sessions and reconstructs turns from message history", async () => {
    const fetch = vi.fn<RunsFetch>(async (input, init) => {
      const path = pathOf(input);
      if (path === "/api/sessions" && init?.method === "POST") {
        return json({
          object: "hermes.session",
          session: {
            id: "or3:workspace:session-1",
            model: "hermes-agent",
            started_at: 1_750_000_000,
            last_active: 1_750_000_010,
          },
        });
      }
      if (path.endsWith("/messages")) {
        return json({
          object: "list",
          data: [
            {
              id: "message-user-1",
              role: "user",
              content: "hello",
              timestamp: 1_750_000_001,
            },
            {
              id: "message-assistant-1",
              role: "assistant",
              content: "hi there",
              finished: true,
              timestamp: 1_750_000_002,
            },
          ],
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const client = clientWith(fetch);
    const session = await client.createSession({
      app_session_key: "or3:workspace:session-1",
      runner_id: "agent",
    });

    expect(session).toMatchObject({
      id: "or3:workspace:session-1",
      app_session_key: "or3:workspace:session-1",
      runner_id: "agent",
      model: "hermes-agent",
    });
    await expect(client.listTurns(session.id)).resolves.toEqual({
      turns: [
        expect.objectContaining({
          id: "message-user-1",
          session_id: session.id,
          sequence: 1,
          status: "succeeded",
          user_message: "hello",
          final_text: "hi there",
        }),
      ],
    });
    await expect(
      client.listTurnEvents(session.id, "message-user-1"),
    ).resolves.toEqual({
      events: expect.arrayContaining([
        expect.objectContaining({ type: "text_delta", text: "hi there" }),
        expect.objectContaining({
          type: "turn.completed",
          payload: { status: "completed" },
        }),
      ]),
    });
  });

  it("treats assistant history text as completed when no live run is active", async () => {
    const fetch = vi.fn<RunsFetch>(async (input) => {
      const path = pathOf(input);
      if (path.endsWith("/messages")) {
        return json({
          data: [
            {
              id: "message-user-partial",
              role: "user",
              content: "write a response",
              timestamp: 1_750_000_001,
            },
            {
              id: "message-assistant-partial",
              role: "assistant",
              content: "still streaming",
              timestamp: 1_750_000_002,
            },
          ],
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const client = clientWith(fetch);

    await expect(client.listTurns("session-partial")).resolves.toEqual({
      turns: [
        expect.objectContaining({
          id: "message-user-partial",
          status: "succeeded",
          final_text: "still streaming",
        }),
      ],
    });
    await expect(
      client.listTurnEvents("session-partial", "message-user-partial"),
    ).resolves.toEqual({
      events: expect.arrayContaining([
        expect.objectContaining({
          type: "text_delta",
          text: "still streaming",
        }),
        expect.objectContaining({
          type: "turn.completed",
          payload: { status: "completed" },
        }),
      ]),
    });
  });

  it("settles a user-only history turn as cancelled when no live run remains", async () => {
    const fetch = vi.fn<RunsFetch>(async (input) => {
      const path = pathOf(input);
      if (path.endsWith("/messages")) {
        return json({
          data: [
            {
              id: "message-user-active",
              role: "user",
              content: "still working",
              timestamp: 1_750_000_001,
            },
          ],
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const client = clientWith(fetch);

    await expect(client.listTurns("session-active")).resolves.toEqual({
      turns: [
        expect.objectContaining({
          id: "message-user-active",
          status: "cancelled",
        }),
      ],
    });
    await expect(
      client.listTurnEvents("session-active", "message-user-active"),
    ).resolves.toEqual({ events: [] });
  });

  it("settles tool-only history turns when no live run remains", async () => {
    const fetch = vi.fn<RunsFetch>(async (input) => {
      const path = pathOf(input);
      if (path.endsWith("/messages")) {
        return json({
          data: [
            {
              id: "message-user-tool",
              role: "user",
              content: "run the check",
              timestamp: 1_750_000_001,
            },
            {
              id: "message-tool",
              role: "tool",
              tool_name: "terminal",
              status: "completed",
              timestamp: 1_750_000_002,
            },
          ],
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const client = clientWith(fetch);

    await expect(client.listTurns("session-tool-active")).resolves.toEqual({
      turns: [
        expect.objectContaining({
          id: "message-user-tool",
          status: "succeeded",
          completed_at: 1_750_000_002,
        }),
      ],
    });
    await expect(
      client.listTurnEvents("session-tool-active", "message-user-tool"),
    ).resolves.toEqual({
      events: expect.arrayContaining([
        expect.objectContaining({ type: "tool.completed" }),
        expect.objectContaining({
          type: "turn.completed",
          payload: { status: "completed" },
        }),
      ]),
    });
  });

  it("does not treat null completion timestamps alone as terminal markers", async () => {
    const fetch = vi.fn<RunsFetch>(async (input) => {
      const path = pathOf(input);
      if (path.endsWith("/messages")) {
        return json({
          data: [
            {
              id: "message-user-null-terminal",
              role: "user",
              content: "still running",
              timestamp: 1_750_000_001,
              completed_at: null,
            },
          ],
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const client = clientWith(fetch);

    // No assistant/tool progress and no live run → settle as cancelled, not
    // invent success from a null completed_at on the user message.
    await expect(client.listTurns("session-null-terminal")).resolves.toEqual({
      turns: [
        expect.objectContaining({
          id: "message-user-null-terminal",
          status: "cancelled",
        }),
      ],
    });
  });

  it("replays history turns without polling missing live run endpoints", async () => {
    const fetch = vi.fn<RunsFetch>(async (input) => {
      const path = pathOf(input);
      if (path.endsWith("/messages")) {
        return json({
          data: [
            {
              id: "message-1",
              role: "user",
              content: "hello",
              timestamp: 1_750_000_001,
            },
            {
              id: "message-2",
              role: "assistant",
              content: "hi",
              timestamp: 1_750_000_002,
            },
          ],
        });
      }
      throw new Error(`Unexpected live run request: ${path}`);
    });
    const client = clientWith(fetch);
    await client.listTurns("session-history-stream");

    const events: Array<string | undefined> = [];
    for await (const event of client.streamTurn(
      "session-history-stream",
      "message-1",
    )) {
      events.push(
        (event.json as { type?: string } | undefined)?.type ?? event.event,
      );
    }

    expect(events).toEqual(
      expect.arrayContaining(["text_delta", "turn.completed"]),
    );
    expect(
      fetch.mock.calls.some(([request]) =>
        pathOf(request).includes("/v1/runs/"),
      ),
    ).toBe(false);
  });

  it("parses CRLF frames split across chunks and a final unterminated frame", async () => {
    const fetch = vi.fn<RunsFetch>(async (input, init) => {
      const path = pathOf(input);
      if (path === "/v1/runs" && init?.method === "POST") {
        return json({ run_id: "run-crlf", status: "started" }, 202);
      }
      if (path === "/v1/runs/run-crlf/events") {
        return sse([
          'data: {"event":"message.delta","delta":"one"}\r',
          '\n\r\ndata: {"event":"message.delta","delta":"two"}',
        ]);
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const client = clientWith(fetch);
    const started = await client.startTurn("session-crlf", {
      user_message: "stream",
    });
    const events = [];
    for await (const event of client.streamTurn(
      "session-crlf",
      started.turn_id,
    )) {
      events.push(event.json);
    }
    expect(events).toEqual([
      expect.objectContaining({ text: "one" }),
      expect.objectContaining({ text: "two" }),
    ]);
  });

  it("reopens an event stream after a non-terminal disconnect", async () => {
    let eventRequests = 0;
    const fetch = vi.fn<RunsFetch>(async (input, init) => {
      const path = pathOf(input);
      if (path === "/v1/runs" && init?.method === "POST") {
        return json({ run_id: "run-reconnect", status: "started" }, 202);
      }
      if (path === "/v1/runs/run-reconnect/events") {
        eventRequests += 1;
        return eventRequests === 1
          ? sse(['data: {"event":"message.delta","delta":"partial"}\n\n'])
          : sse(['data: {"event":"run.completed","output":"done"}\n\n']);
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const client = clientWith(fetch);
    const started = await client.startTurn("session-reconnect", {
      user_message: "hello",
    });
    const first = [];
    for await (const event of client.streamTurn(
      "session-reconnect",
      started.turn_id,
    )) {
      first.push(event.json);
    }
    const second = [];
    for await (const event of client.streamTurn(
      "session-reconnect",
      started.turn_id,
      { afterSeq: 1 },
    )) {
      second.push(event.json);
    }

    expect(eventRequests).toBe(2);
    expect(first).toEqual([
      expect.objectContaining({ type: "text_delta", text: "partial" }),
    ]);
    expect(second).toEqual([
      expect.objectContaining({ type: "turn.completed" }),
    ]);
  });

  it("rejects an event stream that closes without a supported event", async () => {
    const fetch = vi.fn<RunsFetch>(async (input, init) => {
      const path = pathOf(input);
      if (path === "/v1/runs" && init?.method === "POST") {
        return json({ run_id: "run-empty", status: "started" }, 202);
      }
      if (path === "/v1/runs/run-empty/events") return sse([": closed\n\n"]);
      throw new Error(`Unexpected request: ${path}`);
    });
    const client = clientWith(fetch);
    const started = await client.startTurn("session-empty", {
      user_message: "stream",
    });

    await expect(
      (async () => {
        for await (const _event of client.streamTurn(
          "session-empty",
          started.turn_id,
        )) {
          // The stream is expected to fail before yielding an event.
        }
      })(),
    ).rejects.toThrow("Agent event stream closed without events");
  });

  it("releases earlier staged files when a later attachment cannot be read", async () => {
    const fetch = vi.fn<RunsFetch>(async () => {
      throw new Error("The request should not start");
    });
    const client = clientWith(fetch);
    const unreadable = new Blob(["bad"]);
    Object.defineProperty(unreadable, "arrayBuffer", {
      value: () => Promise.reject(new Error("read failed")),
    });

    await expect(
      client.stageFiles([
        {
          id: "staged-before-failure",
          kind: "file",
          name: "ok.txt",
          data: new Blob(["ok"]),
        },
        {
          id: "staged-failure",
          kind: "file",
          name: "bad.txt",
          data: unreadable,
        },
      ]),
    ).rejects.toThrow("read failed");
    await expect(
      client.startTurn("session-attachments", {
        user_message: "retry",
        attachments: [
          {
            id: "staged-before-failure",
            source: "local_artifact",
            kind: "file",
            name: "ok.txt",
          },
        ],
      }),
    ).rejects.toThrow("attachment is no longer available");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("forwards slash commands unchanged and translates chunked run events", async () => {
    const requestBodies: unknown[] = [];
    const fetch = vi.fn<RunsFetch>(async (input, init) => {
      const path = pathOf(input);
      if (path === "/v1/runs" && init?.method === "POST") {
        requestBodies.push(JSON.parse(String(init.body)));
        return json({ run_id: "run-1", status: "started" }, 202);
      }
      if (path === "/v1/runs/run-1/events") {
        return sse([
          'data: {"event":"message.',
          'delta","delta":"hel","timestamp":1750000001}\n\n',
          'data: {"event":"tool.started","tool":"terminal","preview":"Working"}\n\n',
          'data: {"event":"approval.request","command":"git push","choices":["once","deny"]}\n\n',
          'data: {"event":"approval.responded","choice":"once"}\n\n',
          'data: {"event":"run.completed","output":"hello"}\n\n',
        ]);
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const client = clientWith(fetch);
    const attachments = await client.stageFiles([
      {
        id: "attachment-1",
        kind: "image",
        name: "example.png",
        mimeType: "image/png",
        data: new Blob([Uint8Array.from([1, 2, 3])], { type: "image/png" }),
      },
    ]);
    const started = await client.startTurn("session-1", {
      user_message: "/model anthropic/claude",
      attachments,
    });
    const streamed = [];
    for await (const event of client.streamTurn("session-1", started.turn_id)) {
      streamed.push(event.json);
    }

    expect(requestBodies).toEqual([
      expect.objectContaining({
        input: "/model anthropic/claude",
        session_id: "session-1",
        attachments: [
          {
            fileName: "example.png",
            mimeType: "image/png",
            content: "AQID",
          },
        ],
      }),
    ]);
    expect(streamed).toEqual([
      expect.objectContaining({ type: "text_delta", text: "hel", seq: 1 }),
      expect.objectContaining({ type: "tool.started", seq: 2 }),
      expect.objectContaining({
        type: "approval.request",
        seq: 3,
        payload: expect.objectContaining({
          approval_id: "run-1",
          command: "git push",
        }),
      }),
      expect.objectContaining({
        type: "approval.resolved",
        seq: 4,
        payload: expect.objectContaining({ decision: "approve" }),
      }),
      expect.objectContaining({
        type: "turn.completed",
        seq: 5,
        payload: { status: "completed" },
      }),
    ]);
  });

  it("uses native approval and stop operations and capability checks", async () => {
    const requests: Array<{ path: string; body: unknown }> = [];
    const fetch = vi.fn<RunsFetch>(async (input, init) => {
      const path = pathOf(input);
      if (path === "/v1/capabilities") return json(capabilities);
      requests.push({
        path,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return json({ status: "ok" });
    });
    const client = clientWith(fetch);

    await client.decideTurn("session-1", "run-1", "approve", {
      allow_session: true,
    });
    await client.decideTurn("session-1", "run-1", "reject");
    await client.abortTurn("session-1", "run-1");

    expect(requests).toEqual([
      { path: "/v1/runs/run-1/approval", body: { choice: "session" } },
      { path: "/v1/runs/run-1/approval", body: { choice: "deny" } },
      { path: "/v1/runs/run-1/stop", body: {} },
    ]);
  });

  it("drives streaming and approval resume through the existing controller", async () => {
    const encoder = new TextEncoder();
    let eventController: ReadableStreamDefaultController<Uint8Array> | null =
      null;
    let approved = false;
    const runInputs: unknown[] = [];
    const fetch = vi.fn<RunsFetch>(async (input, init) => {
      const path = pathOf(input);
      if (path === "/health") return json({ status: "ok" });
      if (path === "/v1/capabilities") return json(capabilities);
      if (path === "/api/sessions" && init?.method !== "POST") {
        return json({ data: [] });
      }
      if (path === "/api/sessions" && init?.method === "POST") {
        return json({
          session: {
            id: "session-controller",
            started_at: 1_750_000_000,
            last_active: 1_750_000_000,
          },
        });
      }
      if (path === "/v1/runs" && init?.method === "POST") {
        runInputs.push(JSON.parse(String(init.body)));
        return json({ run_id: "run-controller", status: "started" }, 202);
      }
      if (path === "/v1/runs/run-controller/events") {
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              eventController = controller;
              controller.enqueue(
                encoder.encode(
                  'data: {"event":"message.delta","delta":"Checking"}\n\n' +
                    'data: {"event":"approval.request","command":"git push","reason":"Publish changes"}\n\n',
                ),
              );
            },
          }),
          { headers: { "Content-Type": "text/event-stream" } },
        );
      }
      if (path === "/v1/runs/run-controller/approval") {
        approved = true;
        eventController?.enqueue(
          encoder.encode(
            'data: {"event":"approval.responded","choice":"once"}\n\n' +
              'data: {"event":"run.completed","output":"Published"}\n\n',
          ),
        );
        eventController?.close();
        await Promise.resolve();
        await Promise.resolve();
        return json({ status: "ok" });
      }
      if (path === "/v1/runs/run-controller") {
        return json({
          status: approved ? "completed" : "running",
          output: approved ? "Published" : undefined,
          updated_at: 1_750_000_010,
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const controller = new ExternalAgentController({
      persistence: controllerPersistence(),
      credentials: controllerVault(),
      detectDriver: async () => "runs",
      createClient: ({ host, resolveCredential }) =>
        createRunsExternalAgentClient({
          baseUrl: host.baseUrl,
          resolveCredential,
          fetch,
        }),
      getWorkspaceScope: () => "workspace-controller",
    });
    await controller.initialize();
    const host = await controller.addTrustedHost({
      name: "Hermes",
      baseUrl: "http://127.0.0.1:8642",
      token: "secret",
    });
    const session = await controller.launch({
      runnerId: "agent",
      instruction: "Publish the changes",
      mode: "review",
      isolation: "host_readonly",
    });

    await waitUntil(
      () =>
        controller.getSession(session.remoteSessionId, host.id)?.status ===
        "waiting_approval",
    );
    const waiting = controller.getSession(session.remoteSessionId, host.id)!;
    expect(waiting.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "message", text: "Checking" }),
      ]),
    );
    expect(waiting.approvals).toEqual([
      expect.objectContaining({
        id: "run-controller",
        status: "pending",
        description: "Publish changes",
      }),
    ]);

    await controller.decideApproval(
      session.remoteSessionId,
      "approve",
      "run-controller",
    );
    await waitUntil(
      () =>
        controller.getSession(session.remoteSessionId, host.id)?.status ===
        "succeeded",
    );
    const completed = controller.getSession(session.remoteSessionId, host.id)!;
    expect(completed.output).toContain("Published");
    expect(completed.approvals[0]?.status).toBe("approved");
    expect(runInputs).toEqual([
      expect.objectContaining({ input: "Publish the changes" }),
    ]);
    controller.dispose();
  });

  it("redacts arbitrary failed response bodies", async () => {
    const fetch = vi.fn<RunsFetch>(async () =>
      json(
        {
          error: {
            message:
              "Authorization Bearer top-secret failed at https://private.test",
          },
        },
        401,
      ),
    );
    const client = clientWith(fetch);

    const error = await client.health().catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(RunsClientError);
    expect(String(error)).not.toContain("top-secret");
    expect(String(error)).not.toContain("private.test");
  });
});
