import {
  buildExternalAgentRunnerOptions,
  validateExternalAgentLaunch,
} from "./launcher";
import {
  presentExternalAgentError,
  sanitizeExternalAgentPayload,
} from "./presentation";
import { isExternalAgentPinCredentialVault } from "./credentials";
import type {
  ExternalAgentApproval,
  ExternalAgentArtifact,
  ExternalAgentClient,
  ExternalAgentClientFactory,
  ExternalAgentCredentialVault,
  ExternalAgentFollowUpInput,
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

const EVENT_PAGE_SIZE = 500;
const MAX_TIMELINE_EVENTS_PER_TURN = 2_000;
const MAX_SESSION_REFS = 100;
const MAX_EAGER_REHYDRATED_SESSIONS = 20;
const REHYDRATE_CONCURRENCY = 4;
const MAX_REHYDRATED_TURNS = 20;
const MAX_EVENT_TURNS = 5;
const MAX_SESSION_APPROVALS = 100;
const MAX_SESSION_ARTIFACTS = 100;
const MAX_ARTIFACT_FILES_PER_EVENT = 50;
const STREAM_RECONCILE_INTERVAL_MS = 1_000;

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

function waitForAbortableDelay(
  delayMs: number,
  signal: AbortSignal,
): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
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
  return presentExternalAgentError(error, fallback).message;
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

function sameHostEndpoint(left: string, right: string): boolean {
  try {
    return normalizeBaseUrl(left) === normalizeBaseUrl(right);
  } catch {
    return left.replace(/\/+$/, "") === right.replace(/\/+$/, "");
  }
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

function shouldPauseStream(status: ExternalAgentRunStatus): boolean {
  return isTerminal(status) || status === "waiting_approval";
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
    model: remote.model,
    mode: remote.mode,
    isolation: remote.isolation,
    cwd: remote.cwd,
    title: ref?.title || `Agent session ${remote.id.slice(0, 8)}`,
    status: ref?.status ?? "queued",
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
  if (rawType.toLowerCase() === "runner_output") return "metric";
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
    type.includes("item.started") ||
    type.includes("item.updated") ||
    type.includes("item.completed") ||
    type.includes("tool.started") ||
    type.includes("tool.updated") ||
    type.includes("tool.completed") ||
    type.includes("tool_use")
  ) {
    return "tool";
  }
  if (
    type.includes("completed") ||
    type.includes("completion") ||
    type.includes("status") ||
    type === "done"
  ) {
    return "status";
  }
  // Unknown runner wrapper events (for example runtime.started, session, and
  // message.part.updated) are diagnostics, not user-facing tool calls.
  return "metric";
}

function normalizeTimelineEvent(
  hostId: string,
  hostGeneration: number,
  sessionId: string,
  event: ExternalRemoteEvent,
): ExternalAgentTimelineEvent {
  const rawPayload = record(event.payload);
  const type = timelineType(event.type, rawPayload);
  const payload = sanitizeExternalAgentPayload(rawPayload, event.type);
  const text =
    (type === "error"
      ? presentExternalAgentError(
          event.text ??
            firstString(rawPayload, ["error", "error_message", "message"]),
        ).message
      : event.text &&
          !/https?:\/\/|set-cookie|authorization|headers?/i.test(event.text)
        ? event.text.slice(0, 24_000)
        : undefined) ||
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
  const requestType =
    firstString(payload, ["request_type", "title", "summary"]) ?? "";
  const normalizedType = requestType.toLowerCase();
  const title = normalizedType.includes("command")
    ? "Run this command?"
    : normalizedType.includes("file") ||
        normalizedType.includes("write") ||
        normalizedType.includes("edit")
      ? "Allow these changes?"
      : normalizedType.includes("network")
        ? "Allow network access?"
        : normalizedType.includes("tool") ||
            normalizedType.includes("permission")
          ? "Allow this action?"
          : "Approval needed";
  return {
    id,
    turnId: event.turnId,
    title,
    description:
      firstString(payload, ["reason", "description", "detail", "message"]) ??
      event.text,
    status,
  };
}

function isFallbackApprovalId(approval: ExternalAgentApproval): boolean {
  return approval.id.startsWith(`${approval.turnId}:`);
}

function isGenericApproval(approval: ExternalAgentApproval): boolean {
  return approval.title === "Approval needed" && !approval.description;
}

function mergeApproval(
  existing: ExternalAgentApproval,
  incoming: ExternalAgentApproval,
): ExternalAgentApproval {
  const incomingIsRicher =
    isGenericApproval(existing) && !isGenericApproval(incoming);
  return {
    id:
      (!isFallbackApprovalId(incoming) && isFallbackApprovalId(existing)) ||
      (existing.id === "0" &&
        incoming.id !== "0" &&
        !isFallbackApprovalId(incoming))
        ? incoming.id
        : existing.id,
    turnId: existing.turnId,
    title: incomingIsRicher ? incoming.title : existing.title,
    description:
      (incomingIsRicher ? incoming.description : existing.description) ??
      incoming.description,
    status: incoming.status === "pending" ? existing.status : incoming.status,
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

function timelineTerminalStatus(
  event: ExternalAgentTimelineEvent,
): ExternalAgentRunStatus | null {
  const rawType = String(event.payload.rawType ?? "").toLowerCase();
  if (
    event.type === "error" &&
    rawType !== "runner_output" &&
    (rawType === "error" ||
      rawType === "failed" ||
      rawType.endsWith(".error") ||
      rawType.endsWith("/error") ||
      rawType.endsWith(".failed") ||
      rawType.endsWith("/failed"))
  ) {
    return "failed";
  }
  if (
    event.type !== "status" ||
    ![
      "completion",
      "completed",
      "done",
      "status",
      "turn.completed",
      "turn/completed",
    ].includes(rawType)
  ) {
    return null;
  }
  for (const candidate of [event.payload.status, event.payload.state]) {
    if (typeof candidate !== "string") continue;
    const mapped = mapExternalAgentStatus(candidate, "queued");
    if (isTerminal(mapped)) return mapped;
  }
  return null;
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
      sessionRefs: Object.freeze([...this.#sessionRefs]),
      sessions: Object.freeze(
        [...this.#sessions.values()]
          .sort(
            (left, right) =>
              Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
          )
          .map((session) => ({
            ...session,
            turns: [...session.turns],
            events: [...session.events],
            approvals: [...session.approvals],
            artifacts: [...session.artifacts],
          })),
      ),
    });
  }

  get pinCredentialStatus() {
    if (isExternalAgentPinCredentialVault(this.#credentials)) {
      return this.#credentials.getStatus();
    }
    return {
      supported: false as const,
      configured: false,
      locked: false,
      persistedCredentialCount: 0,
    };
  }

  async unlockCredentials(pin: string): Promise<void> {
    if (!isExternalAgentPinCredentialVault(this.#credentials)) {
      throw new Error("PIN-protected credential storage is unavailable.");
    }
    await this.#credentials.unlock(pin);
  }

  isHostCredentialLocked(
    requestedHostId: string,
    remoteSessionId?: string,
  ): boolean {
    if (!isExternalAgentPinCredentialVault(this.#credentials)) return false;
    const hostId = remoteSessionId
      ? this.#resolveHistoricalHostId(requestedHostId, remoteSessionId)
      : requestedHostId;
    const host = this.#hosts.find((candidate) => candidate.id === hostId);
    return Boolean(
      host &&
      this.#credentials.getStatus().locked &&
      this.#credentials.hasPersistent?.(host.credentialRef),
    );
  }

  async unlockHostCredential(
    requestedHostId: string,
    pin: string,
    remoteSessionId?: string,
  ): Promise<boolean> {
    if (!isExternalAgentPinCredentialVault(this.#credentials)) {
      throw new Error("PIN-protected credential storage is unavailable.");
    }
    const hostId = remoteSessionId
      ? this.#resolveHistoricalHostId(requestedHostId, remoteSessionId)
      : requestedHostId;
    const host = this.#hosts.find((candidate) => candidate.id === hostId);
    if (
      !host ||
      (this.#credentials.hasPersistent &&
        !this.#credentials.hasPersistent(host.credentialRef))
    ) {
      throw new Error("This conversation no longer has a saved access token.");
    }
    await this.#credentials.unlock(pin);
    return this.switchHost(hostId);
  }

  lockCredentials(): void {
    if (!isExternalAgentPinCredentialVault(this.#credentials)) return;
    this.disconnect();
    this.#credentials.lock();
    this.#connectionError =
      "Saved agent credentials are locked. Enter your PIN to reconnect.";
    this.#emit();
  }

  async clearActiveHostCredential(): Promise<void> {
    const host = this.#hosts.find(
      (candidate) => candidate.id === this.#activeHostId,
    );
    if (!host) return;
    this.disconnect();
    await this.#credentials.remove(host.credentialRef);
    this.#connectionError =
      "The saved token was removed. Enter the access token to reconnect.";
    this.#emit();
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
    readonly persistencePin?: string;
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
    if (
      input.persistencePin &&
      isExternalAgentPinCredentialVault(this.#credentials)
    ) {
      await this.#credentials.putPersistent(
        credentialRef,
        token,
        input.persistencePin,
      );
    } else {
      await this.#credentials.put(credentialRef, token);
    }
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

  async reconnect(token?: string, persistencePin?: string): Promise<boolean> {
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
      if (
        persistencePin &&
        isExternalAgentPinCredentialVault(this.#credentials)
      ) {
        await this.#credentials.putPersistent(
          host.credentialRef,
          token.trim(),
          persistencePin,
        );
      } else {
        await this.#credentials.put(host.credentialRef, token.trim());
      }
      this.#assertWorkspaceLease(lease);
    }
    return this.connect(host.id, lease);
  }

  async switchHost(hostId: string): Promise<boolean> {
    const lease = this.#requireWorkspaceLease();
    const host = this.#hosts.find((candidate) => candidate.id === hostId);
    if (!host) {
      this.#connectionError = "Trusted host not found.";
      this.#emit();
      return false;
    }
    if (hostId !== this.#activeHostId) {
      const credential = await this.#credentials.resolve(host.credentialRef);
      this.#assertWorkspaceLease(lease);
      if (!credential) {
        this.#connectionError = `${host.name} needs its access token before it can be opened.`;
        this.#emit();
        return false;
      }
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
    // Readiness is an operator/deployment probe and legitimately returns 503
    // when optional hardening is unavailable. Normal users only need liveness,
    // capabilities, and at least one usable runner, so do not turn that
    // diagnostic response into a failed browser request on every connection.
    const [health, capabilities, runners] = await Promise.allSettled([
      client.health({ signal: controller.signal }),
      client.capabilities({ signal: controller.signal }),
      client.listRunners({ signal: controller.signal }),
    ]);
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
    this.#readiness = null;
    this.#capabilities =
      capabilities.status === "fulfilled" ? capabilities.value : null;
    this.#runners = runners.status === "fulfilled" ? runners.value.runners : [];
    const hasUsableRunner = this.#runners.some(
      (runner) =>
        runner.status === "available" && runner.auth_status === "ready",
    );
    const partialFailure =
      capabilities.status === "rejected" ||
      runners.status === "rejected" ||
      !hasUsableRunner;
    this.#connectionState = partialFailure ? "degraded" : "online";
    this.#connectionError = partialFailure
      ? "Host connected with limited capabilities. Retry discovery when the service is ready."
      : null;
    this.#hosts = this.#hosts.map((candidate) =>
      candidate.id === hostId
        ? { ...candidate, lastConnectedAt: nowIso() }
        : candidate,
    );
    this.#rebindEquivalentSessionRefs(hostId);
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
    const attachments = input.attachments?.length
      ? await client.stageFiles(input.attachments, {
          signal: this.#hostController?.signal,
        })
      : [];
    this.#assertGeneration(hostId, generation);
    this.#assertWorkspaceLease(lease);
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
          ...(attachments.length ? { attachments } : {}),
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
      const message = redactErrorMessage(
        error,
        "The remote session was created, but its first turn did not start.",
      );
      session.status = "failed";
      session.error = message;
      session.actionError = message;
      session.completedAt = nowIso();
      session.updatedAt = nowIso();
      this.#rememberSession(session);
      await this.#persist(lease).catch(() => undefined);
      this.#emit({ type: "session", session });
      throw error;
    }
  }

  async followUp(
    sessionId: string,
    input: string | ExternalAgentFollowUpInput,
  ): Promise<void> {
    const lease = this.#requireWorkspaceLease();
    const session = this.#requireSession(sessionId);
    const client = this.#requireSessionClient(session);
    const text =
      typeof input === "string" ? input.trim() : input.instruction.trim();
    if (!text) throw new Error("Follow-up instruction is required");
    if (!this.canFollowUp(session)) {
      throw new Error(
        "Follow-up is unavailable until this provider finishes the current turn and advertises continuation support",
      );
    }
    const settings =
      typeof input === "string"
        ? null
        : {
            cwd: input.cwd?.trim() || undefined,
            mode: input.mode,
            isolation: input.isolation,
            model: input.model?.trim() || undefined,
            confirmDangerous: input.confirmDangerous,
            attachments: input.attachments,
          };
    try {
      if (settings) {
        const validation = validateExternalAgentLaunch(this.#runners, {
          runnerId: session.runnerId,
          instruction: text,
          ...settings,
        });
        if (!validation.ok) throw new Error(validation.message);
      }
      const attachments = settings?.attachments?.length
        ? await client.stageFiles(settings.attachments, {
            signal: this.#hostController?.signal,
          })
        : [];
      this.#assertSessionGeneration(session);
      const started = await client.startTurn(
        session.remoteSessionId,
        {
          user_message: text,
          ...(attachments.length ? { attachments } : {}),
          continuation_mode: "replay",
          ...(settings
            ? {
                model: settings.model,
                mode: settings.mode,
                isolation: settings.isolation,
                cwd: settings.cwd,
              }
            : {}),
        },
        { signal: this.#hostController?.signal },
      );
      this.#assertSessionGeneration(session);
      if (settings) {
        session.model = settings.model;
        session.mode = settings.mode;
        session.isolation = settings.isolation;
        session.cwd = settings.cwd;
      }
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
      await this.#refreshTurn(session, session.activeTurnId, client, lease);
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
    requestedHostId: string,
    remoteSessionId: string,
  ): Promise<ExternalAgentSession> {
    let lease = this.#requireWorkspaceLease();
    const hostId = this.#resolveHistoricalHostId(
      requestedHostId,
      remoteSessionId,
    );
    const existing = this.getSession(remoteSessionId, hostId);
    if (existing) return existing;
    if (
      hostId !== this.#activeHostId ||
      !this.#client ||
      (this.#connectionState !== "online" &&
        this.#connectionState !== "degraded")
    ) {
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
        (candidate.hostId === hostId || candidate.hostId === requestedHostId) &&
        candidate.remoteSessionId === remoteSessionId,
    );
    const session = sessionFromRemote(hostId, generation, remote, ref);
    this.#sessions.set(this.#sessionKey(hostId, remoteSessionId), session);
    await this.#refreshSession(session, client, generation, lease);
    if (requestedHostId !== hostId) {
      this.#sessionRefs = this.#sessionRefs.filter(
        (candidate) =>
          candidate.hostId !== requestedHostId ||
          candidate.remoteSessionId !== remoteSessionId,
      );
    }
    this.#rememberSession(session);
    await this.#persist(lease);
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
    this.#assertSessionRefresh(session, generation, lease, refreshVersion);
    const turns = new Map(
      session.turns.map((turn) => [turn.id, turn] as const),
    );
    for (const turn of response.turns.slice(-MAX_REHYDRATED_TURNS)) {
      turns.set(turn.id, this.#mergeTurn(turns.get(turn.id), turn));
    }
    session.turns = [...turns.values()]
      .sort((left, right) => left.sequence - right.sequence)
      .slice(-MAX_REHYDRATED_TURNS);
    const firstInstruction = session.turns
      .find((turn) => turn.user_message?.trim())
      ?.user_message?.trim();
    if (firstInstruction && session.title.startsWith("Agent session ")) {
      session.title = firstInstruction.slice(0, 80);
    }
    const latest = session.turns.at(-1);
    if (!latest) return;
    this.#applyLatestTurn(session, latest);
    const eventTurns = session.turns.slice(-MAX_EVENT_TURNS);
    const remoteEvents: ExternalRemoteEvent[] = [];
    for (const turn of eventTurns) {
      const events = await this.#listCanonicalTurnEvents(
        client,
        session.remoteSessionId,
        turn.id,
        this.#hostController?.signal,
      );
      this.#assertSessionRefresh(session, generation, lease, refreshVersion);
      remoteEvents.push(...events);
    }
    this.#ingestRemoteEvents(session, remoteEvents);
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
    options: { persist?: boolean } = {},
  ): Promise<void> {
    const generation = session.hostGeneration;
    const refreshVersion = this.#nextSessionRefreshVersion(session);
    const turn = await client.getTurn(session.remoteSessionId, turnId, {
      signal: this.#hostController?.signal,
    });
    const terminal = isTerminal(
      mapExternalAgentStatus(turn.status, session.status),
    );
    const afterSeq = terminal
      ? 0
      : session.events
          .filter((event) => event.turnId === turnId)
          .reduce((highest, event) => Math.max(highest, event.sequence), 0);
    const events = await this.#listCanonicalTurnEvents(
      client,
      session.remoteSessionId,
      turnId,
      this.#hostController?.signal,
      afterSeq,
    );
    this.#assertSessionRefresh(session, generation, lease, refreshVersion);
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
    this.#ingestRemoteEvents(session, events);
    if (
      session.approvals.some((approval) => approval.status === "pending") &&
      !isTerminal(session.status)
    ) {
      session.status = "waiting_approval";
    }
    this.#rememberSession(session);
    if (options.persist === false) {
      this.#emit({ type: "session", session });
      return;
    }
    await this.#persist(lease);
    this.#assertSessionRefresh(session, generation, lease, refreshVersion);
  }

  #mergeTurn(
    existing: ExternalRemoteTurn | undefined,
    incoming: ExternalRemoteTurn,
  ): ExternalRemoteTurn {
    if (!existing) return incoming;
    const existingStatus = mapExternalAgentStatus(existing.status, "queued");
    const incomingStatus = mapExternalAgentStatus(incoming.status, "queued");
    if (existingStatus === "failed" && incomingStatus !== "failed") {
      return {
        ...incoming,
        status: existing.status,
        completed_at: existing.completed_at,
        final_text: existing.final_text,
        error: existing.error,
      };
    }
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

  async #listCanonicalTurnEvents(
    client: ExternalAgentClient,
    sessionId: string,
    turnId: string,
    signal?: AbortSignal,
    initialAfterSeq = 0,
  ): Promise<ExternalRemoteEvent[]> {
    const events: ExternalRemoteEvent[] = [];
    let afterSeq = initialAfterSeq;
    while (events.length < MAX_TIMELINE_EVENTS_PER_TURN) {
      const limit = Math.min(
        EVENT_PAGE_SIZE,
        MAX_TIMELINE_EVENTS_PER_TURN - events.length,
      );
      const page = await client.listTurnEvents(sessionId, turnId, {
        afterSeq,
        limit,
        signal,
      });
      if (!page.events.length) break;
      events.push(...page.events);
      const nextSeq = Math.max(...page.events.map((event) => event.seq));
      if (page.events.length < limit || nextSeq <= afterSeq) break;
      afterSeq = nextSeq;
    }
    return events.slice(0, MAX_TIMELINE_EVENTS_PER_TURN);
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
    if (latest.model !== undefined) session.model = latest.model;
    if (latest.mode !== undefined) session.mode = latest.mode;
    if (latest.isolation !== undefined) session.isolation = latest.isolation;
    if (latest.cwd !== undefined) session.cwd = latest.cwd;
    session.output = latest.final_text ?? session.output;
    session.error = latest.error
      ? presentExternalAgentError(latest.error).message
      : session.error;
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
    this.#ingestRemoteEvents(session, [remote]);
  }

  #ingestRemoteEvents(
    session: ExternalAgentSession,
    remotes: readonly ExternalRemoteEvent[],
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
    const seenIds = new Set(session.events.map((event) => event.id));
    const normalizedEvents: ExternalAgentTimelineEvent[] = [];
    for (const remote of remotes) {
      const normalized = normalizeTimelineEvent(
        session.hostId,
        session.hostGeneration,
        session.remoteSessionId,
        remote,
      );
      if (seenIds.has(normalized.id)) continue;
      seenIds.add(normalized.id);
      normalizedEvents.push(normalized);
    }
    if (!normalizedEvents.length) return;

    const retainedTurns = session.turns.slice(-MAX_EVENT_TURNS);
    const retainedTurnIds = new Set(retainedTurns.map((turn) => turn.id));
    const turnOrder = new Map(
      retainedTurns.map((turn, index) => [turn.id, index] as const),
    );
    const nextEvents = [...session.events, ...normalizedEvents].filter(
      (event) => retainedTurnIds.has(event.turnId),
    );
    const boundedByTurn = new Map<string, ExternalAgentTimelineEvent[]>();
    for (const event of nextEvents) {
      const events = boundedByTurn.get(event.turnId) ?? [];
      events.push(event);
      boundedByTurn.set(event.turnId, events);
    }
    session.events = [...boundedByTurn.entries()]
      .flatMap(([turnId, events]) =>
        events
          .sort(
            (left, right) =>
              left.sequence - right.sequence || left.id.localeCompare(right.id),
          )
          .slice(-MAX_TIMELINE_EVENTS_PER_TURN)
          .map((event) => ({ turnId, event })),
      )
      .sort(
        (left, right) =>
          (turnOrder.get(left.turnId) ?? Number.MAX_SAFE_INTEGER) -
            (turnOrder.get(right.turnId) ?? Number.MAX_SAFE_INTEGER) ||
          left.event.sequence - right.event.sequence ||
          left.event.id.localeCompare(right.event.id),
      )
      .map(({ event }) => event);

    for (const normalized of normalizedEvents) {
      const approval = approvalFromEvent(normalized);
      if (approval) {
        let index = session.approvals.findIndex(
          (item) => item.id === approval.id,
        );
        if (index < 0) {
          index = session.approvals.findLastIndex(
            (item) =>
              item.turnId === approval.turnId &&
              item.status === "pending" &&
              approval.status === "pending" &&
              (isFallbackApprovalId(item) ||
                isFallbackApprovalId(approval) ||
                item.id === "0" ||
                approval.id === "0" ||
                isGenericApproval(item) ||
                isGenericApproval(approval)),
          );
        }
        if (index >= 0) {
          session.approvals[index] = mergeApproval(
            session.approvals[index]!,
            approval,
          );
        } else session.approvals.push(approval);
        session.approvals = session.approvals.slice(-MAX_SESSION_APPROVALS);
        if (approval.status === "pending" && !isTerminal(session.status)) {
          session.status = "waiting_approval";
        }
      }

      for (const artifact of artifactsFromEvent(normalized)) {
        const index = session.artifacts.findIndex(
          (item) =>
            item.id === artifact.id ||
            (item.turnId === artifact.turnId &&
              item.kind === artifact.kind &&
              item.artifactId === artifact.artifactId &&
              item.label === artifact.label &&
              item.content === artifact.content),
        );
        if (index >= 0) session.artifacts[index] = artifact;
        else session.artifacts.push(artifact);
      }
      session.artifacts = session.artifacts.slice(-MAX_SESSION_ARTIFACTS);
      if (normalized.type === "error") {
        session.error = presentExternalAgentError(normalized.text).message;
      }
      const terminalStatus = timelineTerminalStatus(normalized);
      if (terminalStatus) {
        const turnIndex = session.turns.findIndex(
          (turn) => turn.id === normalized.turnId,
        );
        const existingTurn = turnIndex >= 0 ? session.turns[turnIndex] : null;
        const existingStatus = existingTurn
          ? mapExternalAgentStatus(existingTurn.status, "queued")
          : null;
        const preserveFailure =
          existingStatus === "failed" && terminalStatus !== "failed";
        if (existingTurn && !preserveFailure) {
          session.turns[turnIndex] = {
            ...existingTurn,
            status: terminalStatus,
            completed_at:
              existingTurn.completed_at ?? Date.parse(normalized.occurredAt),
            error:
              terminalStatus === "failed"
                ? (normalized.text ?? existingTurn.error)
                : existingTurn.error,
          };
        }
        if (
          session.activeTurnId === normalized.turnId &&
          !(session.status === "failed" && terminalStatus !== "failed")
        ) {
          session.status = terminalStatus;
          session.completedAt ??= normalized.occurredAt;
        }
      }
      if (Date.parse(normalized.occurredAt) >= Date.parse(session.updatedAt)) {
        session.updatedAt = normalized.occurredAt;
      }
      this.#emit({ type: "timeline", session, event: normalized });
    }
  }

  #startStream(session: ExternalAgentSession, turnId: string): void {
    const client = this.#client;
    if (!client) return;
    if (shouldPauseStream(session.status)) {
      session.streamState = "idle";
      this.#emit({ type: "session", session });
      return;
    }
    const lease = this.#requireWorkspaceLease();
    const key = this.#sessionKey(session.hostId, session.remoteSessionId);
    this.#streamControllers.get(key)?.abort();
    const controller = new AbortController();
    this.#streamControllers.set(key, controller);
    const finishStream = () => {
      controller.abort();
      if (this.#streamControllers.get(key) === controller) {
        this.#streamControllers.delete(key);
      }
    };
    const generation = session.hostGeneration;
    const afterSeq = session.events
      .filter((event) => event.turnId === turnId)
      .reduce((max, event) => Math.max(max, event.sequence), 0);
    session.streamState = "connecting";
    this.#emit({ type: "session", session });

    void (async () => {
      while (
        await waitForAbortableDelay(
          STREAM_RECONCILE_INTERVAL_MS,
          controller.signal,
        )
      ) {
        if (
          generation !== this.#generation ||
          session.hostId !== this.#activeHostId ||
          !this.#isWorkspaceLeaseCurrent(lease) ||
          this.#sessions.get(key) !== session
        ) {
          finishStream();
          return;
        }
        try {
          await this.#refreshTurn(session, turnId, client, lease, {
            persist: false,
          });
        } catch (error) {
          if (controller.signal.aborted || this.#isStaleResponseError(error)) {
            return;
          }
          // The live stream remains authoritative when a best-effort
          // reconciliation poll is temporarily unavailable.
          continue;
        }
        if (shouldPauseStream(session.status)) {
          session.streamState = "idle";
          this.#emit({ type: "session", session });
          void this.#persist(lease).catch(() => undefined);
          finishStream();
          return;
        }
      }
    })();

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
          if (shouldPauseStream(session.status)) break;
          if (streamEvent.event === "done") {
            await this.#refreshTurn(session, turnId, client, lease);
          }
        }
        if (!controller.signal.aborted) {
          await this.#refreshTurn(session, turnId, client, lease);
          session.streamState = shouldPauseStream(session.status)
            ? "idle"
            : "disconnected";
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
        if (controller.signal.aborted || shouldPauseStream(session.status)) {
          finishStream();
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

  #resolveHistoricalHostId(
    requestedHostId: string,
    remoteSessionId: string,
  ): string {
    if (requestedHostId === this.#activeHostId) return requestedHostId;
    const activeHost = this.#hosts.find(
      (candidate) => candidate.id === this.#activeHostId,
    );
    const requestedHost = this.#hosts.find(
      (candidate) => candidate.id === requestedHostId,
    );
    if (
      activeHost &&
      requestedHost &&
      sameHostEndpoint(activeHost.baseUrl, requestedHost.baseUrl)
    ) {
      return activeHost.id;
    }
    if (!requestedHost) {
      const candidates = new Set(
        this.#sessionRefs
          .filter(
            (candidate) =>
              candidate.remoteSessionId === remoteSessionId &&
              this.#hosts.some((host) => host.id === candidate.hostId),
          )
          .map((candidate) => candidate.hostId),
      );
      if (candidates.size === 1) return [...candidates][0]!;
    }
    return requestedHostId;
  }

  #rebindEquivalentSessionRefs(hostId: string): void {
    const host = this.#hosts.find((candidate) => candidate.id === hostId);
    if (!host) return;
    const equivalentHostIds = new Set(
      this.#hosts
        .filter((candidate) =>
          sameHostEndpoint(candidate.baseUrl, host.baseUrl),
        )
        .map((candidate) => candidate.id),
    );
    if (equivalentHostIds.size < 2) return;

    const rebound = new Map<string, ExternalAgentSessionRef>();
    for (const ref of this.#sessionRefs) {
      const next =
        equivalentHostIds.has(ref.hostId) && ref.hostId !== hostId
          ? { ...ref, hostId }
          : ref;
      const key = this.#sessionKey(next.hostId, next.remoteSessionId);
      const previous = rebound.get(key);
      if (
        !previous ||
        Date.parse(next.updatedAt ?? "") > Date.parse(previous.updatedAt ?? "")
      ) {
        rebound.set(key, next);
      }
    }
    this.#sessionRefs = [...rebound.values()];
  }

  #rememberSession(session: ExternalAgentSession): void {
    const ref: ExternalAgentSessionRef = {
      hostId: session.hostId,
      remoteSessionId: session.remoteSessionId,
      title: session.title,
      runnerId: session.runnerId,
      updatedAt: session.updatedAt,
      status: session.status,
      pendingApprovalCount: session.approvals.filter(
        (approval) => approval.status === "pending",
      ).length,
      preview: (session.output ?? session.turns.at(-1)?.user_message)?.slice(
        0,
        240,
      ),
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
