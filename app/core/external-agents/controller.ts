import {
  buildExternalAgentRunnerOptions,
  runnerUsability,
  validateExternalAgentLaunch,
} from "./launcher";
import { presentExternalAgentError } from "./presentation";
import { isExternalAgentPinCredentialVault } from "./credentials";
import { ExternalAgentConnectionSupervisor } from "./connection-supervisor";
import {
  ExternalAgentEventStore,
  isTerminal,
  mapExternalAgentStatus,
  MAX_EVENT_TURNS,
  remoteDate,
  shouldPauseStream,
} from "./event-store";
import { RunsClientError } from "./runs-client";
import {
  ExternalAgentHostRegistry,
  fallbackExternalAgentHostId,
  normalizeExternalAgentBaseUrl,
  sameExternalAgentEndpoint,
} from "./host-registry";
import { ExternalAgentPersistenceAdapter } from "./persistence-adapter";
import { ExternalAgentSnapshotPublisher } from "./snapshot-publisher";
import {
  ExternalAgentSessionRepository,
  MAX_EXTERNAL_AGENT_SESSION_REFS,
} from "./session-repository";
import { ExternalAgentTurnCommandService } from "./turn-command-service";
import type {
  ExternalAgentClient,
  ExternalAgentClientFactory,
  ExternalAgentCredentialVault,
  ExternalAgentAttachment,
  ExternalAgentDriver,
  ExternalAgentDriverDetector,
  ExternalAgentFollowUpInput,
  ExternalAgentHost,
  ExternalAgentLaunchInput,
  ExternalAgentPersistence,
  ExternalAgentPersistenceLease,
  ExternalAgentPersistenceSnapshot,
  ExternalAgentSession,
  ExternalAgentSessionRef,
  ExternalAgentStoreEvent,
  ExternalAgentStoreSnapshot,
  ExternalRemoteEvent,
  ExternalRemoteSession,
  ExternalRemoteTurn,
} from "./types";

export { mapExternalAgentStatus } from "./event-store";

const MAX_EAGER_REHYDRATED_SESSIONS = 20;
const REHYDRATE_CONCURRENCY = 4;
const MAX_REHYDRATED_TURNS = 20;

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

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
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
    model: remote.model ?? ref?.model,
    thinkingLevel: ref?.thinkingLevel,
    activeTurnId: ref?.activeTurnId,
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

export interface ExternalAgentControllerOptions {
  readonly persistence: ExternalAgentPersistence;
  readonly credentials: ExternalAgentCredentialVault;
  readonly createClient: ExternalAgentClientFactory;
  readonly detectDriver?: ExternalAgentDriverDetector;
  readonly getWorkspaceScope: () => string | null | undefined;
}

export class ExternalAgentController {
  readonly #persistence: ExternalAgentPersistence;
  readonly #credentials: ExternalAgentCredentialVault;
  readonly #createClient: ExternalAgentClientFactory;
  readonly #detectDriver?: ExternalAgentDriverDetector;
  readonly #getWorkspaceScope: () => string | null | undefined;
  readonly #publisher: ExternalAgentSnapshotPublisher;
  readonly #hostRegistry = new ExternalAgentHostRegistry();
  readonly #sessions = new ExternalAgentSessionRepository();
  readonly #events = new ExternalAgentEventStore();
  readonly #connections = new ExternalAgentConnectionSupervisor();
  readonly #commands = new ExternalAgentTurnCommandService();
  readonly #persistenceAdapter = new ExternalAgentPersistenceAdapter();
  #client: ExternalAgentClient | null = null;
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
  #cloudHostReconcileGeneration = 0;
  #disposed = false;

