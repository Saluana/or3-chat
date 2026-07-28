import { describe, expect, it, vi } from "vitest";
import { ExternalAgentController } from "../controller";
import type {
  ExternalAgentClient,
  ExternalAgentCredentialVault,
  ExternalAgentHost,
  ExternalAgentPersistence,
  ExternalAgentPersistenceSnapshot,
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

function fakeClient(
  input: {
    events?: ExternalRemoteEvent[];
    stream?: ExternalRemoteStreamEvent[];
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
    startTurn: vi.fn(async () => ({
      session_id: "session-1",
      turn_id: "turn-1",
      status: "running",
    })),
    getTurn: vi.fn(async () => remoteTurn),
    listTurnEvents: vi.fn(async () => ({
      events: input.events ?? [],
    })),
    async *streamTurn() {
      for (const event of input.stream ?? []) yield event;
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
    });
    expect(controller.getSession("session-foreign", host.id)).toBeUndefined();
    expect(saved.state.sessionRefs).toContainEqual(
      expect.objectContaining({
        hostId: host.id,
        remoteSessionId: "session-discovered",
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
