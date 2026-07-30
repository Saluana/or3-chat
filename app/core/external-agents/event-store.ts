import {
  presentExternalAgentError,
  sanitizeExternalAgentPayload,
} from "./presentation";
import type {
  ExternalAgentApproval,
  ExternalAgentArtifact,
  ExternalAgentClient,
  ExternalAgentRunStatus,
  ExternalAgentSession,
  ExternalAgentStoreEvent,
  ExternalAgentTimelineEvent,
  ExternalRemoteEvent,
  ExternalRemoteStreamEvent,
} from "./types";

const EVENT_PAGE_SIZE = 500;
export const MAX_TIMELINE_EVENTS_PER_TURN = 2_000;
export const MAX_EVENT_TURNS = 5;
const MAX_SESSION_APPROVALS = 100;
const MAX_SESSION_ARTIFACTS = 100;
const MAX_ARTIFACT_FILES_PER_EVENT = 50;

interface SessionEventIndex {
  eventsRef: ExternalAgentTimelineEvent[];
  retainedTurnKey: string;
  ids: Set<string>;
  byTurn: Map<string, ExternalAgentTimelineEvent[]>;
  highestSequenceByTurn: Map<string, number>;
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

export function remoteDate(
  value: number | undefined,
  fallback = Date.now(),
): string {
  if (!value || !Number.isFinite(value))
    return new Date(fallback).toISOString();
  const millis = value < 1_000_000_000_000 ? value * 1000 : value;
  return new Date(millis).toISOString();
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

export function isTerminal(status: ExternalAgentRunStatus): boolean {
  return (
    status === "succeeded" || status === "failed" || status === "cancelled"
  );
}

export function shouldPauseStream(status: ExternalAgentRunStatus): boolean {
  return isTerminal(status) || status === "waiting_approval";
}

export function streamPayload(
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

function compareTimelineEvents(
  left: ExternalAgentTimelineEvent,
  right: ExternalAgentTimelineEvent,
): number {
  return left.sequence - right.sequence || left.id.localeCompare(right.id);
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
  )
    return "approval";
  if (
    type.includes("diff") ||
    type.includes("file") ||
    type.includes("artifact")
  )
    return "artifact";
  if (type.includes("error") || type.includes("failed")) return "error";
  if (
    type.includes("token") ||
    type.includes("usage") ||
    type.includes("metric")
  )
    return "metric";
  if (
    type.includes("text") ||
    type.includes("content") ||
    type.includes("message") ||
    type.includes("reasoning")
  )
    return "message";
  if (
    type.includes("item.started") ||
    type.includes("item.updated") ||
    type.includes("item.completed") ||
    type.includes("tool.started") ||
    type.includes("tool.updated") ||
    type.includes("tool.completed") ||
    type.includes("tool_use")
  )
    return "tool";
  if (
    type.includes("completed") ||
    type.includes("completion") ||
    type.includes("status") ||
    type === "done"
  )
    return "status";
  return "metric";
}

function normalizeTimelineEvent(
  session: ExternalAgentSession,
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
    id: `${session.hostId}:${session.remoteSessionId}:${stableId}`,
    hostId: session.hostId,
    hostGeneration: session.hostGeneration,
    sessionId: session.remoteSessionId,
    turnId: event.turn_id,
    sequence: event.seq,
    occurredAt: remoteDate(event.ts),
    type,
    text,
    payload: Object.freeze({ ...payload }),
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
  const decision = String(payload.decision ?? payload.status ?? "").toLowerCase();
  let status: ExternalAgentApproval["status"] = "pending";
  if (rawType.includes("resolved") || rawType.includes("response") || decision) {
    if (decision.includes("approve") || decision === "allow")
      status = "approved";
    else if (decision.includes("deny") || decision.includes("reject"))
      status = "denied";
    else if (decision.includes("cancel")) status = "cancelled";
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
  )
    return "failed";
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
  )
    return null;
  for (const candidate of [event.payload.status, event.payload.state]) {
    if (typeof candidate !== "string") continue;
    const mapped = mapExternalAgentStatus(candidate, "queued");
    if (isTerminal(mapped)) return mapped;
  }
  return null;
}

export class ExternalAgentEventStore {
  readonly #indexes = new WeakMap<ExternalAgentSession, SessionEventIndex>();

