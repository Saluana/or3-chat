import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  Or3RunsBridge,
  createOr3RunsHttpHandler,
} from "../../packages/openclaw-or3/src/bridge.js";
import {
  createRunsExternalAgentClient,
  type RunsFetch,
} from "../../app/core/external-agents/runs-client";

function pending<T>() {
  return new Promise<T>(() => undefined);
}

function bridgeFetch(bridge: Or3RunsBridge): RunsFetch {
  const handler = createOr3RunsHttpHandler(bridge, () => ({
    token: "gateway-token",
    allowedOrigins: ["http://or3.test"],
  }));
  return async (input, init) => {
    const url = new URL(String(input));
    const request = Readable.from(
      init?.body ? [String(init.body)] : [],
    ) as Readable & {
      method?: string;
      url?: string;
      headers?: Record<string, string>;
    };
    request.method = init?.method ?? "GET";
    request.url = `${url.pathname}${url.search}`;
    request.headers = Object.fromEntries(new Headers(init?.headers).entries());
    const headers = new Headers();
    let status = 200;
    let streamController: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
    });
    const encoder = new TextEncoder();
    let ended = false;
    const response = {
      get statusCode() {
        return status;
      },
      set statusCode(value: number) {
        status = value;
      },
      setHeader(name: string, value: string) {
        headers.set(name, value);
      },
      write(value: string) {
        streamController.enqueue(encoder.encode(value));
        return true;
      },
      end(value?: string) {
        if (value) streamController.enqueue(encoder.encode(value));
        if (!ended) streamController.close();
        ended = true;
      },
    };
    await handler(request, response);
    return new Response(status === 204 ? null : stream, { status, headers });
  };
}

