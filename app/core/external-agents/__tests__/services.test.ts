import { afterEach, describe, expect, it, vi } from "vitest";
import { ExternalAgentConnectionSupervisor } from "../connection-supervisor";
import { ExternalAgentEventStore } from "../event-store";
import {
  ExternalAgentHostRegistry,
  normalizeExternalAgentBaseUrl,
} from "../host-registry";
import { ExternalAgentPersistenceAdapter } from "../persistence-adapter";
import { ExternalAgentSessionRepository } from "../session-repository";
import { ExternalAgentSnapshotPublisher } from "../snapshot-publisher";
import { ExternalAgentTurnCommandService } from "../turn-command-service";
import type {
  ExternalAgentClient,
  ExternalAgentHost,
  ExternalAgentPersistenceLease,
  ExternalAgentPersistenceSnapshot,
  ExternalAgentSession,
  ExternalAgentStoreEvent,
  ExternalAgentStoreSnapshot,
} from "../types";

const HOST: ExternalAgentHost = {
  id: "host-1",
  name: "Computer",
  baseUrl: "https://agent.example",
  credentialRef: "credential-1",
  trustedAt: "2026-07-29T00:00:00.000Z",
};

afterEach(() => vi.unstubAllGlobals());

function session(
  overrides: Partial<ExternalAgentSession> = {},
): ExternalAgentSession {
  return {
    hostId: HOST.id,
    hostGeneration: 1,
    remoteSessionId: "session-1",
    appSessionKey: "or3-chat:workspace:session-1",
    runnerId: "runner-1",
    title: "Task",
    status: "running",
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
    activeTurnId: "turn-1",
    streamState: "idle",
    turns: [
      {
        id: "turn-1",
        session_id: "session-1",
        sequence: 1,
        status: "running",
        continuation_mode: "replay",
        requested_at: 1,
      },
    ],
    events: [],
    approvals: [],
    artifacts: [],
    ...overrides,
  };
}

function snapshot(generation = 1): ExternalAgentStoreSnapshot {
  return {
    hosts: [HOST],
    activeHostId: HOST.id,
    connectionState: "online",
    connectionError: null,
    generation,
    health: null,
    readiness: null,
    capabilities: null,
    runners: [],
    sessions: [],
    sessionRefs: [],
  };
}

describe("ExternalAgentHostRegistry", () => {
  it("deduplicates hosts and never selects an unknown active host", () => {
    const registry = new ExternalAgentHostRegistry();
    registry.reset([HOST, { ...HOST, name: "Latest" }], "missing");

    expect(registry.hosts).toEqual([{ ...HOST, name: "Latest" }]);
    expect(registry.activeHostId).toBeNull();

    registry.setActive(HOST.id);
    expect(registry.activeHostId).toBe(HOST.id);

    registry.replace([]);
    expect(registry.activeHostId).toBeNull();
  });

  it("rejects insecure non-loopback and credential-bearing URLs", () => {
    expect(() =>
      normalizeExternalAgentBaseUrl("http://agent.example"),
    ).toThrow(/HTTPS/);
    expect(() =>
      normalizeExternalAgentBaseUrl("https://user:pass@agent.example"),
    ).toThrow(/credentials/);
    expect(normalizeExternalAgentBaseUrl("http://127.0.0.1:9090/")).toBe(
      "http://127.0.0.1:9090",
    );
  });
});

describe("ExternalAgentSessionRepository", () => {
  it("rejects stale refresh versions and replaces session refs atomically", () => {
    const repository = new ExternalAgentSessionRepository();
    const current = session();
    repository.set(current);
    const staleVersion = repository.nextRefreshVersion(current);
    const currentVersion = repository.nextRefreshVersion(current);

    expect(repository.isRefreshCurrent(current, staleVersion)).toBe(false);
    expect(repository.isRefreshCurrent(current, currentVersion)).toBe(true);

    current.approvals.push({
      id: "approval-1",
      turnId: "turn-1",
      title: "Run this command?",
      status: "pending",
    });
    repository.remember(current);
    current.title = "Updated";
    repository.remember(current);

    expect(repository.refs).toHaveLength(1);
    expect(repository.refs[0]).toMatchObject({
      title: "Updated",
      pendingApprovalCount: 1,
    });
  });
});

describe("ExternalAgentEventStore", () => {
  it("orders events, rejects duplicates, and derives approval state", () => {
    const store = new ExternalAgentEventStore();
    const current = session();
    const emitted: ExternalAgentStoreEvent[] = [];
    const ingest = (remote: Parameters<ExternalAgentEventStore["ingest"]>[0]["remote"]) =>
      store.ingest({
        session: current,
        remote,
        isCurrent: () => true,
        emit: (event) => emitted.push(event),
      });

    ingest({
      id: 2,
      turn_id: "turn-1",
      seq: 2,
      type: "message",
      text: "second",
    });
    ingest({
      id: 1,
      turn_id: "turn-1",
      seq: 1,
      type: "approval.requested",
      payload: {
        approval_id: "approval-1",
        request_type: "command",
      },
    });
    ingest({
      id: 2,
      turn_id: "turn-1",
      seq: 2,
      type: "message",
      text: "duplicate",
    });

    expect(current.events.map((event) => event.sequence)).toEqual([1, 2]);
    expect(current.approvals).toMatchObject([
      { id: "approval-1", title: "Run this command?", status: "pending" },
    ]);
    expect(current.status).toBe("waiting_approval");
    expect(emitted).toHaveLength(2);
  });
});