  constructor(options: ExternalAgentControllerOptions) {
    this.#persistence = options.persistence;
    this.#credentials = options.credentials;
    this.#createClient = options.createClient;
    this.#detectDriver = options.detectDriver;
    this.#getWorkspaceScope = options.getWorkspaceScope;
    this.#publisher = new ExternalAgentSnapshotPublisher(() =>
      this.#createSnapshot(),
    );
  }

  get snapshot(): ExternalAgentStoreSnapshot {
    return this.#publisher.snapshot;
  }

  get #hosts(): readonly ExternalAgentHost[] {
    return this.#hostRegistry.hosts;
  }

  set #hosts(hosts: ExternalAgentHost[]) {
    this.#hostRegistry.replace(hosts);
  }

  get #activeHostId(): string | null {
    return this.#hostRegistry.activeHostId;
  }

  set #activeHostId(hostId: string | null) {
    this.#hostRegistry.setActive(hostId);
  }

  #createSnapshot(): ExternalAgentStoreSnapshot {
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
      sessionRefs: Object.freeze([...this.#sessions.refs]),
      sessions: Object.freeze(
        this.#sessions
          .values()
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
    return this.#publisher.subscribe(listener);
  }

  #emit(event?: Exclude<ExternalAgentStoreEvent, { type: "snapshot" }>) {
    this.#publisher.publish(event);
  }

  async initialize(workspaceId?: string): Promise<void> {
    await this.#loadWorkspace(this.#resolveWorkspaceId(workspaceId));
  }

  async reloadWorkspace(workspaceId?: string): Promise<void> {
    await this.#loadWorkspace(this.#resolveWorkspaceId(workspaceId));
  }

  async #loadWorkspace(workspaceId: string): Promise<void> {
    if (this.#disposed) return;
    this.#cloudHostReconcileGeneration += 1;
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
    this.#sessions.reset();
    this.#hosts = [];
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
    this.#sessions.reset(snapshot.sessionRefs);
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
    readonly activate?: boolean;
  }): Promise<ExternalAgentHost> {
    const lease = this.#requireWorkspaceLease();
    const baseUrl = normalizeExternalAgentBaseUrl(input.baseUrl);
    const token = input.token.trim();
    if (!token) throw new Error("An access token is required");
    const credentialRef = randomId("agent-credential");
    let temporary: ExternalAgentHost = {
      id: fallbackExternalAgentHostId(baseUrl),
      name: input.name.trim() || fallbackExternalAgentHostId(baseUrl),
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
      const driver = this.#detectDriver
        ? await this.#detectDriver({
            baseUrl,
            resolveCredential: () => this.#credentials.resolve(credentialRef),
          })
        : "intern";
      temporary = { ...temporary, driver };
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
    if (input.activate !== false || !this.#activeHostId) {
      this.#activeHostId = id;
    }
    await this.#persist(lease);
    this.#assertWorkspaceLease(lease);
    if (this.#activeHostId === id) {
      await this.connect(id, lease);
    } else {
      this.#emit();
    }
    return host;
  }

  /**
   * Restores an account-bound OR3 Cloud computer without making availability
   * a prerequisite for appearing in history. The cloud control plane has
   * already authenticated and authorized this host; health is reflected by
   * the normal connection state after it is selected.
   */
  async restoreCloudHost(input: {
    readonly environmentId: string;
    readonly name: string;
    readonly baseUrl: string;
    readonly token: string;
    readonly driver?: ExternalAgentDriver;
    readonly runtime?: "intern" | "openclaw" | "hermes";
    readonly activate?: boolean;
  }): Promise<ExternalAgentHost> {
    const lease = this.#requireWorkspaceLease();
    const environmentId = input.environmentId.trim();
    const token = input.token.trim();
    if (!environmentId || !token) {
      throw new Error("Cloud computer details are incomplete.");
    }
    const baseUrl = normalizeExternalAgentBaseUrl(input.baseUrl);
    const id = `or3-connect:${environmentId}`;
    const previous =
      this.#hostRegistry.find(id) ?? this.#hostRegistry.findByEndpoint(baseUrl);
    const previousWasActive = previous?.id === this.#activeHostId;
    const credentialRef =
      previous?.credentialRef ?? `or3-connect-credential:${environmentId}`;
    await this.#credentials.put(credentialRef, token);
    this.#assertWorkspaceLease(lease);
    const host: ExternalAgentHost = {
      id,
      name: input.name.trim() || previous?.name || environmentId,
      baseUrl,
      credentialRef,
      driver: input.driver,
      runtime: input.runtime,
      trustedAt: previous?.trustedAt ?? nowIso(),
      lastConnectedAt: previous?.lastConnectedAt,
    };
    this.#hosts = [
      ...this.#hosts.filter(
        (candidate) =>
          candidate.id !== id &&
          !sameExternalAgentEndpoint(candidate.baseUrl, baseUrl),
      ),
      host,
    ];
    if (previous && previous.credentialRef !== credentialRef) {
      await this.#credentials.remove(previous.credentialRef);
      this.#assertWorkspaceLease(lease);
    }
    if (input.activate === true || !this.#activeHostId) {
      this.#activeHostId = id;
    } else if (previousWasActive) {
      this.#activeHostId = id;
    }
    await this.#persist(lease);
    this.#assertWorkspaceLease(lease);
    if (this.#activeHostId === id) {
      await this.connect(id, lease);
    } else {
      this.#emit();
    }
    return host;
  }

  async reconcileCloudHosts(
    expectedWorkspaceId: string,
    environments: readonly {
      readonly environmentId: string;
      readonly name: string;
      readonly baseUrl: string;
      readonly token: string;
      readonly driver?: ExternalAgentDriver;
      readonly runtime?: "intern" | "openclaw" | "hermes";
    }[],
  ): Promise<void> {
    const lease = this.#requireWorkspaceLease();
    const workspaceId = expectedWorkspaceId.trim() || "local";
    if (lease.workspaceId !== workspaceId) {
      throw this.#staleWorkspaceError();
    }
    const reconcileGeneration = ++this.#cloudHostReconcileGeneration;
    const assertCurrent = () => {
      this.#assertWorkspaceLease(lease);
      if (reconcileGeneration !== this.#cloudHostReconcileGeneration) {
        throw this.#staleWorkspaceError();
      }
    };
    const malformedCloudIds = new Set<string>();
    const normalized: Array<{
      environmentId: string;
      name: string;
      baseUrl: string;
      token: string;
      driver?: ExternalAgentDriver;
      runtime?: "intern" | "openclaw" | "hermes";
    }> = [];
    const seenCloudIds = new Set<string>();
    let malformedCloudCount = 0;
    for (const environment of environments) {
      const environmentId = environment.environmentId.trim();
      try {
        const token = environment.token.trim();
        if (!environmentId || !token) {
          throw new Error("missing environment identity or credential");
        }
        if (seenCloudIds.has(environmentId)) {
          throw new Error("duplicate environment identity");
        }
        if (
          environment.driver !== undefined &&
          environment.driver !== "intern" &&
          environment.driver !== "runs"
        ) {
          throw new Error("unknown connection driver");
        }
        if (
          environment.runtime !== undefined &&
          environment.runtime !== "intern" &&
          environment.runtime !== "openclaw" &&
          environment.runtime !== "hermes"
        ) {
          throw new Error("unknown runtime identity");
        }
        if (
          (environment.runtime === "intern" &&
            environment.driver === "runs") ||
          (environment.runtime !== undefined &&
            environment.runtime !== "intern" &&
            environment.driver !== "runs")
        ) {
          throw new Error("runtime and driver do not match");
        }
        const baseUrl = normalizeExternalAgentBaseUrl(environment.baseUrl);
        if (environment.runtime === "openclaw" && !baseUrl.endsWith("/or3")) {
          throw new Error("OpenClaw host URL is missing /or3/");
        }
        if (
          environment.runtime === "hermes" &&
          new URL(baseUrl).pathname !== "/"
        ) {
          throw new Error("Hermes host URL must use the root path");
        }
        seenCloudIds.add(environmentId);
        normalized.push({
          environmentId,
          name: environment.name.trim() || environmentId,
          baseUrl,
          token,
          driver: environment.driver,
          runtime: environment.runtime,
        });
      } catch (error) {
        malformedCloudCount += 1;
        if (environmentId) malformedCloudIds.add(environmentId);
        console.warn(
          `[external-agents] skipped malformed cloud host${
            environmentId ? ` ${environmentId}` : ""
          }: ${error instanceof Error ? error.message : "invalid record"}`,
        );
      }
    }

    const previousCloudHosts = this.#hosts.filter((host) =>
      host.id.startsWith("or3-connect:"),
    );
    const previousById = new Map(
      previousCloudHosts.map((host) => [host.id, host] as const),
    );
    const nextCloudHosts: ExternalAgentHost[] = [];
    for (const environment of normalized) {
      const id = `or3-connect:${environment.environmentId}`;
      const previous = previousById.get(id);
      const credentialRef =
        previous?.credentialRef ??
        `or3-connect-credential:${environment.environmentId}`;
      await this.#credentials.put(credentialRef, environment.token);
      assertCurrent();
      nextCloudHosts.push({
        id,
        name: environment.name,
        baseUrl: environment.baseUrl,
        credentialRef,
        driver: environment.driver,
        runtime: environment.runtime,
        trustedAt: previous?.trustedAt ?? nowIso(),
        lastConnectedAt: previous?.lastConnectedAt,
      });
    }
    assertCurrent();

    const retainedMalformedCloudHosts = previousCloudHosts.filter(
      (host) =>
        !nextCloudHosts.some((candidate) => candidate.id === host.id) &&
        malformedCloudIds.has(host.id.slice("or3-connect:".length)),
    );
    const cloudHosts = [...nextCloudHosts, ...retainedMalformedCloudHosts];
    const nextCloudIds = new Set(cloudHosts.map((host) => host.id));
    const missingCloudHosts = previousCloudHosts.filter(
      (host) => !nextCloudIds.has(host.id),
    );
    const directHosts = this.#hosts.filter(
      (host) => !host.id.startsWith("or3-connect:"),
    );
    const previousActiveHost = this.#hosts.find(
      (host) => host.id === this.#activeHostId,
    );
    let nextActiveHostId = this.#activeHostId;
    if (
      nextActiveHostId?.startsWith("or3-connect:") &&
      !nextCloudIds.has(nextActiveHostId)
    ) {
      nextActiveHostId = cloudHosts[0]?.id ?? null;
    } else if (!nextActiveHostId) {
      nextActiveHostId = cloudHosts[0]?.id ?? null;
    }
    const nextActiveHost = [...directHosts, ...cloudHosts].find(
      (host) => host.id === nextActiveHostId,
    );
    const activeHostChanged = nextActiveHostId !== this.#activeHostId;
    const activeEndpointChanged =
      Boolean(previousActiveHost && nextActiveHost) &&
      previousActiveHost!.baseUrl !== nextActiveHost!.baseUrl;
    const activeRuntimeChanged =
      Boolean(previousActiveHost && nextActiveHost) &&
      (previousActiveHost!.driver !== nextActiveHost!.driver ||
        previousActiveHost!.runtime !== nextActiveHost!.runtime);
    if (activeHostChanged || activeEndpointChanged || activeRuntimeChanged) {
      this.#abortActiveWork();
      this.#generation += 1;
      this.#client = null;
      this.#connectionState = "disconnected";
      this.#connectionError = null;
      this.#health = null;
      this.#readiness = null;
      this.#capabilities = null;
      this.#runners = [];
    }
    this.#hosts = [...directHosts, ...cloudHosts];
    this.#activeHostId = nextActiveHostId;
    if (malformedCloudCount && !normalized.length && !nextActiveHost) {
      this.#connectionError =
        "Cloud host details were incomplete, so no new cloud hosts were loaded.";
    }
    await this.#persist(lease);
    assertCurrent();

    for (const host of missingCloudHosts) {
      await this.#credentials.remove(host.credentialRef);
      assertCurrent();
    }

    const shouldReconnectCloudHost =
      nextActiveHost?.id.startsWith("or3-connect:") &&
      (activeHostChanged ||
        activeEndpointChanged ||
        activeRuntimeChanged ||
        this.#connectionState === "disconnected" ||
        this.#connectionState === "offline");
    if (shouldReconnectCloudHost && nextActiveHost) {
      await this.connect(nextActiveHost.id, lease);
      return;
    }
    this.#emit();
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
    this.#cloudHostReconcileGeneration += 1;
    this.#workspaceLease = null;
    this.#client = null;
    this.#publisher.dispose();
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
    this.#sessions.deleteHost(hostId);
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
    const controller = this.#connections.beginHostRequest();
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
      (runner) => runnerUsability(runner).usable,
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
    const refs = this.#sessions.refsForHost(hostId);
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
            limit: MAX_EXTERNAL_AGENT_SESSION_REFS,
          },
          { signal: this.#connections.hostSignal },
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
          this.#connections.hostSignal?.aborted
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
              signal: this.#connections.hostSignal,
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
          this.#sessions.set(session);
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
    const latestStatus = session.turns.at(-1)?.status;
    return (
      this.#canActOnSession(session) &&
      this.#runnerChatCapability(session, "cancel") &&
      Boolean(session.activeTurnId) &&
      !isTerminal(session.status) &&
      !isTerminal(mapExternalAgentStatus(latestStatus, session.status)) &&
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
    const latestStatus = mapExternalAgentStatus(
      session.turns.at(-1)?.status,
      session.status,
    );
    if (
      !this.#canActOnSession(session) ||
      (!isTerminal(session.status) && !isTerminal(latestStatus)) ||
      !session.turns.length
    ) {
      return false;
    }
    const runner = this.#runners.find(
      (candidate) => candidate.id === session.runnerId,
    );
    if (!runner || !runnerUsability(runner).usable) {
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
    const effectiveInput = validation.input;
    const client = this.#requireClient();
    const hostId = this.#activeHostId!;
    const generation = this.#generation;
    const instruction = effectiveInput.instruction.trim();
    const attachments = effectiveInput.attachments?.length
      ? await this.#commands.stageFiles(
          client,
          effectiveInput.attachments,
          this.#connections.hostSignal,
        )
      : [];
    let attachmentsTransferred = false;
    let session: ExternalAgentSession | undefined;
    try {
      this.#assertGeneration(hostId, generation);
      this.#assertWorkspaceLease(lease);
      const appSessionKey = `${this.#workspaceSessionPrefix(true, lease)}${randomId("session")}`;
      const remote = await this.#commands.createSession(
        client,
        {
          app_session_key: appSessionKey,
          runner_id: effectiveInput.runnerId,
          continuation_mode: effectiveInput.continuationMode ?? "replay",
          model: effectiveInput.model?.trim() || undefined,
          mode: effectiveInput.mode,
          isolation: effectiveInput.isolation,
          cwd: effectiveInput.cwd?.trim() || undefined,
        },
        this.#connections.hostSignal,
      );
      this.#assertGeneration(hostId, generation);
      this.#assertWorkspaceLease(lease);
      session = sessionFromRemote(hostId, generation, remote, {
        hostId,
        remoteSessionId: remote.id,
        title: instruction.slice(0, 80),
        runnerId: effectiveInput.runnerId,
      });
      session.model = effectiveInput.model?.trim() || remote.model;
      session.thinkingLevel =
        effectiveInput.thinkingLevel?.toLowerCase().trim() || undefined;
      this.#sessions.set(session);
      this.#rememberSession(session);
      await this.#persist(lease);
      this.#assertWorkspaceLease(lease);
      this.#emit({ type: "session", session });

      const started = await this.#commands.startTurn(
        client,
        remote.id,
        {
          user_message: instruction,
          ...(attachments.length ? { attachments } : {}),
          continuation_mode: effectiveInput.continuationMode ?? "replay",
          model: effectiveInput.model?.trim() || undefined,
          thinking_level:
            effectiveInput.thinkingLevel?.toLowerCase().trim() || undefined,
          mode: effectiveInput.mode,
          isolation: effectiveInput.isolation,
          cwd: effectiveInput.cwd?.trim() || undefined,
        },
        this.#connections.hostSignal,
      );
      attachmentsTransferred = true;
      this.#commands.releaseFiles(client, attachments);
      this.#assertGeneration(hostId, generation);
      session.activeTurnId = started.turn_id;
      const startedStatus = mapExternalAgentStatus(started.status, "queued");
      session.status = startedStatus;
      session.updatedAt = nowIso();
      session.actionError = undefined;
      await this.#refreshTurn(session, started.turn_id, client, lease);
      this.#finalizeTerminalStart(session, startedStatus);
      this.#emit({ type: "session", session });
      if (!isTerminal(session.status)) this.#startStream(session, started.turn_id);
      return session;
    } catch (error) {
      if (!attachmentsTransferred && attachments.length) {
        this.#commands.releaseFiles(client, attachments);
      }
      if (this.#isStaleResponseError(error)) throw error;
      const message = redactErrorMessage(
        error,
        "The remote session was created, but its first turn did not start.",
      );
      if (session) {
        session.status = "failed";
        session.error = message;
        session.actionError = message;
        session.completedAt = nowIso();
        session.updatedAt = nowIso();
        this.#rememberSession(session);
        await this.#persist(lease).catch(() => undefined);
        this.#emit({ type: "session", session });
      }
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
    const isSlashCommand = /^\/\S+(?:\s|$)/u.test(text);
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
            thinkingLevel:
              input.thinkingLevel?.toLowerCase().trim() || undefined,
            confirmDangerous: input.confirmDangerous,
            attachments: input.attachments,
          };
    let attachments: readonly ExternalAgentAttachment[] = [];
    let attachmentsTransferred = false;
    try {
      if (settings) {
        const validation = validateExternalAgentLaunch(this.#runners, {
          runnerId: session.runnerId,
          instruction: text,
          ...settings,
        });
        if (!validation.ok) throw new Error(validation.message);
        settings.model = validation.input.model?.trim() || undefined;
        settings.thinkingLevel =
          validation.input.thinkingLevel?.toLowerCase().trim() || undefined;
      }
      attachments = settings?.attachments?.length
        ? await this.#commands.stageFiles(
            client,
            settings.attachments,
            this.#connections.hostSignal,
          )
        : [];
      this.#assertSessionGeneration(session);
      const started = await this.#commands.startTurn(
        client,
        session.remoteSessionId,
        {
          user_message: text,
          ...(attachments.length ? { attachments } : {}),
          continuation_mode: "replay",
          ...(settings
            ? {
                ...(isSlashCommand
                  ? {}
                  : {
                      model: settings.model,
                      thinking_level: settings.thinkingLevel,
                    }),
                mode: settings.mode,
                isolation: settings.isolation,
                cwd: settings.cwd,
              }
            : {}),
        },
        this.#connections.hostSignal,
      );
      attachmentsTransferred = true;
      this.#commands.releaseFiles(client, attachments);
      this.#assertSessionGeneration(session);
      if (settings && !isSlashCommand) {
        session.model = settings.model;
        session.thinkingLevel = settings.thinkingLevel;
        session.mode = settings.mode;
        session.isolation = settings.isolation;
        session.cwd = settings.cwd;
      }
      session.activeTurnId = started.turn_id;
      const startedStatus = mapExternalAgentStatus(started.status, "queued");
      session.status = startedStatus;
      session.actionError = undefined;
      session.error = undefined;
      session.completedAt = undefined;
      session.updatedAt = nowIso();
      await this.#refreshTurn(session, started.turn_id, client, lease);
      this.#finalizeTerminalStart(session, startedStatus);
      this.#emit({ type: "session", session });
      if (!isTerminal(session.status)) this.#startStream(session, started.turn_id);
    } catch (error) {
      if (!attachmentsTransferred && attachments.length) {
        this.#commands.releaseFiles(client, attachments);
      }
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
    // The remote stop can synchronously deliver run.cancelled over SSE. That
    // terminal event clears session.activeTurnId while this request is still
    // awaiting its response, so keep the accepted turn id stable for both the
    // stop and the authoritative status refresh.
    const turnId = session.activeTurnId;
    const previousStatus = session.status;
    try {
      await this.#commands.cancel(
        client,
        session.remoteSessionId,
        turnId,
        this.#connections.hostSignal,
      );
      this.#assertSessionGeneration(session);
      session.actionError = undefined;
      await this.#refreshTurn(session, turnId, client, lease);
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
      await this.#commands.decide(
        client,
        session.remoteSessionId,
        turnId,
        decision === "approve" ? "approve" : "reject",
        { note },
        this.#connections.hostSignal,
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
      const remote = await this.#commands.readArtifact(
        client,
        artifact.artifactId,
        session.appSessionKey,
        this.#connections.hostSignal,
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
    // A remote session id is only unique within a host. Never fall back to a
    // different host (or to an inactive host when no host is selected): doing
    // so can relabel an old session with the active runtime and dispatch an
    // action to the wrong agent service.
    return hostId ? this.#sessions.get(hostId, remoteSessionId) : undefined;
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
    let existing = this.getSession(remoteSessionId, hostId);
    const activeHostReady = () =>
      hostId === this.#activeHostId &&
      Boolean(this.#client) &&
      (this.#connectionState === "online" ||
        this.#connectionState === "degraded");
    if (
      existing &&
      activeHostReady() &&
      existing.hostGeneration === this.#generation
    )
      return existing;
    if (!activeHostReady()) {
      const connected = await this.switchHost(hostId);
      if (!connected) throw new Error("Could not reconnect session host");
      lease = this.#requireWorkspaceLease();
      existing = this.getSession(remoteSessionId, hostId);
      if (existing?.hostGeneration === this.#generation) return existing;
    }
    const client = this.#requireClient();
    const generation = this.#generation;
    const remote = await client.getSession(remoteSessionId, {
      signal: this.#connections.hostSignal,
    });
    this.#assertGeneration(hostId, generation);
    this.#assertWorkspaceLease(lease);
    const ref = this.#sessions.refs.find(
      (candidate) =>
        (candidate.hostId === hostId || candidate.hostId === requestedHostId) &&
        candidate.remoteSessionId === remoteSessionId,
    );
    const session = sessionFromRemote(hostId, generation, remote, ref);
    this.#sessions.set(session);
    await this.#refreshSession(session, client, generation, lease);
    if (requestedHostId !== hostId) {
      this.#sessions.removeRef(requestedHostId, remoteSessionId);
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
      throw new Error("Connect a trusted agent service first");
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
      signal: this.#connections.hostSignal,
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
    for (const turn of eventTurns) {
      const events = await this.#events.listCanonicalTurnEvents(
        client,
        session.remoteSessionId,
        turn.id,
        this.#connections.hostSignal,
      );
      this.#assertSessionRefresh(session, generation, lease, refreshVersion);
      for (const event of events) {
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
    options: { persist?: boolean } = {},
  ): Promise<void> {
    const generation = session.hostGeneration;
    const refreshVersion = this.#nextSessionRefreshVersion(session);
    let turn: ExternalRemoteTurn;
    try {
      turn = await client.getTurn(session.remoteSessionId, turnId, {
        signal: this.#connections.hostSignal,
      });
    } catch (error) {
      if (!(error instanceof RunsClientError && error.status === 404))
        throw error;
      this.#assertSessionRefresh(session, generation, lease, refreshVersion);
      this.#finalizeMissingTurn(session, turnId);
      this.#rememberSession(session);
      if (options.persist === false) {
        this.#emit({ type: "session", session });
        return;
      }
      await this.#persist(lease);
      this.#assertSessionRefresh(session, generation, lease, refreshVersion);
      return;
    }
    const terminal = isTerminal(
      mapExternalAgentStatus(turn.status, session.status),
    );
    const afterSeq = terminal
      ? 0
      : this.#events.highestSequence(session, turnId);
    const events = await this.#events.listCanonicalTurnEvents(
      client,
      session.remoteSessionId,
      turnId,
      this.#connections.hostSignal,
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
    for (const event of events) {
      this.#ingestRemoteEvent(session, event);
    }
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

  #applyLatestTurn(
    session: ExternalAgentSession,
    latest: ExternalRemoteTurn,
  ): void {
    const nextStatus = mapExternalAgentStatus(latest.status, session.status);
    const preserveTerminal =
      session.activeTurnId === latest.id &&
      isTerminal(session.status) &&
      !isTerminal(nextStatus);
    session.activeTurnId = isTerminal(nextStatus) ? undefined : latest.id;
    if (!preserveTerminal) session.status = nextStatus;
    if (latest.model !== undefined) session.model = latest.model;
    if (latest.thinking_level !== undefined) {
      session.thinkingLevel = latest.thinking_level;
    }
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
    return this.#sessions.nextRefreshVersion(session);
  }

  #assertSessionRefresh(
    session: ExternalAgentSession,
    generation: number,
    lease: ExternalAgentWorkspaceLease,
    refreshVersion: number,
  ): void {
    this.#assertGeneration(session.hostId, generation);
    this.#assertWorkspaceLease(lease);
    if (!this.#sessions.isRefreshCurrent(session, refreshVersion)) {
      throw Object.assign(new Error("Ignored stale session response"), {
        code: "stale_session",
      });
    }
  }

  #ingestRemoteEvent(
    session: ExternalAgentSession,
    remote: ExternalRemoteEvent,
  ): void {
    this.#events.ingest({
      session,
      remote,
      isCurrent: () =>
        session.hostGeneration === this.#generation &&
        session.hostId === this.#activeHostId &&
        this.#sessions.isCurrent(session),
      emit: (event) => this.#emit(event),
    });
    // Event ingestion can change the canonical turn/session status (including
    // terminal runtime errors). Keep the lightweight sidebar reference in
    // sync before a stream completion persists it.
    this.#rememberSession(session);
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
    const generation = session.hostGeneration;
    this.#connections.startTurnStream({
      client,
      session,
      turnId,
      afterSeq: this.#events.highestSequence(session, turnId),
      isCurrent: () =>
        generation === this.#generation &&
        session.hostId === this.#activeHostId &&
        this.#isWorkspaceLeaseCurrent(lease) &&
        this.#sessions.isCurrent(session),
      refresh: () =>
        this.#refreshTurn(session, turnId, client, lease, { persist: false }),
      ingest: (remote) => this.#ingestRemoteEvent(session, remote),
      publishSession: () => this.#emit({ type: "session", session }),
      persist: () => this.#persist(lease),
      isStaleError: (error) => this.#isStaleResponseError(error),
      presentError: (error) =>
        redactErrorMessage(
          error,
          "Live updates disconnected. Reconnect to resume.",
        ),
    });
  }

  /**
   * A runtime may complete a local command while the start response is being
   * hydrated. Preserve that terminal result and never hand it to the live
   * stream supervisor, which would otherwise leave the composer looking busy
   * until a reconnect.
   */
  #finalizeTerminalStart(
    session: ExternalAgentSession,
    startedStatus: ReturnType<typeof mapExternalAgentStatus>,
  ): void {
    if (!isTerminal(startedStatus)) return;
    session.status = startedStatus;
    session.activeTurnId = undefined;
    session.streamState = "idle";
    session.completedAt ??= nowIso();
  }

  /**
   * Host runs are ephemeral. When `/v1/runs/{id}` 404s, stop treating the
   * session as live so the sidebar and composer leave the "running" state.
   */
  #finalizeMissingTurn(
    session: ExternalAgentSession,
    turnId: string,
  ): void {
    const index = session.turns.findIndex((candidate) => candidate.id === turnId);
    const existing = index >= 0 ? session.turns[index] : undefined;
    const hasOutput = Boolean(
      existing?.final_text?.trim() ||
        session.output?.trim() ||
        session.events.some(
          (event) =>
            event.turnId === turnId &&
            (event.type === "message" || event.type === "tool"),
        ),
    );
    const status = hasOutput ? "succeeded" : "cancelled";
    const completedAt = Date.now() / 1000;
    const turn: ExternalRemoteTurn = {
      id: turnId,
      session_id: session.remoteSessionId,
      sequence: existing?.sequence ?? session.turns.length + 1,
      status,
      continuation_mode: existing?.continuation_mode ?? "replay",
      requested_at: existing?.requested_at ?? completedAt,
      completed_at: completedAt,
      user_message: existing?.user_message,
      final_text: existing?.final_text ?? session.output,
      error: existing?.error,
      model: existing?.model,
      thinking_level: existing?.thinking_level,
    };
    if (index >= 0) session.turns[index] = turn;
    else session.turns.push(turn);
    session.actionError = undefined;
    session.streamState = "idle";
    if (status === "succeeded") session.error = undefined;
    this.#applyLatestTurn(session, turn);
  }

  #abortActiveWork(): void {
    this.#connections.abortAll();
  }

  #resolveHistoricalHostId(
    requestedHostId: string,
    remoteSessionId: string,
  ): string {
    return this.#sessions.resolveHistoricalHostId({
      requestedHostId,
      remoteSessionId,
      activeHostId: this.#activeHostId,
      hosts: this.#hosts,
      sameEndpoint: sameExternalAgentEndpoint,
    });
  }

  #rebindEquivalentSessionRefs(hostId: string): void {
    this.#sessions.rebindEquivalentRefs(
      hostId,
      this.#hosts,
      sameExternalAgentEndpoint,
    );
  }

  #rememberSession(session: ExternalAgentSession): void {
    this.#sessions.remember(session);
  }

  async #persist(lease: ExternalAgentWorkspaceLease): Promise<void> {
    this.#assertWorkspaceLease(lease);
    const snapshot: ExternalAgentPersistenceSnapshot = {
      hosts: [...this.#hosts],
      activeHostId: this.#activeHostId,
      sessionRefs: [...this.#sessions.refs],
    };
    await this.#persistenceAdapter.save(lease.persistence, snapshot);
    this.#assertWorkspaceLease(lease);
  }
}
