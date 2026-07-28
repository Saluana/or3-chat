import {
  buildExternalAgentRunnerOptions,
  validateExternalAgentLaunch,
} from "./launcher";
import type {
  ExternalAgentApproval,
  ExternalAgentArtifact,
  ExternalAgentClient,
  ExternalAgentClientFactory,
  ExternalAgentCredentialVault,
  ExternalAgentHost,
  ExternalAgentLaunchInput,
  ExternalAgentPersistence,
  ExternalAgentPersistenceLease,
  ExternalAgentPersistenceSnapshot,
  ExternalAgentRunStatus,
  ExternalAgentSession,
  ExternalAgentSessionRef,
  ExternalAgentStoreEvent,
  ExternalAgentStoreSnapshot,
  ExternalAgentTimelineEvent,
  ExternalRemoteEvent,
  ExternalRemoteSession,
  ExternalRemoteStreamEvent,
  ExternalRemoteTurn,
} from "./types";

const MAX_TIMELINE_EVENTS = 500;
const MAX_SESSION_REFS = 100;
const MAX_EAGER_REHYDRATED_SESSIONS = 20;
const REHYDRATE_CONCURRENCY = 4;
const MAX_REHYDRATED_TURNS = 20;
const MAX_EVENT_TURNS = 5;
const MAX_HISTORIC_TURN_EVENTS = 100;
const MAX_SESSION_APPROVALS = 100;
const MAX_SESSION_ARTIFACTS = 100;
const MAX_ARTIFACT_FILES_PER_EVENT = 50;

interface ExternalAgentWorkspaceLease {
  readonly workspaceId: string;
  readonly epoch: number;
  readonly persistence: ExternalAgentPersistenceLease;
}

async function forEachWithConcurrency<T>(
  values: readonly T[],
  concurrency: number,
  task: (value: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (cursor < values.length) {
        const index = cursor++;
        await task(values[index]!);
      }
    },
  );
  await Promise.all(workers);
}

function nowIso(): string {
  return new Date().toISOString();
}