describe("ExternalAgentSnapshotPublisher", () => {
  it("isolates observer faults and coalesces timeline snapshots", () => {
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    let generation = 1;
    const publisher = new ExternalAgentSnapshotPublisher(() =>
      snapshot(generation),
    );
    const received: ExternalAgentStoreEvent[] = [];
    publisher.subscribe(() => {
      throw new Error("observer failed");
    });
    publisher.subscribe((event) => received.push(event));
    const current = session();
    const timeline = {
      type: "timeline",
      session: current,
      event: {
        id: "event-1",
        hostId: HOST.id,
        hostGeneration: 1,
        sessionId: current.remoteSessionId,
        turnId: "turn-1",
        sequence: 1,
        occurredAt: current.updatedAt,
        type: "message",
        payload: {},
      },
    } satisfies Exclude<ExternalAgentStoreEvent, { type: "snapshot" }>;

    generation = 2;
    publisher.publish(timeline);
    publisher.publish(timeline);
    expect(received.map((event) => event.type)).toEqual([
      "snapshot",
      "timeline",
      "timeline",
    ]);
    frame?.(0);
    expect(received.at(-1)).toMatchObject({
      type: "snapshot",
      snapshot: { generation: 2 },
    });

    publisher.dispose();
  });
});

describe("ExternalAgentPersistenceAdapter", () => {
  it("serializes saves and continues after a failed write", async () => {
    let rejectFirst!: (error: Error) => void;
    let resolveSecond!: () => void;
    const first = new Promise<void>((_, reject) => {
      rejectFirst = reject;
    });
    const second = new Promise<void>((resolve) => {
      resolveSecond = resolve;
    });
    const save = vi
      .fn<ExternalAgentPersistenceLease["save"]>()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    const lease = {
      workspaceId: "workspace",
      load: vi.fn(),
      save,
    } satisfies ExternalAgentPersistenceLease;
    const adapter = new ExternalAgentPersistenceAdapter();
    const value: ExternalAgentPersistenceSnapshot = {
      hosts: [],
      activeHostId: null,
      sessionRefs: [],
    };

    const failedSave = adapter.save(lease, value);
    const nextSave = adapter.save(lease, value);
    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(1);
    rejectFirst(new Error("disk unavailable"));
    await expect(failedSave).rejects.toThrow("disk unavailable");
    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(2);
    resolveSecond();
    await nextSave;
  });
});

describe("ExternalAgentTurnCommandService", () => {
  it("preserves transport failures and does not start after staging fails", async () => {
    const stageFiles = vi.fn().mockRejectedValue(new Error("upload failed"));
    const startTurn = vi.fn();
    const client = { stageFiles, startTurn } as unknown as ExternalAgentClient;
    const commands = new ExternalAgentTurnCommandService();

    await expect(
      commands.stageFiles(
        client,
        [
          {
            id: "upload-1",
            kind: "file",
            name: "notes.txt",
            data: new Blob(["hello"]),
          },
        ],
        new AbortController().signal,
      ),
    ).rejects.toThrow("upload failed");
    expect(startTurn).not.toHaveBeenCalled();
  });
});

describe("ExternalAgentConnectionSupervisor", () => {
  it("aborts host discovery and active streams together", async () => {
    let streamSignal: AbortSignal | undefined;
    const client = {
      async *streamTurn(
        _sessionId: string,
        _turnId: string,
        input?: { signal?: AbortSignal },
      ) {
        streamSignal = input?.signal;
        await new Promise<void>((resolve) =>
          input?.signal?.addEventListener("abort", () => resolve(), {
            once: true,
          }),
        );
      },
    } as unknown as ExternalAgentClient;
    const supervisor = new ExternalAgentConnectionSupervisor();
    const previousHostController = supervisor.beginHostRequest();
    const hostController = supervisor.beginHostRequest();
    expect(previousHostController.signal.aborted).toBe(true);
    const current = session();
    supervisor.startTurnStream({
      client,
      session: current,
      turnId: "turn-1",
      afterSeq: 0,
      isCurrent: () => true,
      refresh: vi.fn(),
      ingest: vi.fn(),
      publishSession: vi.fn(),
      persist: vi.fn(),
      isStaleError: () => false,
      presentError: () => "Disconnected",
    });
    await Promise.resolve();

    supervisor.abortAll();

    expect(hostController.signal.aborted).toBe(true);
    expect(streamSignal?.aborted).toBe(true);
  });
});