  async listCanonicalTurnEvents(
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
    return events
      .slice(0, MAX_TIMELINE_EVENTS_PER_TURN)
      .sort(
        (left, right) =>
          left.seq - right.seq || String(left.id).localeCompare(String(right.id)),
      );
  }

  highestSequence(session: ExternalAgentSession, turnId: string): number {
    return this.#eventIndex(session).highestSequenceByTurn.get(turnId) ?? 0;
  }

  ingest(input: {
    session: ExternalAgentSession;
    remote: ExternalRemoteEvent;
    isCurrent: () => boolean;
    emit: (
      event: Extract<ExternalAgentStoreEvent, { type: "timeline" }>,
    ) => void;
  }): void {
    if (!input.isCurrent()) return;
    const normalized = normalizeTimelineEvent(input.session, input.remote);
    const eventIndex = this.#eventIndex(input.session);
    if (
      eventIndex.ids.has(normalized.id) ||
      !eventIndex.byTurn.has(normalized.turnId)
    )
      return;
    this.#appendIndexedEvent(input.session, normalized, eventIndex);

    const approval = approvalFromEvent(normalized);
    if (approval) {
      let index = input.session.approvals.findIndex(
        (item) => item.id === approval.id,
      );
      if (index < 0) {
        index = input.session.approvals.findLastIndex(
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
        input.session.approvals[index] = mergeApproval(
          input.session.approvals[index]!,
          approval,
        );
      } else input.session.approvals.push(approval);
      input.session.approvals = input.session.approvals.slice(
        -MAX_SESSION_APPROVALS,
      );
      if (approval.status === "pending" && !isTerminal(input.session.status))
        input.session.status = "waiting_approval";
    }
    for (const artifact of artifactsFromEvent(normalized)) {
      const index = input.session.artifacts.findIndex(
        (item) =>
          item.id === artifact.id ||
          (item.turnId === artifact.turnId &&
            item.kind === artifact.kind &&
            item.artifactId === artifact.artifactId &&
            item.label === artifact.label &&
            item.content === artifact.content),
      );
      if (index >= 0) input.session.artifacts[index] = artifact;
      else input.session.artifacts.push(artifact);
    }
    input.session.artifacts = input.session.artifacts.slice(
      -MAX_SESSION_ARTIFACTS,
    );
    if (normalized.type === "error")
      input.session.error = presentExternalAgentError(normalized.text).message;

    const terminalStatus = timelineTerminalStatus(normalized);
    if (terminalStatus) {
      const turnIndex = input.session.turns.findIndex(
        (turn) => turn.id === normalized.turnId,
      );
      const existingTurn =
        turnIndex >= 0 ? input.session.turns[turnIndex] : null;
      const existingStatus = existingTurn
        ? mapExternalAgentStatus(existingTurn.status, "queued")
        : null;
      const preserveFailure =
        existingStatus === "failed" && terminalStatus !== "failed";
      if (existingTurn && !preserveFailure) {
        input.session.turns[turnIndex] = {
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
        input.session.activeTurnId === normalized.turnId &&
        !(input.session.status === "failed" && terminalStatus !== "failed")
      ) {
        input.session.status = terminalStatus;
        input.session.completedAt ??= normalized.occurredAt;
      }
    }
    if (
      Date.parse(normalized.occurredAt) >= Date.parse(input.session.updatedAt)
    )
      input.session.updatedAt = normalized.occurredAt;
    input.emit({
      type: "timeline",
      session: input.session,
      event: normalized,
    });
  }

  #retainedTurnKey(session: ExternalAgentSession): string {
    return session.turns
      .slice(-MAX_EVENT_TURNS)
      .map((turn) => turn.id)
      .join("\u0000");
  }

  #buildIndex(session: ExternalAgentSession): SessionEventIndex {
    const retainedTurns = session.turns.slice(-MAX_EVENT_TURNS);
    const retainedTurnIds = new Set(retainedTurns.map((turn) => turn.id));
    const byTurn = new Map<string, ExternalAgentTimelineEvent[]>();
    for (const event of session.events) {
      if (!retainedTurnIds.has(event.turnId)) continue;
      const events = byTurn.get(event.turnId) ?? [];
      events.push(event);
      byTurn.set(event.turnId, events);
    }
    const ids = new Set<string>();
    const highestSequenceByTurn = new Map<string, number>();
    const flattened: ExternalAgentTimelineEvent[] = [];
    for (const turn of retainedTurns) {
      const events = (byTurn.get(turn.id) ?? [])
        .sort(compareTimelineEvents)
        .slice(-MAX_TIMELINE_EVENTS_PER_TURN);
      byTurn.set(turn.id, events);
      for (const event of events) {
        ids.add(event.id);
        highestSequenceByTurn.set(
          turn.id,
          Math.max(highestSequenceByTurn.get(turn.id) ?? 0, event.sequence),
        );
      }
      flattened.push(...events);
    }
    if (
      flattened.length !== session.events.length ||
      flattened.some((event, index) => session.events[index] !== event)
    )
      session.events = flattened;
    const index = {
      eventsRef: session.events,
      retainedTurnKey: this.#retainedTurnKey(session),
      ids,
      byTurn,
      highestSequenceByTurn,
    };
    this.#indexes.set(session, index);
    return index;
  }