describe("OpenClaw OR3 Runs plugin", () => {
  it("passes the shared Runs client contract through native OpenClaw lifecycle calls", async () => {
    const gatewayRequests: Array<{ method: string; params: unknown }> = [];
    const runRequests: unknown[] = [];
    const configure = vi.fn(async () => ({ ok: true }));
    const createSession = vi.fn(async () => ({ ok: true }));
    let nextRun = 0;
    const runtime = {
      subagent: {
        run: vi.fn(async (input) => {
          runRequests.push(input);
          nextRun += 1;
          return { runId: `openclaw-run-${nextRun}` };
        }),
        waitForRun: vi.fn(() => pending()),
        getSessionMessages: vi.fn(async () => ({ messages: [] })),
      },
      gateway: {
        request: vi.fn(async (method, params) => {
          gatewayRequests.push({ method, params });
          return { ok: true };
        }),
      },
    };
    const bridge = new Or3RunsBridge({
      agentId: "main",
      control: {
        start: runtime.subagent.run,
        wait: runtime.subagent.waitForRun,
        messages: runtime.subagent.getSessionMessages,
        models: vi.fn(async () => ({
          models: [
            {
              id: "gpt-5",
              name: "GPT-5",
              provider: "openai",
              available: true,
              reasoning: true,
            },
          ],
        })),
        commands: vi.fn(async () => ({
          commands: [
            {
              name: "model",
              description: "Choose a model",
              acceptsArgs: true,
              args: [{ name: "model", dynamic: true }],
            },
            {
              name: "verbose",
              description: "Set verbose output",
              acceptsArgs: true,
              args: [
                {
                  name: "level",
                  choices: [
                    { value: "on", label: "On" },
                    { value: "off", label: "Off" },
                  ],
                },
              ],
            },
          ],
        })),
        agents: vi.fn(async () => ({
          agents: [
            {
              id: "main",
              model: { primary: "openai/gpt-5" },
              thinkingLevels: [
                { id: "low", label: "Low" },
                { id: "high", label: "High" },
              ],
              thinkingDefault: "high",
            },
          ],
        })),
        configure,
        createSession,
        stop: (params: unknown) =>
          runtime.gateway.request("chat.abort", params),
        decide: ({
          method,
          id,
          decision,
        }: {
          method: string;
          id: string;
          decision: string;
        }) => runtime.gateway.request(method, { id, decision }),
      },
    });
    const fetch = bridgeFetch(bridge);
    const preflight = await fetch("http://gateway.test/or3/v1/capabilities", {
      method: "OPTIONS",
      headers: { Origin: "http://or3.test" },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://or3.test",
    );
    const client = createRunsExternalAgentClient({
      baseUrl: "http://gateway.test/or3/",
      resolveCredential: async () => "gateway-token",
      fetch,
    });

    await expect(client.capabilities()).resolves.toMatchObject({
      runtimeProduct: "openclaw",
      execAvailable: true,
      approvalBroker: { enabled: true, available: true },
    });
    await expect(client.listRunners()).resolves.toMatchObject({
      runners: [
        {
          chat_capabilities: { attachments: true },
          models: [
            expect.objectContaining({
              id: "openai/gpt-5",
              reasoning: ["low", "high"],
            }),
          ],
          commands: expect.arrayContaining([
            expect.objectContaining({ command: "/model" }),
          ]),
        },
      ],
    });
    expect(bridge.commandChoices("/models")).toEqual([
      { label: "openai (1)", command: "/models openai" },
    ]);
    expect(bridge.commandChoices("/models openai")).toEqual([
      { label: "GPT-5", command: "/model openai/gpt-5" },
      { label: "← Providers", command: "/models" },
    ]);
    const session = await client.createSession({
      app_session_key: "or3:workspace:test-session",
      runner_id: "agent",
      model: "openai/gpt-5",
    });
    const attachments = await client.stageFiles([
      {
        id: "attachment-1",
        kind: "image",
        name: "example.png",
        mimeType: "image/png",
        data: new Blob([Uint8Array.from([1, 2, 3])], { type: "image/png" }),
      },
    ]);
    const started = await client.startTurn(session.id, {
      user_message: "/model openai/gpt-5",
      model: "openai/gpt-5",
      thinking_level: "high",
      attachments,
    });
    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "openai/gpt-5",
        key: expect.stringMatching(/^agent:main:or3:[a-z0-9_-]+$/),
      }),
    );
    expect(configure).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "openai/gpt-5",
        thinkingLevel: "high",
      }),
    );

    bridge.handleChatEvent({
      runId: "openclaw-run-1",
      sessionKey: bridge.runs.get(started.turn_id)?.sessionKey,
      state: "delta",
      deltaText: "Working ",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Working " }],
      },
    });
    bridge.handleAgentEvent({
      runId: "internal-openclaw-run-1",
      sessionKey: bridge.runs.get(started.turn_id)?.sessionKey,
      stream: "tool",
      data: { phase: "start", name: "exec", meta: "git push" },
    });
    bridge.handleAgentEvent({
      runId: "internal-openclaw-run-1",
      sessionKey: bridge.runs.get(started.turn_id)?.sessionKey,
      stream: "tool",
      data: { phase: "update", name: "exec", meta: "still running" },
    });
    bridge.handleAgentEvent({
      runId: "internal-openclaw-run-1",
      sessionKey: bridge.runs.get(started.turn_id)?.sessionKey,
      stream: "approval",
      data: {
        phase: "requested",
        kind: "exec",
        approvalId: "approval-1",
        title: "Run command",
        command: "git push",
      },
    });

    const iterator = client
      .streamTurn(session.id, started.turn_id)
      [Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({
      value: { json: { type: "text_delta", text: "Working " } },
    });
    await expect(iterator.next()).resolves.toMatchObject({
      value: { json: { type: "tool.started" } },
    });
    await expect(iterator.next()).resolves.toMatchObject({
      value: { json: { type: "approval.request" } },
    });

    await client.decideTurn(session.id, started.turn_id, "approve");
    bridge.handleAgentEvent({
      runId: "internal-openclaw-run-1",
      sessionKey: bridge.runs.get(started.turn_id)?.sessionKey,
      stream: "approval",
      data: { phase: "resolved", status: "approved" },
    });
    bridge.handleAgentEvent({
      runId: "internal-openclaw-run-1",
      sessionKey: bridge.runs.get(started.turn_id)?.sessionKey,
      stream: "lifecycle",
      data: { phase: "end" },
    });
    await expect(iterator.next()).resolves.toMatchObject({
      value: { json: { type: "approval.resolved" } },
    });
    await expect(iterator.next()).resolves.toMatchObject({
      value: { json: { type: "turn.completed" } },
    });
    await expect(iterator.next()).resolves.toEqual({ done: true });

    expect(runRequests).toEqual([
      expect.objectContaining({
        message: "/model openai/gpt-5",
        deliver: false,
        sessionKey: expect.stringMatching(/^agent:main:or3:/),
        attachments: [
          {
            fileName: "example.png",
            mimeType: "image/png",
            content: "AQID",
          },
        ],
      }),
    ]);
    expect(gatewayRequests).toContainEqual({
      method: "exec.approval.resolve",
      params: { id: "approval-1", decision: "allow-once" },
    });

    const choiceRun = await client.startTurn(session.id, {
      user_message: "/verbose",
    });
    bridge.handleAgentEvent({
      runId: "internal-openclaw-choice-run",
      sessionKey: bridge.runs.get(choiceRun.turn_id)?.sessionKey,
      stream: "lifecycle",
      data: { phase: "end" },
    });
    const choiceEvents = [];
    for await (const event of client.streamTurn(
      session.id,
      choiceRun.turn_id,
    )) {
      choiceEvents.push(event.json);
    }
    expect(choiceEvents).toEqual([
      expect.objectContaining({
        type: "command.choices",
        payload: {
          rawType: "command.choices",
          choices: [
            { label: "On", command: "/verbose on" },
            { label: "Off", command: "/verbose off" },
          ],
        },
      }),
      expect.objectContaining({ type: "turn.completed" }),
    ]);

    const second = await client.startTurn(session.id, {
      user_message: "Stop this",
    });
    await client.abortTurn(session.id, second.turn_id);
    expect(gatewayRequests).toContainEqual({
      method: "chat.abort",
      params: expect.objectContaining({ runId: "openclaw-run-3" }),
    });
  });
});
