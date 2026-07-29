import { describe, expect, it, vi } from "vitest";
import { ExternalAgentController } from "../controller";
import { projectExternalAgentConversation } from "../presentation";
import type {
  ExternalAgentClient,
  ExternalAgentCredentialVault,
  ExternalAgentHost,
  ExternalAgentPinCredentialVault,
  ExternalAgentPersistence,
  ExternalAgentPersistenceSnapshot,
  ExternalAgentUploadAttachment,
  ExternalRemoteEvent,
  ExternalRemoteStreamEvent,
} from "../types";

const remoteSession = {
  id: "session-1",
  app_session_key: "app-1",
  runner_id: "codex",
  continuation_mode: "replay",
  created_at: 1_730_000_000_000,
  updated_at: 1_730_000_000_100,
};
const remoteTurn = {
  id: "turn-1",
  session_id: "session-1",
  sequence: 1,
  status: "running",
  continuation_mode: "replay",
  requested_at: 1_730_000_000_200,
};
const textEvent: ExternalRemoteEvent = {
  id: 10,
  turn_id: "turn-1",
  seq: 1,
  ts: 1_730_000_000_300,
  type: "text_delta",
  text: "hello",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function persistence(
  initial: ExternalAgentPersistenceSnapshot = {
    hosts: [],
    activeHostId: null,
    sessionRefs: [],
  },
) {
  const states = new Map<string, ExternalAgentPersistenceSnapshot>([
    ["workspace-a", structuredClone(initial)],
  ]);
  const empty = (): ExternalAgentPersistenceSnapshot => ({
    hosts: [],
    activeHostId: null,
    sessionRefs: [],
  });
  const adapter: ExternalAgentPersistence = {
    bind(workspaceId) {
      return {
        workspaceId,
        async load() {
          return structuredClone(states.get(workspaceId) ?? empty());
        },
        async save(next) {
          states.set(workspaceId, structuredClone(next));
        },
      };
    },
  };
  return {
    adapter,
    get state() {
      return states.get("workspace-a") ?? empty();
    },
    stateFor(workspaceId: string) {
      return states.get(workspaceId) ?? empty();
    },
    setState(workspaceId: string, next: ExternalAgentPersistenceSnapshot) {
      states.set(workspaceId, structuredClone(next));
    },
  };
}

function vault(
  initial: Record<string, string> = {},
): ExternalAgentCredentialVault {
  const values = new Map(Object.entries(initial));
  return {
    async put(reference, secret) {
      values.set(reference, secret);
    },
    async resolve(reference) {
      return values.get(reference) ?? null;
    },
    async remove(reference) {
      values.delete(reference);
    },
  };
}

function pinVault(): ExternalAgentPinCredentialVault {
  const base = vault();
  return {
    ...base,
    supportsPinPersistence: true,
    getStatus: () => ({
      supported: true,
      configured: false,
      locked: false,
      persistedCredentialCount: 0,
    }),
    hasPersistent: () => false,
    putPersistent: vi.fn(async (reference, secret) => {
      await base.put(reference, secret);
    }),
    unlock: vi.fn(async () => {}),
    lock: vi.fn(),
  };
}

function fakeClient(
  input: {
    events?: ExternalRemoteEvent[];
    stream?: ExternalRemoteStreamEvent[];
    streamNeverEnds?: boolean;
    startError?: Error;
    abortError?: Error;
    decideError?: Error;
  } = {},
): ExternalAgentClient {
  return {
    health: vi.fn(async () => ({
      status: "ok",
      runtimeAvailable: true,
    })),
    readiness: vi.fn(async () => ({ status: "ready", ready: true })),
    capabilities: vi.fn(async () => ({
      hostId: "host-1",
      execAvailable: true,
      approvalBroker: { enabled: true, available: true },
    })),
    listRunners: vi.fn(async () => ({
      runners: [
        {
          id: "codex",
          display_name: "Codex",
          status: "available",
          auth_status: "ready",
          supports: {
            chat: {
              chatSelectable: true,
              chatReplay: true,
              cancel: true,
              approvalDecisions: true,
              customCwd: false,
            },
          },
        },
      ],
    })),
    createSession: vi.fn(async () => remoteSession),
    listSessions: vi.fn(async () => ({ sessions: [] })),
    getSession: vi.fn(async () => remoteSession),
    listTurns: vi.fn(async () => ({ turns: [remoteTurn] })),
    startTurn: vi.fn(async () => {
      if (input.startError) throw input.startError;
      return {
        session_id: "session-1",
        turn_id: "turn-1",
        status: "running",
      };
    }),
    stageFiles: vi.fn(
      async (attachments: readonly ExternalAgentUploadAttachment[]) =>
        attachments.map((attachment) => ({
          id: `workspace:.or3-upload/${attachment.name}`,
          source: "workspace_ref" as const,
          kind: attachment.kind,
          name: attachment.name,
          mime_type: attachment.mimeType,
          size_bytes: attachment.sizeBytes,
          root_id: "workspace",
          path: `.or3-upload/${attachment.name}`,
        })),
    ),
    getTurn: vi.fn(async () => remoteTurn),
    listTurnEvents: vi.fn(async () => ({
      events: input.events ?? [],
    })),
    async *streamTurn(_sessionId, _turnId, options) {
      for (const event of input.stream ?? []) yield event;
      if (input.streamNeverEnds) {
        await new Promise<void>((resolve) => {
          if (options?.signal?.aborted) {
            resolve();
            return;
          }
          options?.signal?.addEventListener("abort", () => resolve(), {
            once: true,
          });
        });
      }
    },
    abortTurn: vi.fn(async () => {
      if (input.abortError) throw input.abortError;
      return { status: "aborting" };
    }),
    decideTurn: vi.fn(async () => {
      if (input.decideError) throw input.decideError;
      return { status: "ok" };
    }),
    readArtifact: vi.fn(async (artifactId) => ({
      id: artifactId,
      mime: "text/plain",
      size_bytes: 7,
      offset: 0,
      read_bytes: 7,
      truncated: false,
      content: "content",
    })),
  };
}

const host: ExternalAgentHost = {
  id: "host-1",
  name: "Trusted host",
  baseUrl: "https://host.test",
  credentialRef: "cred-1",
  trustedAt: "2026-07-27T00:00:00.000Z",
};

describe("ExternalAgentController", () => {
  it("enrolls a pre-authorized host while persisting only metadata and an opaque credential ref", async () => {
    const saved = persistence();
    const secrets = vault();
    const client = fakeClient();
    const controller = new ExternalAgentController({
      persistence: saved.adapter,
      credentials: secrets,
      createClient: () => client,
      getWorkspaceScope: () => "workspace-a",
    });
    await controller.initialize();

    await controller.addTrustedHost({
      name: "Laptop",
      baseUrl: "https://host.test",
      token: "or3-super-secret-token",
    });

    const serialized = JSON.stringify(saved.state);
    expect(serialized).not.toContain("or3-super-secret-token");
    expect(saved.state.hosts[0]?.credentialRef).toMatch(/^intern-credential-/);
    expect(controller.snapshot.connectionState).toBe("online");
    expect(client.readiness).not.toHaveBeenCalled();
  });

  it("uses PIN-protected persistence only when explicitly requested", async () => {
    const saved = persistence();
    const secrets = pinVault();
    const controller = new ExternalAgentController({
      persistence: saved.adapter,
      credentials: secrets,
      createClient: () => fakeClient(),
      getWorkspaceScope: () => "workspace-a",
    });
    await controller.initialize();

    await controller.addTrustedHost({
      name: "Laptop",
      baseUrl: "https://host.test",
      token: "remember-me",
      persistencePin: "482915",
    });

    expect(secrets.putPersistent).toHaveBeenCalledWith(
      expect.stringMatching(/^intern-credential-/),
      "remember-me",
      "482915",
    );
    expect(JSON.stringify(saved.state)).not.toContain("remember-me");
  });

  it("does not save a pre-authorized host when verification fails", async () => {
    const saved = persistence();
    const secrets = vault();
    const remove = vi.spyOn(secrets, "remove");
    const client = fakeClient();
    client.health = vi.fn(async () => {
      throw new Error("host rejected credential");
    });
    const controller = new ExternalAgentController({
      persistence: saved.adapter,
      credentials: secrets,
      createClient: () => client,
      getWorkspaceScope: () => "workspace-a",
    });
    await controller.initialize();

    await expect(
      controller.addTrustedHost({
        name: "Rejected host",
        baseUrl: "https://host.test",
        token: "pre-issued-token",
      }),
    ).rejects.toThrow("reconnect its provider account");

    expect(saved.state.hosts).toEqual([]);
    expect(remove).toHaveBeenCalledOnce();
  });

  it("allows HTTP only for literal loopback hosts", async () => {
    const controller = new ExternalAgentController({
      persistence: persistence().adapter,
      credentials: vault(),
      createClient: () => fakeClient(),
      getWorkspaceScope: () => "workspace-a",
    });
    await controller.initialize();

    for (const baseUrl of [
      "http://localhost:4310",
      "http://127.0.0.1:4310",
      "http://127.20.30.40:4310",
      "http://[::1]:4310",
      "https://host.example",
    ]) {
      await expect(
        controller.addTrustedHost({
          name: "Verified host",
          baseUrl,
          token: "pre-issued-token",
        }),
      ).resolves.toBeDefined();
    }

    for (const baseUrl of [
      "http://host.example",
      "http://192.168.1.5:4310",
      "http://localhost.example.com:4310",
      "http://api.localhost:4310",
    ]) {
      await expect(
        controller.addTrustedHost({
          name: "Untrusted transport",
          baseUrl,
          token: "pre-issued-token",
        }),
      ).rejects.toThrow("must use HTTPS");
    }
  });

  it("keeps only the newest workspace when A to B to C loads resolve out of order", async () => {
    const loads = new Map<
      string,
      ReturnType<typeof deferred<ExternalAgentPersistenceSnapshot>>
    >();
    const saves: string[] = [];
    const persistenceAdapter: ExternalAgentPersistence = {
      bind(workspaceId) {
        const pending =
          loads.get(workspaceId) ??
          deferred<ExternalAgentPersistenceSnapshot>();
        loads.set(workspaceId, pending);
        return {
          workspaceId,
          load: () => pending.promise,
          async save() {
            saves.push(workspaceId);
          },
        };
      },
    };
    const hosts = ["a", "b", "c"].map(
      (suffix): ExternalAgentHost => ({
        ...host,
        id: `host-${suffix}`,
        credentialRef: `cred-${suffix}`,
      }),
    );
    const connected: string[] = [];
    const controller = new ExternalAgentController({
      persistence: persistenceAdapter,
      credentials: vault({
        "cred-a": "one",
        "cred-b": "two",
        "cred-c": "three",
      }),
      createClient: ({ host: target }) => {
        connected.push(target.id);
        const client = fakeClient();
        client.capabilities = vi.fn(async () => ({
          hostId: target.id,
          execAvailable: true,
          approvalBroker: { enabled: true, available: true },
        }));
        return client;
      },
      getWorkspaceScope: () => "workspace-c",
    });

    const loadA = controller.initialize("workspace-a");
    const loadB = controller.reloadWorkspace("workspace-b");
    const loadC = controller.reloadWorkspace("workspace-c");
    loads.get("workspace-c")!.resolve({
      hosts: [hosts[2]!],
      activeHostId: hosts[2]!.id,
      sessionRefs: [],
    });
    await loadC;
    loads.get("workspace-b")!.resolve({
      hosts: [hosts[1]!],
      activeHostId: hosts[1]!.id,
      sessionRefs: [],
    });
    loads.get("workspace-a")!.resolve({
      hosts: [hosts[0]!],
      activeHostId: hosts[0]!.id,
      sessionRefs: [],
    });
    await Promise.all([loadA, loadB]);

    expect(controller.snapshot.hosts.map((item) => item.id)).toEqual([
      "host-c",
    ]);
    expect(controller.snapshot.activeHostId).toBe("host-c");
    expect(connected).toEqual(["host-c"]);
    expect(saves.length).toBeGreaterThan(0);
    expect(new Set(saves)).toEqual(new Set(["workspace-c"]));
  });

  it("keeps the healthy host connected when another saved host has no credential", async () => {
    const unavailableHost: ExternalAgentHost = {
      ...host,
      id: "host-without-credential",
      baseUrl: "https://other-host.test",
      credentialRef: "missing-credential",
    };
    const controller = new ExternalAgentController({
      persistence: persistence({
        hosts: [host, unavailableHost],
        activeHostId: host.id,
        sessionRefs: [],
      }).adapter,
      credentials: vault({ "cred-1": "token" }),
      createClient: () => fakeClient(),
      getWorkspaceScope: () => "workspace-a",
    });
    await controller.initialize();

    await expect(controller.switchHost(unavailableHost.id)).resolves.toBe(
      false,
    );

    expect(controller.snapshot.activeHostId).toBe(host.id);
    expect(controller.snapshot.connectionState).toBe("online");
    expect(controller.snapshot.runners[0]?.id).toBe("codex");
  });

  it("unlocks and reconnects the host that owns a historical session", async () => {
    const hostB: ExternalAgentHost = {
      ...host,
      id: "host-2",
      name: "Studio Mac",
      baseUrl: "https://studio.test",
      credentialRef: "cred-2",
    };
    let locked = true;
    const unlock = vi.fn(async (pin: string) => {
      if (pin !== "482915") throw new Error("Wrong PIN");
      locked = false;
    });
    const credentials: ExternalAgentPinCredentialVault = {
      supportsPinPersistence: true,
      getStatus: () => ({
        supported: true,
        configured: true,
        locked,
        persistedCredentialCount: 1,
      }),
      hasPersistent: (reference) => reference === "cred-2",
      async put() {},
      async putPersistent() {},
      async resolve(reference) {
        if (reference === "cred-1") return "active-session-token";
        return reference === "cred-2" && !locked ? "studio-token" : null;
      },
      async remove() {},
      unlock,
      lock() {
        locked = true;
      },
    };
    const connected: string[] = [];
    const controller = new ExternalAgentController({
      persistence: persistence({
        hosts: [host, hostB],
        activeHostId: host.id,
        sessionRefs: [
          {
            hostId: hostB.id,
            remoteSessionId: remoteSession.id,
            title: "Studio conversation",
          },
        ],
      }).adapter,
      credentials,
      createClient: ({ host: target }) => {
        connected.push(target.id);
        return fakeClient();
      },
      getWorkspaceScope: () => "workspace-a",
    });
    await controller.initialize();

    expect(controller.isHostCredentialLocked(host.id)).toBe(false);
    expect(controller.isHostCredentialLocked(hostB.id, remoteSession.id)).toBe(
      true,
    );

    await expect(
      controller.unlockHostCredential(hostB.id, "482915", remoteSession.id),
    ).resolves.toBe(true);

    expect(unlock).toHaveBeenCalledWith("482915");
    expect(controller.snapshot.activeHostId).toBe(hostB.id);
    expect(connected).toEqual([host.id, hostB.id]);
  });

  it("reconnects the selected host before hydrating history after a refresh", async () => {
    const client = fakeClient();
    const controller = new ExternalAgentController({
      persistence: persistence({
        hosts: [host],
        activeHostId: host.id,
        sessionRefs: [],
      }).adapter,
      credentials: vault({ "cred-1": "token" }),
      createClient: () => client,
      getWorkspaceScope: () => "workspace-a",
    });
    await controller.initialize();
    controller.disconnect();

    await expect(
      controller.ensureSession(host.id, remoteSession.id),
    ).resolves.toMatchObject({
      hostId: host.id,
      remoteSessionId: remoteSession.id,
    });

    expect(controller.snapshot.connectionState).toBe("online");
    expect(client.getSession).toHaveBeenCalledWith(
      remoteSession.id,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("rebinds historical sessions from an older identity for the same host URL", async () => {
    const oldIdentity: ExternalAgentHost = {
      ...host,
      id: "older-host-identity",
      credentialRef: "older-missing-credential",
    };
    const saved = persistence({
      hosts: [host, oldIdentity],
      activeHostId: host.id,
      sessionRefs: [
        {
          hostId: oldIdentity.id,
          remoteSessionId: remoteSession.id,
          title: "Historical conversation",
        },
      ],
    });
    const client = fakeClient();
    const controller = new ExternalAgentController({
      persistence: saved.adapter,
      credentials: vault({ "cred-1": "token" }),
      createClient: () => client,
      getWorkspaceScope: () => "workspace-a",
    });

    await controller.initialize();

    expect(controller.snapshot.connectionState).toBe("online");
    expect(controller.snapshot.sessionRefs).toContainEqual(
      expect.objectContaining({
        hostId: host.id,
        remoteSessionId: remoteSession.id,
      }),
    );
    expect(controller.snapshot.sessionRefs).not.toContainEqual(
      expect.objectContaining({ hostId: oldIdentity.id }),
    );
    await expect(
      controller.ensureSession(oldIdentity.id, remoteSession.id),
    ).resolves.toMatchObject({
      hostId: host.id,
      remoteSessionId: remoteSession.id,
    });
    expect(controller.snapshot.activeHostId).toBe(host.id);
  });

  it("rejects a late add-host completion without writing into the new workspace", async () => {
    const saved = persistence();
    const health = deferred<{
      status: string;
      runtimeAvailable: boolean;
    }>();
    const client = fakeClient();
    client.health = vi.fn(() => health.promise);
    const controller = new ExternalAgentController({
      persistence: saved.adapter,
      credentials: vault(),
      createClient: () => client,
      getWorkspaceScope: () => "workspace-a",
    });
    await controller.initialize("workspace-a");

    const adding = controller.addTrustedHost({
      name: "Late A host",
      baseUrl: "https://host-a.example",
      token: "pre-issued-token",
    });
    await vi.waitFor(() => expect(client.health).toHaveBeenCalledOnce());
    await controller.reloadWorkspace("workspace-c");
    health.resolve({ status: "ok", runtimeAvailable: true });

    await expect(adding).rejects.toThrow("stale workspace");
    expect(controller.snapshot.hosts).toEqual([]);
    expect(saved.stateFor("workspace-c").hosts).toEqual([]);
  });

  it("rehydrates canonical session state without persisted history and dedupes replay", async () => {
    const saved = persistence({
      hosts: [host],
      activeHostId: host.id,
      sessionRefs: [
        {
          hostId: host.id,
          remoteSessionId: remoteSession.id,
          title: "Rehydrate me",
        },
      ],
    });
    const client = fakeClient({
      events: [textEvent, textEvent],
      stream: [
        { event: "text_delta", data: "", json: textEvent },
        { event: "done", data: "", json: { status: "running" } },
      ],
    });
    const controller = new ExternalAgentController({
      persistence: saved.adapter,
      credentials: vault({ "cred-1": "token" }),
      createClient: () => client,
      getWorkspaceScope: () => "workspace-a",
    });

    await controller.initialize();
    await vi.waitFor(() => {
      expect(controller.getSession("session-1")?.events).toHaveLength(1);
    });

    expect(saved.state.sessionRefs[0]).not.toHaveProperty("events");
    expect(controller.getSession("session-1")).toMatchObject({
      title: "Rehydrate me",
      hostGeneration: 1,
      status: "running",
    });
  });

  it("keeps completed item events as tool lifecycle updates", async () => {
    const toolEvents: ExternalRemoteEvent[] = [
      {
        id: 29,
        turn_id: "turn-1",
        seq: 0,
        type: "runner_output",
        payload: { type: "message.part.updated" },
      },
      {
        id: 30,
        turn_id: "turn-1",
        seq: 1,
        type: "item.started",
        payload: {
          type: "item.started",
          item_type: "command_execution",
          status: "inProgress",
          title: "Run tests",
          data: { id: "call-1", command: "bun run test" },
        },
      },
      {
        id: 31,
        turn_id: "turn-1",
        seq: 2,
        type: "item.completed",
        payload: {
          type: "item.completed",
          item_type: "command_execution",
          status: "completed",
          title: "Run tests",
          data: { id: "call-1", command: "bun run test" },
        },
      },
    ];
    const controller = new ExternalAgentController({
      persistence: persistence({
        hosts: [host],
        activeHostId: host.id,
        sessionRefs: [],
      }).adapter,
      credentials: vault({ "cred-1": "token" }),
      createClient: () => fakeClient({ events: toolEvents }),
      getWorkspaceScope: () => "workspace-a",
    });
    await controller.initialize();

    const launched = await controller.launch({
      runnerId: "codex",
      instruction: "Run the tests",
      mode: "review",
      isolation: "host_readonly",
    });

    expect(launched.events.map((candidate) => candidate.type)).toEqual([
      "metric",
      "tool",
      "tool",
    ]);
    expect(launched.events[1]?.payload.operation_id).toBe("call-1");
    expect(launched.events[2]?.payload.status).toBe("completed");
  });

  it("retains each turn's tool history when later turns have overlapping event sequences", async () => {
    const saved = persistence({
      hosts: [host],
      activeHostId: host.id,
      sessionRefs: [
        {
          hostId: host.id,
          remoteSessionId: remoteSession.id,
          title: "Multi-turn conversation",
        },
      ],
    });
    const turns = Array.from({ length: 3 }, (_, index) => ({
      ...remoteTurn,
      id: `turn-${index + 1}`,
      sequence: index + 1,
      status: "succeeded",
      user_message: `Question ${index + 1}`,
      final_text: `Answer ${index + 1}`,
      completed_at: 1_730_000_001_000 + index,
    }));
    const eventsByTurn = new Map(
      turns.map((turn, turnIndex) => [
        turn.id,
        Array.from(
          { length: 250 },
          (_, index): ExternalRemoteEvent => ({
            id: turnIndex * 1_000 + index + 1,
            turn_id: turn.id,
            seq: index + 1,
            ts: 1_730_000_000_300 + index,
            type:
              turn.id === "turn-3" && index === 39
                ? "item.completed"
                : "text_delta",
            text:
              turn.id === "turn-3" && index === 39
                ? undefined
                : `token-${index}`,
            payload:
              turn.id === "turn-3" && index === 39
                ? {
                    data: {
                      id: "read-readme",
                      name: "read",
                      path: "README.md",
                    },
                    status: "completed",
                  }
                : undefined,
          }),
        ),
      ]),
    );
    const client = fakeClient();
    client.listTurns = vi.fn(async () => ({ turns }));
    client.listTurnEvents = vi.fn(async (_sessionId, turnId, input = {}) => ({
      events: (eventsByTurn.get(turnId) ?? [])
        .filter((event) => event.seq > (input.afterSeq ?? 0))
        .slice(0, input.limit),
    }));
    const controller = new ExternalAgentController({
      persistence: saved.adapter,
      credentials: vault({ "cred-1": "token" }),
      createClient: () => client,
      getWorkspaceScope: () => "workspace-a",
    });

    await controller.initialize();

    const rehydrated = controller.getSession(remoteSession.id, host.id);
    expect(
      rehydrated?.events.some(
        (event) =>
          event.turnId === "turn-3" &&
          event.type === "tool" &&
          event.payload.operation_id === "read-readme",
      ),
    ).toBe(true);
    expect(new Set(rehydrated?.events.map((event) => event.turnId))).toEqual(
      new Set(["turn-1", "turn-2", "turn-3"]),
    );
    expect(
      rehydrated
        ? projectExternalAgentConversation(rehydrated).turns[2]
            ?.assistantMessage?.toolCalls
        : [],
    ).toEqual([
      expect.objectContaining({
        id: "read-readme",
        status: "complete",
      }),
    ]);
  });

  it("paginates long canonical turns so late tool calls survive reload", async () => {
    const saved = persistence({
      hosts: [host],
      activeHostId: host.id,
      sessionRefs: [
        {
          hostId: host.id,
          remoteSessionId: remoteSession.id,
          title: "Long conversation",
        },
      ],
    });
    const events = Array.from(
      { length: 650 },
      (_, index): ExternalRemoteEvent => ({
        id: index + 1,
        turn_id: remoteTurn.id,
        seq: index + 1,
        type: index === 619 ? "item.completed" : "text_delta",
        text: index === 619 ? undefined : "x",
        payload:
          index === 619
            ? {
                data: { id: "late-tool", name: "read", path: "README.md" },
                status: "completed",
              }
            : undefined,
      }),
    );
    const client = fakeClient();
    client.listTurnEvents = vi.fn(async (_sessionId, _turnId, input = {}) => ({
      events: events
        .filter((event) => event.seq > (input.afterSeq ?? 0))
        .slice(0, input.limit),
    }));
    const controller = new ExternalAgentController({
      persistence: saved.adapter,
      credentials: vault({ "cred-1": "token" }),
      createClient: () => client,
      getWorkspaceScope: () => "workspace-a",
    });

    await controller.initialize();

    expect(client.listTurnEvents).toHaveBeenCalledWith(
      remoteSession.id,
      remoteTurn.id,
      expect.objectContaining({ afterSeq: 500, limit: 500 }),
    );
    expect(
      controller
        .getSession(remoteSession.id, host.id)
        ?.events.some((event) => event.payload.operation_id === "late-tool"),
    ).toBe(true);
  });

  it("applies model and safety overrides to follow-up turns without changing runners", async () => {
    const client = fakeClient();
    const controller = new ExternalAgentController({
      persistence: persistence({
        hosts: [host],
        activeHostId: host.id,
        sessionRefs: [],
      }).adapter,
      credentials: vault({ "cred-1": "token" }),
      createClient: () => client,
      getWorkspaceScope: () => "workspace-a",
    });
    await controller.initialize();

    const launched = await controller.launch({
      runnerId: "codex",
      instruction: "Review the change",
      mode: "review",
      isolation: "host_readonly",
    });
    launched.status = "succeeded";
    launched.activeTurnId = undefined;

    await controller.followUp(launched.remoteSessionId, {
      instruction: "Now use the stronger model",
      mode: "safe_edit",
      isolation: "host_workspace_write",
      model: "gpt-5.6-sol",
      confirmDangerous: false,
    });

    expect(client.startTurn).toHaveBeenLastCalledWith(
      launched.remoteSessionId,
      {
        user_message: "Now use the stronger model",
        continuation_mode: "replay",
        model: "gpt-5.6-sol",
        mode: "safe_edit",
        isolation: "host_workspace_write",
        cwd: undefined,
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(launched).toMatchObject({
      runnerId: "codex",
      model: "gpt-5.6-sol",
      mode: "safe_edit",
      isolation: "host_workspace_write",
    });
  });

  it("stages local files on the trusted host and sends workspace references with a turn", async () => {
    const client = fakeClient();
    const controller = new ExternalAgentController({
      persistence: persistence({
        hosts: [host],
        activeHostId: host.id,
        sessionRefs: [],
      }).adapter,
      credentials: vault({ "cred-1": "token" }),
      createClient: () => client,
      getWorkspaceScope: () => "workspace-a",
    });
    await controller.initialize();
    const file = new Blob(["export const answer = 42;"], {
      type: "text/typescript",
    });

    await controller.launch({
      runnerId: "codex",
      instruction: "Review the attached module",
      mode: "review",
      isolation: "host_readonly",
      attachments: [
        {
          id: "attachment-1",
          kind: "text",
          name: "answer.ts",
          mimeType: "text/typescript",
          sizeBytes: file.size,
          data: file,
        },
      ],
    });

    expect(client.stageFiles).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          name: "answer.ts",
          data: file,
        }),
      ],
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(client.startTurn).toHaveBeenCalledWith(
      remoteSession.id,
      expect.objectContaining({
        user_message: "Review the attached module",
        attachments: [
          expect.objectContaining({
            source: "workspace_ref",
            root_id: "workspace",
            path: ".or3-upload/answer.ts",
          }),
        ],
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("treats a streamed runtime error as terminal even when the wrapper reports success", async () => {
    const runtimeError: ExternalRemoteEvent = {
      id: 20,
      turn_id: "turn-1",
      seq: 20,
      ts: 1_730_000_000_400,
      type: "runtime.error",
      text: "The selected model is not supported for this account.",
      payload: {
        status: "failed",
        message: "The selected model is not supported for this account.",
      },
    };
    const client = fakeClient({
      stream: [{ event: "runtime.error", json: runtimeError }],
    });
    const saved = persistence({
      hosts: [host],
      activeHostId: host.id,
      sessionRefs: [],
    });
    const controller = new ExternalAgentController({
      persistence: saved.adapter,
      credentials: vault({ "cred-1": "token" }),
      createClient: () => client,
      getWorkspaceScope: () => "workspace-a",
    });
    await controller.initialize();

    const session = await controller.launch({
      runnerId: "codex",
      instruction: "Use an unavailable model",
      mode: "review",
      isolation: "host_readonly",
    });

    await vi.waitFor(() => {
      expect(session.status).toBe("failed");
      expect(session.streamState).toBe("idle");
    });
    expect(session.turns[0]).toMatchObject({
      status: "failed",
      error: "The selected model is unavailable for this agent.",
    });
    expect(session.error).toBe(
      "The selected model is unavailable for this agent.",
    );
    expect(saved.state.sessionRefs[0]?.status).toBe("failed");
  });

  it("does not treat a failed provider dependency as a failed agent turn", async () => {
    const dependencyFailure: ExternalRemoteEvent = {
      id: 20,
      turn_id: "turn-1",
      seq: 20,
      ts: 1_730_000_000_400,
      type: "runner_output",
      payload: {
        type: "mcpServer/startupStatus/updated",
        name: "optional-tool",
        status: "failed",
        error: "This optional tool is not logged in.",
      },
    };
    const completion: ExternalRemoteEvent = {
      id: 21,
      turn_id: "turn-1",
      seq: 21,
      ts: 1_730_000_000_500,
      type: "completion",
      payload: { status: "succeeded" },
    };
    const client = fakeClient({
      stream: [
        { event: "runner_output", json: dependencyFailure },
        { event: "completion", json: completion },
      ],
    });
    const saved = persistence({
      hosts: [host],
      activeHostId: host.id,
      sessionRefs: [],
    });
    const controller = new ExternalAgentController({
      persistence: saved.adapter,
      credentials: vault({ "cred-1": "token" }),
      createClient: () => client,
      getWorkspaceScope: () => "workspace-a",
    });
    await controller.initialize();

    const session = await controller.launch({
      runnerId: "codex",
      instruction: "Continue without an optional tool",
      mode: "review",
      isolation: "host_readonly",
    });

    await vi.waitFor(() => {
      expect(session.status).toBe("succeeded");
      expect(session.streamState).toBe("idle");
    });
    expect(session.error).toBeUndefined();
  });

  it("keeps reconciling when the provider stream closes before the turn", async () => {
    const terminalTurn = {
      ...remoteTurn,
      status: "failed",
      completed_at: 1_730_000_000_500,
      error: "selected model not supported",
    };
    const client = fakeClient();
    let reads = 0;
    client.getTurn = vi.fn(async () => {
      reads += 1;
      return reads <= 2 ? remoteTurn : terminalTurn;
    });
    const controller = new ExternalAgentController({
      persistence: persistence({
        hosts: [host],
        activeHostId: host.id,
        sessionRefs: [],
      }).adapter,
      credentials: vault({ "cred-1": "token" }),
      createClient: () => client,
      getWorkspaceScope: () => "workspace-a",
    });
    await controller.initialize();

    const session = await controller.launch({
      runnerId: "codex",
      instruction: "Wait for canonical completion",
      mode: "review",
      isolation: "host_readonly",
    });

    await vi.waitFor(
      () => {
        expect(session.status).toBe("failed");
        expect(session.streamState).toBe("idle");
      },
      { timeout: 3_000 },
    );
  });

  it("persists a failed session when its first turn cannot start", async () => {
    const saved = persistence({
      hosts: [host],
      activeHostId: host.id,
      sessionRefs: [],
    });
    const client = fakeClient({
      startError: new Error("selected model unsupported"),
    });
    const controller = new ExternalAgentController({
      persistence: saved.adapter,
      credentials: vault({ "cred-1": "token" }),
      createClient: () => client,
      getWorkspaceScope: () => "workspace-a",
    });
    await controller.initialize();

    await expect(
      controller.launch({
        runnerId: "codex",
        instruction: "Start a failing turn",
        mode: "review",
        isolation: "host_readonly",
      }),
    ).rejects.toThrow("unsupported");

    expect(controller.getSession("session-1")).toMatchObject({
      status: "failed",
      error: "The selected model is unavailable for this agent.",
    });
    expect(saved.state.sessionRefs[0]?.status).toBe("failed");
  });

  it("discovers workspace-scoped canonical sessions that have no local ref", async () => {
    const saved = persistence({
      hosts: [host],
      activeHostId: host.id,
      sessionRefs: [],
    });
    const discovered = {
      ...remoteSession,
      id: "session-discovered",
      app_session_key: "or3-chat:workspace-a:session-from-another-client",
    };
    const client = fakeClient();
    client.listSessions = vi.fn(async () => ({
      sessions: [
        discovered,
        {
          ...remoteSession,
          id: "session-foreign",
          app_session_key: "or3-chat:workspace-b:session-foreign",
        },
      ],
    }));
    client.listTurns = vi.fn(async () => ({
      turns: [
        {
          ...remoteTurn,
          session_id: discovered.id,
          user_message: "Review the sidebar history",
        },
      ],
    }));
    const controller = new ExternalAgentController({
      persistence: saved.adapter,
      credentials: vault({ "cred-1": "token" }),
      createClient: () => client,
      getWorkspaceScope: () => "workspace-a",
    });

    await controller.initialize();

    expect(client.listSessions).toHaveBeenCalledWith(
      {
        appSessionKeyPrefix: "or3-chat:workspace-a:",
        limit: 100,
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(controller.getSession("session-discovered", host.id)).toMatchObject({
      appSessionKey: "or3-chat:workspace-a:session-from-another-client",
      hostGeneration: 1,
      title: "Review the sidebar history",
    });
    expect(controller.getSession("session-foreign", host.id)).toBeUndefined();
    expect(saved.state.sessionRefs).toContainEqual(
      expect.objectContaining({
        hostId: host.id,
        remoteSessionId: "session-discovered",
        title: "Review the sidebar history",
      }),
    );
  });

  it("bounds eager discovery hydration and remote request concurrency", async () => {
    const saved = persistence({
      hosts: [host],
      activeHostId: host.id,
      sessionRefs: [],
    });
    const discovered = Array.from({ length: 25 }, (_, index) => ({
      ...remoteSession,
      id: `session-${index}`,
      app_session_key: `or3-chat:workspace-a:session-${index}`,
      updated_at: 1_730_000_000_000 + index,
    }));
    const client = fakeClient();
    client.listSessions = vi.fn(async () => ({ sessions: discovered }));
    let activeRequests = 0;
    let maxActiveRequests = 0;
    client.listTurns = vi.fn(async () => {
      activeRequests += 1;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      await Promise.resolve();
      activeRequests -= 1;
      return { turns: [] };
    });
    const controller = new ExternalAgentController({
      persistence: saved.adapter,
      credentials: vault({ "cred-1": "token" }),
      createClient: () => client,
      getWorkspaceScope: () => "workspace-a",
    });

    await controller.initialize();

    expect(client.listTurns).toHaveBeenCalledTimes(20);
    expect(maxActiveRequests).toBeLessThanOrEqual(4);
    expect(saved.state.sessionRefs).toHaveLength(25);
    expect(controller.getSession("session-24", host.id)).toBeDefined();
    expect(controller.getSession("session-0", host.id)).toBeUndefined();
  });

  it("aborts the prior host generation and rejects its late discovery response", async () => {
    let resolveHealthA!: (value: {
      status: string;
      runtimeAvailable: boolean;
    }) => void;
    const healthA = new Promise<{
      status: string;
      runtimeAvailable: boolean;
    }>((resolve) => {
      resolveHealthA = resolve;
    });
    const clientA = fakeClient();
    clientA.health = vi.fn(() => healthA);
    const clientB = fakeClient();
    const hostB: ExternalAgentHost = {
      ...host,
      id: "host-2",
      credentialRef: "cred-2",
    };
    const saved = persistence({
      hosts: [host, hostB],
      activeHostId: host.id,
      sessionRefs: [],
    });
    const controller = new ExternalAgentController({
      persistence: saved.adapter,
      credentials: vault({
        "cred-1": "one",
        "cred-2": "two",
      }),
      createClient: ({ host: target }) =>
        target.id === host.id ? clientA : clientB,
      getWorkspaceScope: () => "workspace-a",
    });

    const first = controller.initialize();
    await vi.waitFor(() =>
      expect(controller.snapshot.connectionState).toBe("connecting"),
    );
    const second = controller.switchHost(hostB.id);
    await expect(second).resolves.toBe(true);
    resolveHealthA({ status: "ok", runtimeAvailable: true });
    await expect(first).resolves.toBeUndefined();

    expect(controller.snapshot.activeHostId).toBe(hostB.id);
    expect(controller.snapshot.generation).toBe(2);
    expect(controller.snapshot.runners[0]?.id).toBe("codex");
  });

  it("preserves canonical status and approval state when remote actions fail", async () => {
    const approvalEvent: ExternalRemoteEvent = {
      id: 11,
      turn_id: "turn-1",
      seq: 2,
      type: "approval_required",
      payload: {
        approval_id: 44,
        title: "Allow workspace write",
      },
    };
    const client = fakeClient({
      events: [approvalEvent],
      abortError: new Error("abort unavailable"),
      decideError: new Error("approval unavailable"),
    });
    const controller = new ExternalAgentController({
      persistence: persistence({
        hosts: [host],
        activeHostId: host.id,
        sessionRefs: [],
      }).adapter,
      credentials: vault({ "cred-1": "token" }),
      createClient: () => client,
      getWorkspaceScope: () => "workspace-a",
    });
    await controller.initialize();
    const session = await controller.launch({
      runnerId: "codex",
      instruction: "Change a file",
      mode: "review",
      isolation: "host_readonly",
    });
    const statusBeforeCancel = session.status;

    await expect(controller.cancel(session.remoteSessionId)).rejects.toThrow(
      "abort unavailable",
    );
    expect(session.status).toBe(statusBeforeCancel);
    expect(session.actionError).toContain("Remote cancellation failed");

    const approvalBefore = structuredClone(session.approvals);
    await expect(
      controller.decideApproval(
        session.remoteSessionId,
        "approve",
        session.approvals[0]?.id,
      ),
    ).rejects.toThrow("approval unavailable");
    expect(session.approvals).toEqual(approvalBefore);
    expect(session.actionError).toContain("Remote approve failed");
  });

  it("coalesces provider approval aliases and repeated diffs into one useful item", async () => {
    const events: ExternalRemoteEvent[] = [
      {
        id: 41,
        turn_id: "turn-1",
        seq: 41,
        type: "request.opened",
        payload: {
          request_id: 0,
          request_type: "command_execution_approval",
          detail: "bun run test",
          args: {
            reason: "Run the test suite before finishing?",
          },
        },
      },
      {
        id: 42,
        turn_id: "turn-1",
        seq: 42,
        type: "approval_required",
        payload: {
          status: "approval_required",
        },
      },
      ...[43, 44, 45].map(
        (id): ExternalRemoteEvent => ({
          id,
          turn_id: "turn-1",
          seq: id,
          type: "turn.diff.updated",
          payload: {
            unified_diff: "--- a/file.ts\n+++ b/file.ts\n@@\n-old\n+new",
          },
        }),
      ),
    ];
    const controller = new ExternalAgentController({
      persistence: persistence({
        hosts: [host],
        activeHostId: host.id,
        sessionRefs: [],
      }).adapter,
      credentials: vault({ "cred-1": "token" }),
      createClient: () => fakeClient({ events }),
      getWorkspaceScope: () => "workspace-a",
    });
    await controller.initialize();

    const session = await controller.launch({
      runnerId: "codex",
      instruction: "Make a safe change",
      mode: "review",
      isolation: "host_readonly",
    });

    expect(session.status).toBe("waiting_approval");
    expect(session.streamState).toBe("idle");
    expect(session.approvals).toEqual([
      expect.objectContaining({
        id: "0",
        title: "Run this command?",
        description: "Run the test suite before finishing?",
        status: "pending",
      }),
    ]);
    expect(session.artifacts).toHaveLength(1);
    expect(session.artifacts[0]).toMatchObject({
      kind: "diff",
      label: "Proposed changes",
    });
  });

  it("does not let a stale pending approval overwrite a terminal turn", async () => {
    const approvalEvent: ExternalRemoteEvent = {
      id: 12,
      turn_id: "turn-1",
      seq: 3,
      type: "approval_required",
      payload: { approval_id: 45, title: "Stale approval" },
    };
    const terminalTurn = {
      ...remoteTurn,
      status: "completed",
      completed_at: 1_730_000_000_400,
      final_text: "Canonical result",
    };
    const client = fakeClient({ events: [approvalEvent] });
    client.getTurn = vi.fn(async () => terminalTurn);
    client.listTurns = vi.fn(async () => ({ turns: [terminalTurn] }));
    const controller = new ExternalAgentController({
      persistence: persistence({
        hosts: [host],
        activeHostId: host.id,
        sessionRefs: [],
      }).adapter,
      credentials: vault({ "cred-1": "token" }),
      createClient: () => client,
      getWorkspaceScope: () => "workspace-a",
    });
    await controller.initialize();

    const session = await controller.launch({
      runnerId: "codex",
      instruction: "Finish safely",
      mode: "review",
      isolation: "host_readonly",
    });

    expect(session.status).toBe("succeeded");
    expect(session.output).toBe("Canonical result");
    expect(session.approvals[0]?.status).toBe("pending");
    expect(controller.canCancel(session)).toBe(false);
    expect(controller.canDecideApproval(session)).toBe(false);
    expect(controller.canFollowUp(session)).toBe(true);
  });

  it("rejects an unknown approval instead of falling back to the active turn", async () => {
    const client = fakeClient();
    const controller = new ExternalAgentController({
      persistence: persistence({
        hosts: [host],
        activeHostId: host.id,
        sessionRefs: [],
      }).adapter,
      credentials: vault({ "cred-1": "token" }),
      createClient: () => client,
      getWorkspaceScope: () => "workspace-a",
    });
    await controller.initialize();
    const session = await controller.launch({
      runnerId: "codex",
      instruction: "Review",
      mode: "review",
      isolation: "host_readonly",
    });

    await expect(
      controller.decideApproval(
        session.remoteSessionId,
        "approve",
        "missing-approval",
      ),
    ).rejects.toThrow("no longer available");
    expect(client.decideTurn).not.toHaveBeenCalled();
  });

  it("reads only artifacts advertised by the canonical session", async () => {
    const artifactEvent: ExternalRemoteEvent = {
      id: 13,
      turn_id: "turn-1",
      seq: 4,
      type: "artifact_created",
      payload: {
        artifact_id: "remote-artifact-1",
        label: "Build log",
      },
    };
    const client = fakeClient({ events: [artifactEvent] });
    const controller = new ExternalAgentController({
      persistence: persistence({
        hosts: [host],
        activeHostId: host.id,
        sessionRefs: [],
      }).adapter,
      credentials: vault({ "cred-1": "token" }),
      createClient: () => client,
      getWorkspaceScope: () => "workspace-a",
    });
    await controller.initialize();
    const session = await controller.launch({
      runnerId: "codex",
      instruction: "Build",
      mode: "review",
      isolation: "host_readonly",
    });
    expect(client.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        app_session_key: expect.stringMatching(
          /^or3-chat:workspace-a:session-/,
        ),
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    const artifact = session.artifacts[0]!;

    expect(controller.canReadArtifact(session, artifact.id)).toBe(true);
    await controller.readArtifact(session.remoteSessionId, artifact.id);

    expect(client.readArtifact).toHaveBeenCalledWith(
      "remote-artifact-1",
      {
        sessionKey: "app-1",
        maxBytes: 256 * 1024,
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(session.artifacts[0]?.content).toBe("content");
    await expect(
      controller.readArtifact(session.remoteSessionId, "not-advertised"),
    ).rejects.toThrow("not available");
  });
});
