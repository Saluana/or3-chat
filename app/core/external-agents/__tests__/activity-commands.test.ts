import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetPaletteRegistryForTests,
  getPaletteCommand,
} from "~/core/search/command-palette/registry";
import { createExternalAgentActivitySource } from "../activity-adapter";
import {
  EXTERNAL_AGENT_COMMAND_IDS,
  registerExternalAgentCommands,
} from "../commands";
import type { ExternalAgentController } from "../controller";
import type {
  ExternalAgentSession,
  ExternalAgentStoreEvent,
  ExternalAgentStoreSnapshot,
} from "../types";

const session: ExternalAgentSession = {
  hostId: "host-1",
  hostGeneration: 1,
  remoteSessionId: "session-1",
  appSessionKey: "app-session-1",
  runnerId: "codex",
  title: "Fix the tests",
  status: "waiting_approval",
  createdAt: "2026-07-27T00:00:00.000Z",
  updatedAt: "2026-07-27T00:01:00.000Z",
  activeTurnId: "turn-1",
  streamState: "connected",
  turns: [],
  events: [
    {
      id: "host-1:session-1:1",
      hostId: "host-1",
      hostGeneration: 1,
      sessionId: "session-1",
      turnId: "turn-1",
      sequence: 1,
      occurredAt: "2026-07-27T00:00:30.000Z",
      type: "message",
      text: "Working",
      payload: {},
    },
  ],
  approvals: [
    {
      id: "approval-1",
      turnId: "turn-1",
      title: "Allow write",
      status: "pending",
    },
  ],
  artifacts: [
    {
      id: "diff-1",
      turnId: "turn-1",
      kind: "diff",
      label: "Changes",
      content: "+ fixed",
    },
  ],
};

function snapshot(
  overrides: Partial<ExternalAgentStoreSnapshot> = {},
): ExternalAgentStoreSnapshot {
  return {
    hosts: [
      {
        id: "host-1",
        name: "Host",
        baseUrl: "https://host.test",
        credentialRef: "credential",
        trustedAt: "2026-07-27T00:00:00.000Z",
      },
    ],
    activeHostId: "host-1",
    connectionState: "online",
    connectionError: null,
    generation: 1,
    health: { status: "ok", runtimeAvailable: true },
    readiness: { status: "ready", ready: true },
    capabilities: { hostId: "host-1", execAvailable: true },
    runners: [],
    sessions: [session],
    ...overrides,
  };
}

function fakeController(state = snapshot()) {
  const listeners = new Set<(event: ExternalAgentStoreEvent) => void>();
  return {
    snapshot: state,
    getSession: vi.fn((id: string) =>
      id === session.remoteSessionId ? session : undefined,
    ),
    availableRunnerOptions: vi.fn(() => [
      { available: true, runner: { id: "codex" } },
    ]),
    reconnect: vi.fn(async () => true),
    cancel: vi.fn(async () => {}),
    decideApproval: vi.fn(async () => {}),
    canCancel: vi.fn(() => true),
    canDecideApproval: vi.fn(() => true),
    subscribe: vi.fn((listener: (event: ExternalAgentStoreEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    emit(event: ExternalAgentStoreEvent) {
      listeners.forEach((listener) => listener(event));
    },
  } as unknown as ExternalAgentController & {
    emit(event: ExternalAgentStoreEvent): void;
  };
}

afterEach(() => {
  __resetPaletteRegistryForTests();
});

describe("external agent Activity source", () => {
  it("normalizes detail, supported actions and opens the canonical pane", async () => {
    const controller = fakeController();
    const openSession = vi.fn();
    const source = createExternalAgentActivitySource({
      controller,
      openSession,
    });

    const list = await source.listRuns({});
    expect(list).toMatchObject({
      ok: true,
      value: [
        {
          id: "session-1",
          kind: "external-agent",
          status: "waiting_approval",
          actions: ["approve", "deny", "cancel", "open-source"],
        },
      ],
    });
    const detail = await source.getRun?.("session-1");
    expect(detail).toMatchObject({
      ok: true,
      value: {
        events: [{ type: "message" }],
        approvals: [{ id: "approval-1", status: "pending" }],
        artifacts: [{ id: "diff-1", kind: "diff" }],
      },
    });

    await expect(
      source.executeAction?.({
        runId: "session-1",
        action: "open-source",
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(openSession).toHaveBeenCalledWith(session);
  });

  it("forwards generation-checked timeline events to Activity subscribers", () => {
    const controller = fakeController();
    const source = createExternalAgentActivitySource({
      controller,
      openSession: vi.fn(),
    });
    const onEvent = vi.fn();
    source.subscribe?.({ runId: "session-1", onEvent });
    controller.emit({
      type: "timeline",
      session,
      event: session.events[0]!,
    });

    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: "external-agents",
        runId: "session-1",
        type: "message",
      }),
    );
  });

  it("returns capability-unavailable without dispatching a gated action", async () => {
    const controller = fakeController();
    vi.mocked(controller.canCancel).mockReturnValue(false);
    const source = createExternalAgentActivitySource({
      controller,
      openSession: vi.fn(),
    });

    await expect(
      source.executeAction?.({
        runId: "session-1",
        action: "cancel",
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "capability_unavailable" },
    });
    expect(controller.cancel).not.toHaveBeenCalled();
  });
});

describe("external agent palette commands", () => {
  it("registers all four commands and gates the launcher by host capability", async () => {
    const disconnected = fakeController(
      snapshot({
        connectionState: "disconnected",
        sessions: [],
      }),
    );
    const openLauncher = vi.fn();
    const handles = registerExternalAgentCommands({
      controller: disconnected,
      openLauncher,
      openSession: vi.fn(),
    });

    expect(handles).toHaveLength(4);
    await expect(
      getPaletteCommand(EXTERNAL_AGENT_COMMAND_IDS.newSession)?.handler(),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "disabled" },
    });
    expect(openLauncher).not.toHaveBeenCalled();
  });

  it("opens running/approval sessions and reconnects through the controller", async () => {
    const controller = fakeController();
    const openSession = vi.fn();
    registerExternalAgentCommands({
      controller,
      openLauncher: vi.fn(),
      openSession,
    });

    await getPaletteCommand(EXTERNAL_AGENT_COMMAND_IDS.approvals)?.handler();
    expect(openSession).toHaveBeenLastCalledWith(session);

    session.status = "running";
    await getPaletteCommand(EXTERNAL_AGENT_COMMAND_IDS.running)?.handler();
    expect(openSession).toHaveBeenLastCalledWith(session);

    await expect(
      getPaletteCommand(EXTERNAL_AGENT_COMMAND_IDS.reconnect)?.handler(),
    ).resolves.toMatchObject({ ok: true });
    expect(controller.reconnect).toHaveBeenCalledOnce();
  });
});