  #eventIndex(session: ExternalAgentSession): SessionEventIndex {
    const cached = this.#indexes.get(session);
    if (
      cached &&
      cached.eventsRef === session.events &&
      cached.retainedTurnKey === this.#retainedTurnKey(session)
    )
      return cached;
    return this.#buildIndex(session);
  }

  #appendIndexedEvent(
    session: ExternalAgentSession,
    normalized: ExternalAgentTimelineEvent,
    index: SessionEventIndex,
  ): void {
    const retainedTurns = session.turns.slice(-MAX_EVENT_TURNS);
    const latestTurnId = retainedTurns.at(-1)?.id;
    const turnEvents = index.byTurn.get(normalized.turnId) ?? [];
    const last = turnEvents.at(-1);
    const appendInOrder =
      !last || compareTimelineEvents(last, normalized) <= 0;
    if (appendInOrder) turnEvents.push(normalized);
    else {
      let low = 0;
      let high = turnEvents.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (compareTimelineEvents(turnEvents[middle]!, normalized) <= 0)
          low = middle + 1;
        else high = middle;
      }
      turnEvents.splice(low, 0, normalized);
    }
    let removed: ExternalAgentTimelineEvent | undefined;
    if (turnEvents.length > MAX_TIMELINE_EVENTS_PER_TURN) {
      removed = turnEvents.shift();
      if (removed) index.ids.delete(removed.id);
    }
    index.byTurn.set(normalized.turnId, turnEvents);
    index.ids.add(normalized.id);
    index.highestSequenceByTurn.set(
      normalized.turnId,
      Math.max(
        index.highestSequenceByTurn.get(normalized.turnId) ?? 0,
        normalized.sequence,
      ),
    );
    if (appendInOrder && normalized.turnId === latestTurnId) {
      session.events.push(normalized);
      if (removed) {
        const removedIndex = session.events.indexOf(removed);
        if (removedIndex >= 0) session.events.splice(removedIndex, 1);
      }
      index.eventsRef = session.events;
      return;
    }
    session.events = retainedTurns.flatMap(
      (turn) => index.byTurn.get(turn.id) ?? [],
    );
    index.eventsRef = session.events;
  }
}