function remoteDate(value: number | undefined, fallback = Date.now()): string {
  if (!value || !Number.isFinite(value))
    return new Date(fallback).toISOString();
  const millis = value < 1_000_000_000_000 ? value * 1000 : value;
  return new Date(millis).toISOString();
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function firstString(
  input: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function redactErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : fallback;
  return message
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [REDACTED]")
    .replace(/([?&](?:token|api[_-]?key|secret)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/\b(?:sk|or3)[-_][A-Za-z0-9_-]{12,}\b/g, "[REDACTED]");
}

function randomId(prefix: string): string {
  const cryptoApi = Reflect.get(globalThis, "crypto") as
    | { randomUUID?: () => string }
    | undefined;
  const value =
    typeof cryptoApi?.randomUUID === "function"
      ? cryptoApi.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${value}`;
}

function normalizeBaseUrl(value: string): string {
  const parsed = new URL(value.trim());
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Host URL must use HTTP or HTTPS");
  }
  const hostname = parsed.hostname
    .toLowerCase()
    .replace(/^\[/, "")
    .replace(/\]$/, "");
  const loopback =
    hostname === "localhost" ||
    hostname === "::1" ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname);
  if (parsed.protocol === "http:" && !loopback) {
    throw new Error(
      "Remote hosts must use HTTPS; HTTP is allowed only for loopback hosts",
    );
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(
      "Host URL must not contain credentials, query parameters, or fragments",
    );
  }
  return parsed.toString().replace(/\/+$/, "");
}

function fallbackHostId(baseUrl: string): string {
  const parsed = new URL(baseUrl);
  return (
    parsed.host
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "or3-intern"
  );
}

export function mapExternalAgentStatus(
  value: string | undefined,
  fallback: ExternalAgentRunStatus = "queued",
): ExternalAgentRunStatus {
  switch (String(value ?? "").toLowerCase()) {
    case "queued":
      return "queued";
    case "starting":
    case "running":
    case "aborting":
      return "running";
    case "approval_required":
    case "waiting_approval":
      return "waiting_approval";
    case "succeeded":
    case "completed":
    case "complete":
    case "ok":
      return "succeeded";
    case "aborted":
    case "cancelled":
    case "canceled":
    case "interrupted":
      return "cancelled";
    case "failed":
    case "timed_out":
    case "timeout":
    case "error":
      return "failed";
    default:
      return fallback;
  }
}

function isTerminal(status: ExternalAgentRunStatus): boolean {
  return (
    status === "succeeded" || status === "failed" || status === "cancelled"
  );
}

function sessionFromRemote(
  hostId: string,
  hostGeneration: number,
  remote: ExternalRemoteSession,
  ref?: ExternalAgentSessionRef,
): ExternalAgentSession {
  return {
    hostId,
    hostGeneration,
    remoteSessionId: remote.id,
    appSessionKey: remote.app_session_key,
    runnerId: remote.runner_id,
    title: ref?.title || `Agent session ${remote.id.slice(0, 8)}`,
    status: "queued",
    createdAt: remoteDate(remote.created_at),
    updatedAt: remoteDate(remote.updated_at),
    streamState: "idle",
    turns: [],
    events: [],
    approvals: [],
    artifacts: [],
  };
}

function timelineType(
  rawType: string,
  payload: Readonly<Record<string, unknown>>,
): ExternalAgentTimelineEvent["type"] {
  const type = `${rawType} ${String(payload.type ?? "")}`.trim().toLowerCase();
  if (
    type.includes("approval") ||
    type.includes("user-input.requested") ||
    (type.includes("request.opened") &&
      String(payload.request_type ?? "").includes("approval"))
  ) {
    return "approval";
  }
  if (
    type.includes("diff") ||
    type.includes("file") ||
    type.includes("artifact")
  ) {
    return "artifact";
  }
  if (type.includes("error") || type.includes("failed")) return "error";
  if (
    type.includes("token") ||
    type.includes("usage") ||
    type.includes("metric")
  ) {
    return "metric";
  }
  if (
    type.includes("text") ||
    type.includes("content") ||
    type.includes("message") ||
    type.includes("reasoning")
  ) {
    return "message";
  }
  if (
    type.includes("completed") ||
    type.includes("status") ||
    type === "done"
  ) {
    return "status";
  }
  return "tool";
}

function normalizeTimelineEvent(
  hostId: string,
  hostGeneration: number,
  sessionId: string,
  event: ExternalRemoteEvent,
): ExternalAgentTimelineEvent {
  const payload = record(event.payload);
  const type = timelineType(event.type, payload);
  const text =
    event.text ||
    firstString(payload, [
      "delta",
      "text",
      "message",
      "detail",
      "summary",
      "unified_diff",
      "error",
      "error_message",
      "name",
    ]);
  const stableId =
    typeof event.id === "number"
      ? String(event.id)
      : `${event.turn_id}:${event.seq}`;
  return Object.freeze({
    id: `${hostId}:${sessionId}:${stableId}`,
    hostId,
    hostGeneration,
    sessionId,
    turnId: event.turn_id,
    sequence: event.seq,
    occurredAt: remoteDate(event.ts),
    type,
    text,
    payload: Object.freeze({
      ...payload,
      rawType: event.type,
      stream: event.stream,
      jobId: event.job_id,
    }),
  });
}

function approvalFromEvent(
  event: ExternalAgentTimelineEvent,
): ExternalAgentApproval | null {
  if (event.type !== "approval") return null;
  const payload = event.payload;
  const id =
    firstString(payload, ["approval_id", "request_id", "requestId", "id"]) ??
    String(
      payload.approval_id ??
        payload.request_id ??
        `${event.turnId}:${event.sequence}`,
    );
  const rawType = String(payload.rawType ?? "").toLowerCase();
  const decision = String(
    payload.decision ?? payload.status ?? "",
  ).toLowerCase();
  let status: ExternalAgentApproval["status"] = "pending";
  if (
    rawType.includes("resolved") ||
    rawType.includes("response") ||
    decision
  ) {
    if (decision.includes("approve") || decision === "allow") {
      status = "approved";
    } else if (decision.includes("deny") || decision.includes("reject")) {
      status = "denied";
    } else if (decision.includes("cancel")) {
      status = "cancelled";
    }
  }
  return {
    id,
    turnId: event.turnId,
    title:
      firstString(payload, ["title", "summary", "request_type"]) ??
      "Agent approval required",
    description:
      event.text ?? firstString(payload, ["detail", "description", "message"]),
    status,
  };
}

function artifactsFromEvent(
  event: ExternalAgentTimelineEvent,
): ExternalAgentArtifact[] {
  if (event.type !== "artifact") return [];
  const payload = event.payload;
  const output: ExternalAgentArtifact[] = [];
  const diff = firstString(payload, ["unified_diff", "diff"]);
  if (diff) {
    output.push({
      id: `${event.id}:diff`,
      turnId: event.turnId,
      kind: "diff",
      label: "Proposed changes",
      content: diff,
    });
  }
  const files = Array.isArray(payload.files)
    ? payload.files.slice(0, MAX_ARTIFACT_FILES_PER_EVENT)
    : [];
  for (const [index, candidate] of files.entries()) {
    const file = record(candidate);
    const path = firstString(file, ["path", "name", "file"]);
    if (!path) continue;
    output.push({
      id: `${event.id}:file:${index}`,
      turnId: event.turnId,
      kind: "file",
      label: path,
      content: firstString(file, ["diff", "content"]),
    });
  }
  const artifactId = firstString(payload, ["artifact_id", "artifactId"]);
  if (artifactId) {
    output.push({
      id: `${event.id}:artifact:${artifactId}`,
      turnId: event.turnId,
      kind: "artifact",
      label:
        firstString(payload, ["label", "name"]) ?? `Artifact ${artifactId}`,
      artifactId,
    });
  }
  if (!output.length) {
    output.push({
      id: `${event.id}:artifact`,
      turnId: event.turnId,
      kind: "artifact",
      label: event.text ?? "Agent artifact",
    });
  }
  return output;
}

function streamPayload(
  streamEvent: ExternalRemoteStreamEvent,
): ExternalRemoteEvent | null {
  const value = streamEvent.json;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.turn_id !== "string" ||
    typeof candidate.seq !== "number" ||
    typeof candidate.type !== "string"
  ) {
    return null;
  }
  return candidate as unknown as ExternalRemoteEvent;
}

export interface ExternalAgentControllerOptions {
  readonly persistence: ExternalAgentPersistence;
  readonly credentials: ExternalAgentCredentialVault;
  readonly createClient: ExternalAgentClientFactory;
  readonly getWorkspaceScope: () => string | null | undefined;
}

export class ExternalAgentController {
  readonly #persistence: ExternalAgentPersistence;
  readonly #credentials: ExternalAgentCredentialVault;
  readonly #createClient: ExternalAgentClientFactory;
  readonly #getWorkspaceScope: () => string | null | undefined;
  readonly #listeners = new Set<(event: ExternalAgentStoreEvent) => void>();
  readonly #sessions = new Map<string, ExternalAgentSession>();
  readonly #streamControllers = new Map<string, AbortController>();
  readonly #sessionRefreshVersions = new Map<string, number>();
  #hostController: AbortController | null = null;
  #client: ExternalAgentClient | null = null;
  #hosts: ExternalAgentHost[] = [];
  #sessionRefs: ExternalAgentSessionRef[] = [];
  #activeHostId: string | null = null;
  #connectionState: ExternalAgentStoreSnapshot["connectionState"] =
    "disconnected";
  #connectionError: string | null = null;
  #generation = 0;
  #health: ExternalAgentStoreSnapshot["health"] = null;
  #readiness: ExternalAgentStoreSnapshot["readiness"] = null;
  #capabilities: ExternalAgentStoreSnapshot["capabilities"] = null;
  #runners: ExternalAgentStoreSnapshot["runners"] = [];
  #workspaceLease: ExternalAgentWorkspaceLease | null = null;
  #workspaceEpoch = 0;
  #disposed = false;
  #persistTail: Promise<void> = Promise.resolve();

  constructor(options: ExternalAgentControllerOptions) {
    this.#persistence = options.persistence;
    this.#credentials = options.credentials;
    this.#createClient = options.createClient;
    this.#getWorkspaceScope = options.getWorkspaceScope;
  }

  get snapshot(): ExternalAgentStoreSnapshot {
    return Object.freeze({
      hosts: Object.freeze([...this.#hosts]),
      activeHostId: this.#activeHostId,
      connectionState: this.#connectionState,
      connectionError: this.#connectionError,
      generation: this.#generation,
      health: this.#health,
      readiness: this.#readiness,
      capabilities: this.#capabilities,
      runners: Object.freeze([...this.#runners]),
      sessions: Object.freeze(
        [...this.#sessions.values()].sort(
          (left, right) =>
            Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
        ),
      ),
    });
  }

  subscribe(listener: (event: ExternalAgentStoreEvent) => void): () => void {
    this.#listeners.add(listener);
    listener({ type: "snapshot", snapshot: this.snapshot });
    return () => this.#listeners.delete(listener);
  }

  #emit(event?: Exclude<ExternalAgentStoreEvent, { type: "snapshot" }>) {
    for (const listener of [...this.#listeners]) {
      try {
        listener(event ?? { type: "snapshot", snapshot: this.snapshot });
      } catch {
        // UI observers are isolated from canonical session state.
      }
    }
    if (event) {
      for (const listener of [...this.#listeners]) {
        try {
          listener({ type: "snapshot", snapshot: this.snapshot });
        } catch {
          // Observer failure is isolated.
        }
      }
    }
  }

  async initialize(workspaceId?: string): Promise<void> {
    await this.#loadWorkspace(this.#resolveWorkspaceId(workspaceId));
  }

  async reloadWorkspace(workspaceId?: string): Promise<void> {
    await this.#loadWorkspace(this.#resolveWorkspaceId(workspaceId));
  }

  async #loadWorkspace(workspaceId: string): Promise<void> {
    if (this.#disposed) return;
    const replacingWorkspace = this.#workspaceLease !== null;
    this.#abortActiveWork();
    if (replacingWorkspace) this.#generation += 1;
    const lease: ExternalAgentWorkspaceLease = {
      workspaceId,
      epoch: ++this.#workspaceEpoch,
      persistence: this.#persistence.bind(workspaceId),
    };
    this.#workspaceLease = lease;
    this.#client = null;
    this.#sessions.clear();
    this.#sessionRefreshVersions.clear();
    this.#hosts = [];
    this.#sessionRefs = [];
    this.#activeHostId = null;
    this.#connectionState = "disconnected";
    this.#connectionError = null;
    this.#health = null;
    this.#readiness = null;
    this.#capabilities = null;
    this.#runners = [];
    this.#emit();

    const snapshot = await lease.persistence.load();
    if (!this.#isWorkspaceLeaseCurrent(lease)) return;
    this.#hosts = [...snapshot.hosts];
    this.#activeHostId = snapshot.activeHostId;
    this.#sessionRefs = [...snapshot.sessionRefs];
    this.#emit();
    if (!this.#activeHostId) return;
    const host = this.#hosts.find(
      (candidate) => candidate.id === this.#activeHostId,
    );
    if (!host) return;
    const credential = await this.#credentials.resolve(host.credentialRef);
    if (!this.#isWorkspaceLeaseCurrent(lease)) return;
    if (!credential) {
      this.#connectionState = "disconnected";
      this.#connectionError =
        "Reconnect to restore this host credential for this session.";
      this.#emit();
      return;
    }
    await this.connect(host.id, lease);
  }

  async addTrustedHost(input: {
    readonly name: string;
    readonly baseUrl: string;
    readonly token: string;
  }): Promise<ExternalAgentHost> {
    const lease = this.#requireWorkspaceLease();
    const baseUrl = normalizeBaseUrl(input.baseUrl);
    const token = input.token.trim();
    if (!token) throw new Error("An access token is required");
    const credentialRef = randomId("intern-credential");
    const temporary: ExternalAgentHost = {
      id: fallbackHostId(baseUrl),
      name: input.name.trim() || fallbackHostId(baseUrl),
      baseUrl,
      credentialRef,
      trustedAt: nowIso(),
    };
    await this.#credentials.put(credentialRef, token);
    let capabilities: ExternalAgentStoreSnapshot["capabilities"] = null;
    try {
      const client = this.#createClient({
        host: temporary,
        resolveCredential: () => this.#credentials.resolve(credentialRef),
      });
      await client.health();
      capabilities = await client.capabilities().catch(() => null);
      this.#assertWorkspaceLease(lease);
    } catch (error) {
      await this.#credentials.remove(credentialRef);
      throw new Error(redactErrorMessage(error, "Could not verify this host"));
    }

    const advertisedId = String(capabilities?.hostId ?? "").trim();
    const id = advertisedId || temporary.id;
    const previous = this.#hosts.find((host) => host.id === id);
    const host: ExternalAgentHost = {
      ...temporary,
      id,
      name: input.name.trim() || id,
      lastConnectedAt: nowIso(),
    };
    this.#hosts = [
      ...this.#hosts.filter((candidate) => candidate.id !== id),
      host,
    ];
    if (previous && previous.credentialRef !== credentialRef) {
      await this.#credentials.remove(previous.credentialRef);
      this.#assertWorkspaceLease(lease);
    }
    this.#activeHostId = id;
    await this.#persist(lease);
    this.#assertWorkspaceLease(lease);
    await this.connect(id, lease);
    return host;
  }

  async reconnect(token?: string): Promise<boolean> {
    const lease = this.#requireWorkspaceLease();
    if (!this.#activeHostId) {
      this.#connectionError = "Choose a trusted host first.";
      this.#emit();
      return false;
    }
    const host = this.#hosts.find(
      (candidate) => candidate.id === this.#activeHostId,
    );
    if (!host) return false;
    if (token?.trim()) {
      await this.#credentials.put(host.credentialRef, token.trim());
      this.#assertWorkspaceLease(lease);
    }
    return this.connect(host.id, lease);
  }

  async switchHost(hostId: string): Promise<boolean> {
    const lease = this.#requireWorkspaceLease();
    if (!this.#hosts.some((host) => host.id === hostId)) {
      this.#connectionError = "Trusted host not found.";
      this.#emit();
      return false;
    }
    this.#activeHostId = hostId;
    await this.#persist(lease);
    this.#assertWorkspaceLease(lease);
    return this.connect(hostId, lease);
  }

  disconnect(): void {
    this.#abortActiveWork();
    this.#generation += 1;
    this.#client = null;
    this.#connectionState = "disconnected";
    this.#connectionError = null;
    this.#health = null;
    this.#readiness = null;
    this.#capabilities = null;
    this.#runners = [];
    if (this.#workspaceLease) {
      this.#workspaceLease = {
        ...this.#workspaceLease,
        epoch: ++this.#workspaceEpoch,
      };
    } else {
      this.#workspaceEpoch += 1;
    }
    this.#emit();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#abortActiveWork();
    this.#generation += 1;
    this.#workspaceEpoch += 1;
    this.#workspaceLease = null;
    this.#client = null;
    this.#sessionRefreshVersions.clear();
    this.#listeners.clear();
  }

  async forgetHost(hostId: string): Promise<void> {
    this.#requireWorkspaceLease();
    const host = this.#hosts.find((candidate) => candidate.id === hostId);
    if (!host) return;
    if (this.#activeHostId === hostId) this.disconnect();
    const lease = this.#requireWorkspaceLease();
    await this.#credentials.remove(host.credentialRef);
    this.#assertWorkspaceLease(lease);
    this.#hosts = this.#hosts.filter((candidate) => candidate.id !== hostId);
    this.#sessionRefs = this.#sessionRefs.filter(
      (ref) => ref.hostId !== hostId,
    );
    for (const [key, session] of this.#sessions) {
      if (session.hostId === hostId) this.#sessions.delete(key);
    }
    if (this.#activeHostId === hostId) this.#activeHostId = null;
    await this.#persist(lease);
    this.#assertWorkspaceLease(lease);
    this.#emit();
  }

  async connect(
    hostId: string,
    expectedLease: ExternalAgentWorkspaceLease = this.#requireWorkspaceLease(),
  ): Promise<boolean> {
    if (!this.#isWorkspaceLeaseCurrent(expectedLease)) return false;
    const host = this.#hosts.find((candidate) => candidate.id === hostId);
    if (!host) return false;
    this.#abortActiveWork();
    const generation = ++this.#generation;
    this.#activeHostId = hostId;
    this.#connectionState = "connecting";
    this.#connectionError = null;
    this.#health = null;
    this.#readiness = null;
    this.#capabilities = null;
    this.#runners = [];
    this.#emit();

    const credential = await this.#credentials.resolve(host.credentialRef);
    if (!this.#isWorkspaceLeaseCurrent(expectedLease)) return false;
    if (!credential) {
      if (generation !== this.#generation) return false;
      this.#client = null;
      this.#connectionState = "disconnected";
      this.#connectionError =
        "A credential is required to reconnect this trusted host.";
      this.#emit();
      return false;
    }

    const client = this.#createClient({
      host,
      resolveCredential: () => this.#credentials.resolve(host.credentialRef),
    });
    const controller = new AbortController();
    this.#hostController = controller;
    this.#client = client;
    const [health, readiness, capabilities, runners] = await Promise.allSettled(
      [
        client.health({ signal: controller.signal }),
        client.readiness({ signal: controller.signal }),
        client.capabilities({ signal: controller.signal }),
        client.listRunners({ signal: controller.signal }),
      ],
    );
    if (
      controller.signal.aborted ||
      generation !== this.#generation ||
      hostId !== this.#activeHostId ||
      !this.#isWorkspaceLeaseCurrent(expectedLease)
    ) {
      return false;
    }
    if (health.status === "rejected") {
      this.#client = null;
      this.#connectionState = "offline";
      this.#connectionError = redactErrorMessage(
        health.reason,
        "Host is offline",
      );
      this.#emit();
      return false;
    }

    this.#health = health.value;
    this.#readiness = readiness.status === "fulfilled" ? readiness.value : null;
    this.#capabilities =
      capabilities.status === "fulfilled" ? capabilities.value : null;
    this.#runners = runners.status === "fulfilled" ? runners.value.runners : [];
    const partialFailure =
      readiness.status === "rejected" ||
      capabilities.status === "rejected" ||
      runners.status === "rejected" ||
      this.#health.runtimeAvailable === false ||
      this.#readiness?.ready === false;
    this.#connectionState = partialFailure ? "degraded" : "online";
    this.#connectionError = partialFailure
      ? "Host connected with limited capabilities. Retry discovery when the service is ready."
      : null;
    this.#hosts = this.#hosts.map((candidate) =>
      candidate.id === hostId
        ? { ...candidate, lastConnectedAt: nowIso() }
        : candidate,
    );
    await this.#persist(expectedLease);
    if (!this.#isWorkspaceLeaseCurrent(expectedLease)) return false;
    this.#emit();
    await this.rehydrateActiveHost(generation, expectedLease);
    return true;
  }

  async rehydrateActiveHost(
    generation = this.#generation,
    expectedLease: ExternalAgentWorkspaceLease = this.#requireWorkspaceLease(),
  ): Promise<void> {
    const client = this.#client;
    const hostId = this.#activeHostId;
    if (
      !client ||
      !hostId ||
      generation !== this.#generation ||
      !this.#isWorkspaceLeaseCurrent(expectedLease)
    ) {
      return;
    }
    const refs = this.#sessionRefs.filter((ref) => ref.hostId === hostId);
    const targets = new Map<
      string,
      {
        ref?: ExternalAgentSessionRef;
        remote?: ExternalRemoteSession;
      }
    >();
    for (const ref of refs) {
      targets.set(ref.remoteSessionId, { ref });
    }
    const prefix = this.#workspaceSessionPrefix(false, expectedLease);
    if (prefix) {
      try {
        const discovered = await client.listSessions(
          {
            appSessionKeyPrefix: prefix,
            limit: MAX_SESSION_REFS,
          },
          { signal: this.#hostController?.signal },
        );
        this.#assertGeneration(hostId, generation);
        for (const remote of discovered.sessions) {
          if (!remote.app_session_key.startsWith(prefix)) continue;
          const ref = targets.get(remote.id)?.ref;
          targets.set(remote.id, {
            ref,
            remote,
          });
          this.#rememberSession(
            sessionFromRemote(hostId, generation, remote, ref),
          );
        }
      } catch (error) {
        if (
          generation !== this.#generation ||
          hostId !== this.#activeHostId ||
          !this.#isWorkspaceLeaseCurrent(expectedLease) ||
          this.#hostController?.signal.aborted
        ) {
          return;
        }
        this.#connectionState = "degraded";
        this.#connectionError = redactErrorMessage(
          error,
          "Session discovery is unavailable; saved sessions will still be restored.",
        );
        this.#emit();
      }
    }
    const eagerTargets = [...targets.values()]
      .sort((left, right) => {
        const leftUpdated = left.remote
          ? Date.parse(remoteDate(left.remote.updated_at))
          : Date.parse(left.ref?.updatedAt ?? "") || 0;
        const rightUpdated = right.remote
          ? Date.parse(remoteDate(right.remote.updated_at))
          : Date.parse(right.ref?.updatedAt ?? "") || 0;
        return rightUpdated - leftUpdated;
      })
      .slice(0, MAX_EAGER_REHYDRATED_SESSIONS);
    await forEachWithConcurrency(
      eagerTargets,
      REHYDRATE_CONCURRENCY,
      async (target) => {
        try {
          if (!target.remote && !target.ref) return;
          const remote =
            target.remote ??
            (await client.getSession(target.ref!.remoteSessionId, {
              signal: this.#hostController?.signal,
            }));
          if (
            generation !== this.#generation ||
            hostId !== this.#activeHostId ||
            !this.#isWorkspaceLeaseCurrent(expectedLease)
          ) {
            return;
          }
          const session = sessionFromRemote(
            hostId,
            generation,
            remote,
            target.ref,
          );
          this.#sessions.set(this.#sessionKey(hostId, remote.id), session);
          await this.#refreshSession(
            session,
            client,
            generation,
            expectedLease,
          );
          this.#rememberSession(session);
          this.#emit({ type: "session", session });
          if (session.activeTurnId && !isTerminal(session.status)) {
            this.#startStream(session, session.activeTurnId);
          }
        } catch {
          // One stale or unavailable session ref must not block others.
        }
      },
    );
    if (
      generation === this.#generation &&
      hostId === this.#activeHostId &&
      this.#isWorkspaceLeaseCurrent(expectedLease)
    ) {
      await this.#persist(expectedLease);
    }
  }

  availableRunnerOptions() {
    return buildExternalAgentRunnerOptions(this.#runners);
  }

  canCancel(session: ExternalAgentSession): boolean {
    return (
      this.#canActOnSession(session) &&
      this.#runnerChatCapability(session, "cancel") &&
      Boolean(session.activeTurnId) &&
      (session.status === "queued" ||
        session.status === "running" ||
        session.status === "waiting_approval")
    );
  }

  canDecideApproval(
    session: ExternalAgentSession,
    approvalId?: string,
  ): boolean {
    const approvalBroker = record(this.#capabilities?.approvalBroker);
    if (
      !this.#canActOnSession(session) ||
      !this.#runnerChatCapability(session, "approvalDecisions") ||
      approvalBroker.enabled !== true ||
      approvalBroker.available !== true ||
      isTerminal(session.status)
    ) {
      return false;
    }
    return approvalId
      ? session.approvals.some(
          (approval) =>
            approval.id === approvalId && approval.status === "pending",
        )
      : session.approvals.some((approval) => approval.status === "pending");
  }

  canFollowUp(session: ExternalAgentSession): boolean {
    if (
      !this.#canActOnSession(session) ||
      !isTerminal(session.status) ||
      !session.turns.length
    ) {
      return false;
    }
    const runner = this.#runners.find(
      (candidate) => candidate.id === session.runnerId,
    );
    if (
      !runner ||
      runner.status !== "available" ||
      runner.auth_status !== "ready"
    ) {
      return false;
    }
    const supports = record(runner.supports);
    const chat = record(runner.chat_capabilities ?? supports.chat);
    return (
      chat.chatReplay === true ||
      chat.chatNativeSession === true ||
      chat.chatResume === true
    );
  }

  canReadArtifact(session: ExternalAgentSession, artifactId: string): boolean {
    return (
      this.#canActOnSession(session) &&
      session.artifacts.some(
        (artifact) =>
          artifact.id === artifactId && Boolean(artifact.artifactId),
      )
    );
  }

  async launch(input: ExternalAgentLaunchInput): Promise<ExternalAgentSession> {
    const lease = this.#requireWorkspaceLease();
    const validation = validateExternalAgentLaunch(this.#runners, input);
    if (!validation.ok) throw new Error(validation.message);
    const client = this.#requireClient();
    const hostId = this.#activeHostId!;
    const generation = this.#generation;
    const instruction = input.instruction.trim();
    const appSessionKey = `${this.#workspaceSessionPrefix(true, lease)}${randomId("session")}`;
    const remote = await client.createSession(
      {
        app_session_key: appSessionKey,
        runner_id: input.runnerId,
        continuation_mode: input.continuationMode ?? "replay",
        model: input.model?.trim() || undefined,
        mode: input.mode,
        isolation: input.isolation,
        cwd: input.cwd?.trim() || undefined,
      },
      { signal: this.#hostController?.signal },
    );
    this.#assertGeneration(hostId, generation);
    this.#assertWorkspaceLease(lease);
    const session = sessionFromRemote(hostId, generation, remote, {
      hostId,
      remoteSessionId: remote.id,
      title: instruction.slice(0, 80),
      runnerId: input.runnerId,
    });
    this.#sessions.set(this.#sessionKey(hostId, remote.id), session);
    this.#rememberSession(session);
    await this.#persist(lease);
    this.#assertWorkspaceLease(lease);
    this.#emit({ type: "session", session });

    try {
      const started = await client.startTurn(
        remote.id,
        {
          user_message: instruction,
          continuation_mode: input.continuationMode ?? "replay",
          model: input.model?.trim() || undefined,
          mode: input.mode,
          isolation: input.isolation,
          cwd: input.cwd?.trim() || undefined,
        },
        { signal: this.#hostController?.signal },
      );
      this.#assertGeneration(hostId, generation);
      session.activeTurnId = started.turn_id;
      session.status = mapExternalAgentStatus(started.status, "queued");
      session.updatedAt = nowIso();
      session.actionError = undefined;
      await this.#refreshTurn(session, started.turn_id, client, lease);
      this.#emit({ type: "session", session });
      this.#startStream(session, started.turn_id);
      return session;
    } catch (error) {
      if (this.#isStaleResponseError(error)) throw error;
      session.actionError = redactErrorMessage(
        error,
        "The remote session was created, but its first turn did not start.",
      );
      session.updatedAt = nowIso();
      this.#emit({ type: "session", session });
      throw error;
    }
  }

  async followUp(sessionId: string, instruction: string): Promise<void> {
    const lease = this.#requireWorkspaceLease();
    const session = this.#requireSession(sessionId);
    const client = this.#requireSessionClient(session);
    const text = instruction.trim();
    if (!text) throw new Error("Follow-up instruction is required");
    if (!this.canFollowUp(session)) {
      throw new Error(
        "Follow-up is unavailable until this provider finishes the current turn and advertises continuation support",
      );
    }
    try {
      const started = await client.startTurn(
        session.remoteSessionId,
        {
          user_message: text,
          continuation_mode: "replay",
        },
        { signal: this.#hostController?.signal },
      );
      this.#assertSessionGeneration(session);
      session.activeTurnId = started.turn_id;
      session.status = mapExternalAgentStatus(started.status, "queued");
      session.actionError = undefined;
      session.error = undefined;
      session.completedAt = undefined;
      session.updatedAt = nowIso();
      await this.#refreshTurn(session, started.turn_id, client, lease);
      this.#emit({ type: "session", session });
      this.#startStream(session, started.turn_id);
    } catch (error) {
      if (this.#isStaleResponseError(error)) throw error;
      session.actionError = redactErrorMessage(
        error,
        "Remote follow-up failed. Try again.",
      );
      this.#emit({ type: "session", session });
      throw error;
    }
  }

  async cancel(sessionId: string): Promise<void> {
    const lease = this.#requireWorkspaceLease();
    const session = this.#requireSession(sessionId);
    const client = this.#requireSessionClient(session);
    if (!this.canCancel(session) || !session.activeTurnId) {
      throw new Error("This session has no cancellable active turn");
    }
    const previousStatus = session.status;
    try {
      await client.abortTurn(session.remoteSessionId, session.activeTurnId, {
        signal: this.#hostController?.signal,
      });
      this.#assertSessionGeneration(session);
      session.actionError = undefined;
      await this.#refreshTurn(
        session,
        session.activeTurnId,
        client,
        lease,
      );
    } catch (error) {
      if (this.#isStaleResponseError(error)) throw error;
      session.status = previousStatus;
      const detail = redactErrorMessage(error, "Request failed");
      session.actionError = `Remote cancellation failed. Try again.${
        detail ? ` ${detail}` : ""
      }`;
      this.#emit({ type: "session", session });
      throw error;
    }
    this.#emit({ type: "session", session });
  }

  async decideApproval(
    sessionId: string,
    decision: "approve" | "deny",
    approvalId?: string,
    note = "",
  ): Promise<void> {
    const lease = this.#requireWorkspaceLease();
    const session = this.#requireSession(sessionId);
    const client = this.#requireSessionClient(session);
    const approval = approvalId
      ? session.approvals.find((item) => item.id === approvalId)
      : session.approvals.find((item) => item.status === "pending");
    if (approvalId && !approval) {
      throw new Error("The selected approval is no longer available");
    }
    if (approval && approval.status !== "pending") {
      throw new Error("The selected approval is already resolved");
    }
    if (!this.canDecideApproval(session, approval?.id)) {
      throw new Error("This approval is not actionable on the selected host");
    }
    const turnId = approval?.turnId ?? session.activeTurnId;
    if (!turnId) throw new Error("No pending approval is available");
    const previous = session.approvals.map((item) => ({ ...item }));
    try {
      await client.decideTurn(
        session.remoteSessionId,
        turnId,
        decision === "approve" ? "approve" : "reject",
        { note },
        { signal: this.#hostController?.signal },
      );
      this.#assertSessionGeneration(session);
      session.actionError = undefined;
      await this.#refreshTurn(session, turnId, client, lease);
      if (session.status === "queued" || session.status === "running") {
        this.#startStream(session, turnId);
      }
    } catch (error) {
      if (this.#isStaleResponseError(error)) throw error;
      session.approvals = previous;
      const detail = redactErrorMessage(error, "Request failed");
      session.actionError = `Remote ${decision} failed. Try again.${
        detail ? ` ${detail}` : ""
      }`;
      this.#emit({ type: "session", session });
      throw error;
    }
    this.#emit({ type: "session", session });
  }

  async readArtifact(sessionId: string, artifactId: string): Promise<void> {
    const lease = this.#requireWorkspaceLease();
    const session = this.#requireSession(sessionId);
    const client = this.#requireSessionClient(session);
    const index = session.artifacts.findIndex(
      (artifact) => artifact.id === artifactId,
    );
    const artifact = session.artifacts[index];
    if (
      index < 0 ||
      !artifact?.artifactId ||
      !this.canReadArtifact(session, artifactId)
    ) {
      throw new Error("This artifact is not available from the selected host");
    }
    try {
      const remote = await client.readArtifact(
        artifact.artifactId,
        {
          sessionKey: session.appSessionKey,
          maxBytes: 256 * 1024,
        },
        { signal: this.#hostController?.signal },
      );
      this.#assertSessionGeneration(session);
      this.#assertWorkspaceLease(lease);
      session.artifacts[index] = {
        ...artifact,
        content: remote.content,
      };
      session.actionError = undefined;
      this.#emit({ type: "session", session });
    } catch (error) {
      if (this.#isStaleResponseError(error)) throw error;
      session.actionError = redactErrorMessage(
        error,
        "Artifact download failed. Try again.",
      );
      this.#emit({ type: "session", session });
      throw error;
    }
  }

  getSession(
    remoteSessionId: string,
    hostId = this.#activeHostId ?? undefined,
  ): ExternalAgentSession | undefined {
    if (hostId) {
      return this.#sessions.get(this.#sessionKey(hostId, remoteSessionId));
    }
    return [...this.#sessions.values()].find(
      (session) => session.remoteSessionId === remoteSessionId,
    );
  }

  async ensureSession(
    hostId: string,
    remoteSessionId: string,
  ): Promise<ExternalAgentSession> {
    let lease = this.#requireWorkspaceLease();
    const existing = this.getSession(remoteSessionId, hostId);
    if (existing) return existing;
    if (hostId !== this.#activeHostId) {
      const connected = await this.switchHost(hostId);
      if (!connected) throw new Error("Could not reconnect session host");
      lease = this.#requireWorkspaceLease();
    }
    const client = this.#requireClient();
    const generation = this.#generation;
    const remote = await client.getSession(remoteSessionId, {
      signal: this.#hostController?.signal,
    });
    this.#assertGeneration(hostId, generation);
    this.#assertWorkspaceLease(lease);
    const ref = this.#sessionRefs.find(
      (candidate) =>
        candidate.hostId === hostId &&
        candidate.remoteSessionId === remoteSessionId,
    );
    const session = sessionFromRemote(hostId, generation, remote, ref);
    this.#sessions.set(this.#sessionKey(hostId, remoteSessionId), session);
    await this.#refreshSession(session, client, generation, lease);
    this.#emit({ type: "session", session });
    if (session.activeTurnId && !isTerminal(session.status)) {
      this.#startStream(session, session.activeTurnId);
    }
    return session;
  }

  #requireClient(): ExternalAgentClient {
    if (
      !this.#client ||
      !this.#activeHostId ||
      (this.#connectionState !== "online" &&
        this.#connectionState !== "degraded")
    ) {
      throw new Error("Connect a trusted or3-intern host first");
    }
    return this.#client;
  }

  #requireSession(remoteSessionId: string): ExternalAgentSession {
    const session = this.getSession(remoteSessionId);
    if (!session) throw new Error("External agent session not found");
    return session;
  }

  #requireSessionClient(session: ExternalAgentSession): ExternalAgentClient {
    this.#assertSessionGeneration(session);
    return this.#requireClient();
  }

  #canActOnSession(session: ExternalAgentSession): boolean {
    return (
      session.hostId === this.#activeHostId &&
      session.hostGeneration === this.#generation &&
      (this.#connectionState === "online" ||
        this.#connectionState === "degraded")
    );
  }

  #runnerChatCapability(
    session: ExternalAgentSession,
    capability: "cancel" | "approvalDecisions",
  ): boolean {
    const runner = this.#runners.find(
      (candidate) => candidate.id === session.runnerId,
    );
    if (!runner) return false;
    const supports = record(runner.supports);
    const chat = record(runner.chat_capabilities ?? supports.chat);
    return chat[capability] === true;
  }

  #resolveWorkspaceId(workspaceId?: string): string {
    return workspaceId?.trim() || this.#getWorkspaceScope()?.trim() || "local";
  }

  #workspaceSessionPrefix(
    required: boolean,
    lease: ExternalAgentWorkspaceLease,
  ): string | null {
    this.#assertWorkspaceLease(lease);
    const scope = lease.workspaceId.trim();
    if (!scope) {
      if (required) {
        throw new Error(
          "A workspace must be active before launching an external agent",
        );
      }
      return null;
    }
    const prefix = `or3-chat:${encodeURIComponent(scope)}:`;
    if (new TextEncoder().encode(prefix).byteLength > 256) {
      throw new Error("The active workspace identifier is too long");
    }
    return prefix;
  }

  #requireWorkspaceLease(): ExternalAgentWorkspaceLease {
    const lease = this.#workspaceLease;
    if (!lease || !this.#isWorkspaceLeaseCurrent(lease)) {
      throw this.#staleWorkspaceError();
    }
    return lease;
  }

  #isWorkspaceLeaseCurrent(lease: ExternalAgentWorkspaceLease): boolean {
    return (
      !this.#disposed &&
      this.#workspaceLease === lease &&
      lease.epoch === this.#workspaceEpoch
    );
  }

  #assertWorkspaceLease(lease: ExternalAgentWorkspaceLease): void {
    if (!this.#isWorkspaceLeaseCurrent(lease)) {
      throw this.#staleWorkspaceError();
    }
  }

  #staleWorkspaceError(): Error {
    return Object.assign(new Error("Ignored stale workspace response"), {
      code: "stale_workspace",
    });
  }

  #isStaleResponseError(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;
    const code = Reflect.get(error, "code");
    return (
      code === "stale_workspace" ||
      code === "stale_host" ||
      code === "stale_session"
    );
  }

  #assertGeneration(hostId: string, generation: number): void {
    if (generation !== this.#generation || hostId !== this.#activeHostId) {
      throw Object.assign(new Error("Ignored stale host response"), {
        code: "stale_host",
      });
    }
  }

  #assertSessionGeneration(session: ExternalAgentSession): void {
    this.#assertGeneration(session.hostId, session.hostGeneration);
  }

  async #refreshSession(
    session: ExternalAgentSession,
    client: ExternalAgentClient,
    generation: number,
    lease: ExternalAgentWorkspaceLease,
  ): Promise<void> {
    const refreshVersion = this.#nextSessionRefreshVersion(session);
    const response = await client.listTurns(session.remoteSessionId, {
      limit: MAX_REHYDRATED_TURNS,
      signal: this.#hostController?.signal,
    });
    this.#assertSessionRefresh(
      session,
      generation,
      lease,
      refreshVersion,
    );
    const turns = new Map(
      session.turns.map((turn) => [turn.id, turn] as const),
    );
    for (const turn of response.turns.slice(-MAX_REHYDRATED_TURNS)) {
      turns.set(turn.id, this.#mergeTurn(turns.get(turn.id), turn));
    }
    session.turns = [...turns.values()]
      .sort((left, right) => left.sequence - right.sequence)
      .slice(-MAX_REHYDRATED_TURNS);
    const latest = session.turns.at(-1);
    if (!latest) return;
    this.#applyLatestTurn(session, latest);
    const eventTurns = session.turns.slice(-MAX_EVENT_TURNS);
    for (const [index, turn] of eventTurns.entries()) {
      const limit =
        index === eventTurns.length - 1
          ? MAX_TIMELINE_EVENTS
          : MAX_HISTORIC_TURN_EVENTS;
      const events = await client.listTurnEvents(
        session.remoteSessionId,
        turn.id,
        {
          limit,
          signal: this.#hostController?.signal,
        },
      );
      this.#assertSessionRefresh(
        session,
        generation,
        lease,
        refreshVersion,
      );
      for (const event of events.events.slice(-limit)) {
        this.#ingestRemoteEvent(session, event);
      }
    }
    if (
      session.approvals.some((approval) => approval.status === "pending") &&
      !isTerminal(session.status)
    ) {
      session.status = "waiting_approval";
    }
  }

  async #refreshTurn(
    session: ExternalAgentSession,
    turnId: string,
    client: ExternalAgentClient,
    lease: ExternalAgentWorkspaceLease,
  ): Promise<void> {
    const generation = session.hostGeneration;
    const refreshVersion = this.#nextSessionRefreshVersion(session);
    const [turn, events] = await Promise.all([
      client.getTurn(session.remoteSessionId, turnId, {
        signal: this.#hostController?.signal,
      }),
      client.listTurnEvents(session.remoteSessionId, turnId, {
        limit: MAX_TIMELINE_EVENTS,
        signal: this.#hostController?.signal,
      }),
    ]);
    this.#assertSessionRefresh(
      session,
      generation,
      lease,
      refreshVersion,
    );
    const index = session.turns.findIndex(
      (candidate) => candidate.id === turn.id,
    );
    const mergedTurn = this.#mergeTurn(
      index >= 0 ? session.turns[index] : undefined,
      turn,
    );
    if (index >= 0) session.turns[index] = mergedTurn;
    else session.turns.push(mergedTurn);
    session.turns = session.turns
      .sort((left, right) => left.sequence - right.sequence)
      .slice(-MAX_REHYDRATED_TURNS);
    const latest = session.turns.at(-1);
    if (latest) this.#applyLatestTurn(session, latest);
    for (const event of events.events.slice(-MAX_TIMELINE_EVENTS)) {
      this.#ingestRemoteEvent(session, event);
    }
    if (
      session.approvals.some((approval) => approval.status === "pending") &&
      !isTerminal(session.status)
    ) {
      session.status = "waiting_approval";
    }
    this.#rememberSession(session);
    await this.#persist(lease);
    this.#assertSessionRefresh(
      session,
      generation,
      lease,
      refreshVersion,
    );
  }

  #mergeTurn(
    existing: ExternalRemoteTurn | undefined,
    incoming: ExternalRemoteTurn,
  ): ExternalRemoteTurn {
    if (!existing) return incoming;
    const existingStatus = mapExternalAgentStatus(existing.status, "queued");
    const incomingStatus = mapExternalAgentStatus(incoming.status, "queued");
    if (isTerminal(existingStatus) && !isTerminal(incomingStatus)) {
      return {
        ...incoming,
        status: existing.status,
        completed_at: existing.completed_at,
        final_text: existing.final_text,
        error: existing.error,
      };
    }
    return incoming;
  }

  #applyLatestTurn(
    session: ExternalAgentSession,
    latest: ExternalRemoteTurn,
  ): void {
    const nextStatus = mapExternalAgentStatus(latest.status, session.status);
    const preserveTerminal =
      session.activeTurnId === latest.id &&
      isTerminal(session.status) &&
      !isTerminal(nextStatus);
    session.activeTurnId = latest.id;
    if (!preserveTerminal) session.status = nextStatus;
    session.output = latest.final_text ?? session.output;
    session.error = latest.error ?? session.error;
    session.updatedAt = remoteDate(
      latest.completed_at ?? latest.started_at ?? latest.requested_at,
    );
    session.completedAt = isTerminal(session.status)
      ? (session.completedAt ??
        remoteDate(latest.completed_at, Date.parse(session.updatedAt)))
      : undefined;
  }

  #nextSessionRefreshVersion(session: ExternalAgentSession): number {
    const key = this.#sessionKey(session.hostId, session.remoteSessionId);
    const next = (this.#sessionRefreshVersions.get(key) ?? 0) + 1;
    this.#sessionRefreshVersions.set(key, next);
    return next;
  }

  #assertSessionRefresh(
    session: ExternalAgentSession,
    generation: number,
    lease: ExternalAgentWorkspaceLease,
    refreshVersion: number,
  ): void {
    this.#assertGeneration(session.hostId, generation);
    this.#assertWorkspaceLease(lease);
    const key = this.#sessionKey(session.hostId, session.remoteSessionId);
    if (
      this.#sessions.get(key) !== session ||
      this.#sessionRefreshVersions.get(key) !== refreshVersion
    ) {
      throw Object.assign(new Error("Ignored stale session response"), {
        code: "stale_session",
      });
    }
  }

  #ingestRemoteEvent(
    session: ExternalAgentSession,
    remote: ExternalRemoteEvent,
  ): void {
    if (
      session.hostGeneration !== this.#generation ||
      session.hostId !== this.#activeHostId ||
      this.#sessions.get(
        this.#sessionKey(session.hostId, session.remoteSessionId),
      ) !== session
    ) {
      return;
    }
    const normalized = normalizeTimelineEvent(
      session.hostId,
      session.hostGeneration,
      session.remoteSessionId,
      remote,
    );
    if (session.events.some((event) => event.id === normalized.id)) return;
    session.events = [...session.events, normalized]
      .sort(
        (left, right) =>
          left.sequence - right.sequence || left.id.localeCompare(right.id),
      )
      .slice(-MAX_TIMELINE_EVENTS);
    const approval = approvalFromEvent(normalized);
    if (approval) {
      const index = session.approvals.findIndex(
        (item) => item.id === approval.id,
      );
      if (index >= 0) session.approvals[index] = approval;
      else session.approvals.push(approval);
      session.approvals = session.approvals.slice(-MAX_SESSION_APPROVALS);
      if (approval.status === "pending" && !isTerminal(session.status)) {
        session.status = "waiting_approval";
      }
    }
    for (const artifact of artifactsFromEvent(normalized)) {
      const index = session.artifacts.findIndex(
        (item) => item.id === artifact.id,
      );
      if (index >= 0) session.artifacts[index] = artifact;
      else session.artifacts.push(artifact);
    }
    session.artifacts = session.artifacts.slice(-MAX_SESSION_ARTIFACTS);
    if (normalized.type === "error") {
      session.error = normalized.text ?? "External agent failed";
    }
    if (Date.parse(normalized.occurredAt) >= Date.parse(session.updatedAt)) {
      session.updatedAt = normalized.occurredAt;
    }
    this.#emit({ type: "timeline", session, event: normalized });
  }

  #startStream(session: ExternalAgentSession, turnId: string): void {
    const client = this.#client;
    if (!client) return;
    const lease = this.#requireWorkspaceLease();
    const key = this.#sessionKey(session.hostId, session.remoteSessionId);
    this.#streamControllers.get(key)?.abort();
    const controller = new AbortController();
    this.#streamControllers.set(key, controller);
    const generation = session.hostGeneration;
    const afterSeq = session.events
      .filter((event) => event.turnId === turnId)
      .reduce((max, event) => Math.max(max, event.sequence), 0);
    session.streamState = "connecting";
    this.#emit({ type: "session", session });

    void (async () => {
      try {
        for await (const streamEvent of client.streamTurn(
          session.remoteSessionId,
          turnId,
          { afterSeq, signal: controller.signal },
        )) {
          if (
            controller.signal.aborted ||
            generation !== this.#generation ||
            session.hostId !== this.#activeHostId ||
            !this.#isWorkspaceLeaseCurrent(lease) ||
            this.#sessions.get(key) !== session
          ) {
            return;
          }
          session.streamState = "connected";
          const remote = streamPayload(streamEvent);
          if (remote) this.#ingestRemoteEvent(session, remote);
          if (streamEvent.event === "done") {
            await this.#refreshTurn(session, turnId, client, lease);
          }
        }
        if (!controller.signal.aborted) {
          await this.#refreshTurn(session, turnId, client, lease);
          session.streamState = "idle";
          this.#emit({ type: "session", session });
        }
      } catch (error) {
        if (
          controller.signal.aborted ||
          generation !== this.#generation ||
          !this.#isWorkspaceLeaseCurrent(lease) ||
          this.#sessions.get(key) !== session ||
          this.#isStaleResponseError(error)
        ) {
          return;
        }
        session.streamState = "disconnected";
        session.actionError = redactErrorMessage(
          error,
          "Live updates disconnected. Reconnect to resume.",
        );
        this.#emit({ type: "session", session });
      } finally {
        if (this.#streamControllers.get(key) === controller) {
          this.#streamControllers.delete(key);
        }
      }
    })();
  }

  #abortActiveWork(): void {
    this.#hostController?.abort();
    this.#hostController = null;
    for (const controller of this.#streamControllers.values()) {
      controller.abort();
    }
    this.#streamControllers.clear();
  }

  #sessionKey(hostId: string, remoteSessionId: string): string {
    return `${hostId}:${remoteSessionId}`;
  }

  #rememberSession(session: ExternalAgentSession): void {
    const ref: ExternalAgentSessionRef = {
      hostId: session.hostId,
      remoteSessionId: session.remoteSessionId,
      title: session.title,
      runnerId: session.runnerId,
      updatedAt: session.updatedAt,
    };
    this.#sessionRefs = [
      ref,
      ...this.#sessionRefs.filter(
        (candidate) =>
          candidate.hostId !== ref.hostId ||
          candidate.remoteSessionId !== ref.remoteSessionId,
      ),
    ]
      .sort(
        (left, right) =>
          Date.parse(right.updatedAt ?? "") - Date.parse(left.updatedAt ?? ""),
      )
      .slice(0, MAX_SESSION_REFS);
  }

  async #persist(lease: ExternalAgentWorkspaceLease): Promise<void> {
    this.#assertWorkspaceLease(lease);
    const snapshot: ExternalAgentPersistenceSnapshot = {
      hosts: [...this.#hosts],
      activeHostId: this.#activeHostId,
      sessionRefs: [...this.#sessionRefs],
    };
    const save = this.#persistTail.then(
      () => lease.persistence.save(snapshot),
      () => lease.persistence.save(snapshot),
    );
    this.#persistTail = save.catch(() => undefined);
    await save;
    this.#assertWorkspaceLease(lease);
  }
}
