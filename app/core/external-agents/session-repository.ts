import type {
  ExternalAgentHost,
  ExternalAgentSession,
  ExternalAgentSessionRef,
} from "./types";

export const MAX_EXTERNAL_AGENT_SESSION_REFS = 100;

export function externalAgentSessionKey(
  hostId: string,
  remoteSessionId: string,
): string {
  return `${hostId}:${remoteSessionId}`;
}

/**
 * Owns workspace-scoped canonical sessions, lightweight persisted references,
 * and refresh ordering. The controller coordinates transitions but cannot
 * mutate repository maps independently.
 */
export class ExternalAgentSessionRepository {
  readonly #sessions = new Map<string, ExternalAgentSession>();
  readonly #refreshVersions = new Map<string, number>();
  #refs: ExternalAgentSessionRef[] = [];

  get refs(): readonly ExternalAgentSessionRef[] {
    return this.#refs;
  }

  values(): ExternalAgentSession[] {
    return [...this.#sessions.values()];
  }

  reset(refs: readonly ExternalAgentSessionRef[] = []): void {
    this.#sessions.clear();
    this.#refreshVersions.clear();
    this.#refs = [...refs];
  }

  set(session: ExternalAgentSession): void {
    this.#sessions.set(
      externalAgentSessionKey(session.hostId, session.remoteSessionId),
      session,
    );
  }

  get(
    hostId: string,
    remoteSessionId: string,
  ): ExternalAgentSession | undefined {
    return this.#sessions.get(externalAgentSessionKey(hostId, remoteSessionId));
  }

  isCurrent(session: ExternalAgentSession): boolean {
    return this.get(session.hostId, session.remoteSessionId) === session;
  }

  refsForHost(hostId: string): ExternalAgentSessionRef[] {
    return this.#refs.filter((ref) => ref.hostId === hostId);
  }

  removeRef(hostId: string, remoteSessionId: string): void {
    this.#refs = this.#refs.filter(
      (ref) =>
        ref.hostId !== hostId || ref.remoteSessionId !== remoteSessionId,
    );
  }

  deleteHost(hostId: string): void {
    this.#refs = this.#refs.filter((ref) => ref.hostId !== hostId);
    for (const [key, session] of this.#sessions) {
      if (session.hostId === hostId) this.#sessions.delete(key);
    }
  }

  nextRefreshVersion(session: ExternalAgentSession): number {
    const key = externalAgentSessionKey(
      session.hostId,
      session.remoteSessionId,
    );
    const next = (this.#refreshVersions.get(key) ?? 0) + 1;
    this.#refreshVersions.set(key, next);
    return next;
  }

  isRefreshCurrent(
    session: ExternalAgentSession,
    refreshVersion: number,
  ): boolean {
    const key = externalAgentSessionKey(
      session.hostId,
      session.remoteSessionId,
    );
    return (
      this.#sessions.get(key) === session &&
      this.#refreshVersions.get(key) === refreshVersion
    );
  }

  remember(session: ExternalAgentSession): void {
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
      model: session.model,
      thinkingLevel: session.thinkingLevel,
    };
    this.#refs = [
      ref,
      ...this.#refs.filter(
        (candidate) =>
          candidate.hostId !== ref.hostId ||
          candidate.remoteSessionId !== ref.remoteSessionId,
      ),
    ]
      .sort(
        (left, right) =>
          Date.parse(right.updatedAt ?? "") - Date.parse(left.updatedAt ?? ""),
      )
      .slice(0, MAX_EXTERNAL_AGENT_SESSION_REFS);
  }

  resolveHistoricalHostId(input: {
    requestedHostId: string;
    remoteSessionId: string;
    activeHostId: string | null;
    hosts: readonly ExternalAgentHost[];
    sameEndpoint: (left: string, right: string) => boolean;
  }): string {
    if (input.requestedHostId === input.activeHostId) {
      return input.requestedHostId;
    }
    const activeHost = input.hosts.find(
      (candidate) => candidate.id === input.activeHostId,
    );
    const requestedHost = input.hosts.find(
      (candidate) => candidate.id === input.requestedHostId,
    );
    if (
      activeHost &&
      requestedHost &&
      input.sameEndpoint(activeHost.baseUrl, requestedHost.baseUrl)
    ) {
      return activeHost.id;
    }
    if (!requestedHost) {
      const candidates = new Set(
        this.#refs
          .filter(
            (candidate) =>
              candidate.remoteSessionId === input.remoteSessionId &&
              input.hosts.some((host) => host.id === candidate.hostId),
          )
          .map((candidate) => candidate.hostId),
      );
      if (candidates.size === 1) return [...candidates][0]!;
    }
    return input.requestedHostId;
  }

  rebindEquivalentRefs(
    hostId: string,
    hosts: readonly ExternalAgentHost[],
    sameEndpoint: (left: string, right: string) => boolean,
  ): void {
    const host = hosts.find((candidate) => candidate.id === hostId);
    if (!host) return;
    const equivalentHostIds = new Set(
      hosts
        .filter((candidate) =>
          sameEndpoint(candidate.baseUrl, host.baseUrl),
        )
        .map((candidate) => candidate.id),
    );
    if (equivalentHostIds.size < 2) return;

    const rebound = new Map<string, ExternalAgentSessionRef>();
    for (const ref of this.#refs) {
      const next =
        equivalentHostIds.has(ref.hostId) && ref.hostId !== hostId
          ? { ...ref, hostId }
          : ref;
      const key = externalAgentSessionKey(
        next.hostId,
        next.remoteSessionId,
      );
      const previous = rebound.get(key);
      if (
        !previous ||
        Date.parse(next.updatedAt ?? "") > Date.parse(previous.updatedAt ?? "")
      ) {
        rebound.set(key, next);
      }
    }
    this.#refs = [...rebound.values()];
  }
}
