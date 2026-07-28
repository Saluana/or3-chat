import type {
  ExternalAgentApproval,
  ExternalAgentArtifact,
  ExternalAgentRunStatus,
  ExternalAgentSession,
  ExternalAgentTimelineEvent,
  ExternalRemoteTurn,
} from "./types";
import type { ToolCallInfo, UiChatMessage } from "~/utils/chat/uiMessages";

const MAX_PRESENTATION_TEXT = 24_000;
const MAX_DIAGNOSTICS = 50;
const FORBIDDEN_KEY =
  /(?:authorization|cookie|headers?|endpoint|response[_-]?body|request[_-]?body|stack|trace|token|secret|api[_-]?key|job[_-]?id|session[_-]?id|runner[_-]?job|credential|metadata)/i;
const TRANSPORT_DETAIL =
  /(?:https?:\/\/|set-cookie|authorization|cloudflare|cf-ray|responseHeaders|requestHeaders|runner_job_id|session_id|job_id|stack trace)/i;

const ALLOWED_PRESENTATION_KEYS = new Set([
  "approval_id",
  "request_id",
  "requestId",
  "id",
  "title",
  "summary",
  "request_type",
  "decision",
  "status",
  "detail",
  "description",
  "message",
  "name",
  "tool",
  "command",
  "path",
  "duration_ms",
  "count",
  "operation_id",
  "operationId",
  "call_id",
  "callId",
  "unified_diff",
  "diff",
  "files",
  "artifact_id",
  "artifactId",
  "label",
  "content",
]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function cleanString(value: unknown, limit = MAX_PRESENTATION_TEXT) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (TRANSPORT_DETAIL.test(trimmed)) return undefined;
  return trimmed.slice(0, limit);
}

function cleanStreamText(value: unknown, limit = MAX_PRESENTATION_TEXT) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  if (TRANSPORT_DETAIL.test(value)) return undefined;
  return value.slice(0, limit);
}

function safeFile(value: unknown): Readonly<Record<string, string>> | null {
  const input = record(value);
  const path = cleanString(input.path ?? input.name ?? input.file, 1_000);
  if (!path) return null;
  const output: Record<string, string> = { path };
  const diff = cleanString(input.diff);
  const content = cleanString(input.content);
  if (diff) output.diff = diff;
  else if (content) output.content = content;
  return Object.freeze(output);
}

/**
 * Provider payloads are untrusted diagnostic input. Only this allowlist may
 * cross into canonical UI state.
 */
export function sanitizeExternalAgentPayload(
  value: unknown,
  rawType?: string,
): Readonly<Record<string, unknown>> {
  const input = record(value);
  const output: Record<string, unknown> = {};
  for (const [key, candidate] of Object.entries(input)) {
    if (FORBIDDEN_KEY.test(key) || !ALLOWED_PRESENTATION_KEYS.has(key))
      continue;
    if (key === "files" && Array.isArray(candidate)) {
      output.files = candidate
        .slice(0, 50)
        .map(safeFile)
        .filter((file): file is Readonly<Record<string, string>> =>
          Boolean(file),
        );
      continue;
    }
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      output[key] = candidate;
      continue;
    }
    if (typeof candidate === "boolean") {
      output[key] = candidate;
      continue;
    }
    const text = cleanString(candidate);
    if (text) output[key] = text;
  }
  if (rawType) output.rawType = rawType.slice(0, 120);
  return Object.freeze(output);
}

export interface ExternalAgentPresentationError {
  readonly message: string;
  readonly action:
    | "retry"
    | "reconnect"
    | "provider-settings"
    | "change-model"
    | null;
  readonly category:
    | "credits"
    | "authentication"
    | "connection"
    | "model"
    | "cancelled"
    | "unknown";
}

export function presentExternalAgentError(
  value: unknown,
  fallback = "This agent could not continue.",
): ExternalAgentPresentationError {
  const source =
    value instanceof Error
      ? value.message
      : typeof value === "string"
        ? value
        : "";
  const lower = source.toLowerCase();
  if (
    lower.includes("insufficient") &&
    (lower.includes("credit") || lower.includes("balance"))
  ) {
    return {
      message:
        "This agent could not continue because its model account has insufficient credits.",
      action: "provider-settings",
      category: "credits",
    };
  }
  if (
    lower.includes("unauthorized") ||
    lower.includes("forbidden") ||
    lower.includes("credential") ||
    lower.includes("authentication") ||
    /\b401\b|\b403\b/.test(lower)
  ) {
    return {
      message: "This agent needs you to reconnect its provider account.",
      action: "reconnect",
      category: "authentication",
    };
  }
  if (
    lower.includes("offline") ||
    lower.includes("network") ||
    lower.includes("fetch") ||
    lower.includes("connection") ||
    lower.includes("econn")
  ) {
    return {
      message: "The agent host is unavailable. Reconnect and try again.",
      action: "reconnect",
      category: "connection",
    };
  }
  if (
    lower.includes("model") &&
    (lower.includes("unavailable") ||
      lower.includes("not found") ||
      lower.includes("unsupported"))
  ) {
    return {
      message: "The selected model is unavailable for this agent.",
      action: "change-model",
      category: "model",
    };
  }
  if (lower.includes("cancel") || lower.includes("abort")) {
    return {
      message: "This agent run was stopped.",
      action: "retry",
      category: "cancelled",
    };
  }
  return {
    message:
      source && !TRANSPORT_DETAIL.test(source)
        ? source.slice(0, 320)
        : fallback,
    action: "retry",
    category: "unknown",
  };
}

export interface AgentArtifactPresentation extends ExternalAgentArtifact {
  readonly preview?: string;
}

export interface AgentConversationTurn {
  readonly id: string;
  readonly sequence: number;
  readonly status: ExternalAgentRunStatus;
  readonly userMessage?: UiChatMessage;
  readonly assistantMessage?: UiChatMessage;
  readonly approvals: readonly ExternalAgentApproval[];
  readonly artifacts: readonly AgentArtifactPresentation[];
  readonly error?: ExternalAgentPresentationError;
}

export interface AgentConversationProjection {
  readonly title: string;
  readonly status: ExternalAgentRunStatus;
  readonly turns: readonly AgentConversationTurn[];
  readonly pendingApprovalCount: number;
  readonly isRunning: boolean;
  readonly diagnostics: readonly {
    id: string;
    occurredAt: string;
    category: ExternalAgentTimelineEvent["type"];
    summary: string;
  }[];
}

function appendDelta(current: string, delta: string): string {
  if (!current) return delta;
  if (delta.startsWith(current)) return delta;
  if (current.endsWith(delta)) return current;
  return `${current}${delta}`;
}

function assistantText(
  turn: ExternalRemoteTurn,
  events: readonly ExternalAgentTimelineEvent[],
): string {
  const finalText = cleanString(turn.final_text);
  if (finalText) return finalText;
  let text = "";
  for (const event of events) {
    if (event.type !== "message") continue;
    const candidate = cleanStreamText(event.text);
    if (!candidate) continue;
    const rawType = String(event.payload.rawType ?? "").toLowerCase();
    if (rawType.includes("delta") || rawType.includes("chunk")) {
      text = appendDelta(text, candidate);
    } else {
      text = candidate.startsWith(text)
        ? candidate
        : appendDelta(text, candidate);
    }
  }
  return text;
}

function operationLabel(event: ExternalAgentTimelineEvent): string {
  const hint = [
    event.payload.name,
    event.payload.tool,
    event.payload.summary,
    event.payload.command,
    event.payload.path,
    event.payload.rawType,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  if (/test|vitest|jest|pytest|xcodebuild/.test(hint)) return "Running tests";
  if (/search|find|grep|glob/.test(hint)) return "Searching the workspace";
  if (/read|open|inspect/.test(hint)) return "Reading files";
  if (/edit|write|patch|create|delete/.test(hint)) return "Editing files";
  if (/build|compile|typecheck|lint/.test(hint)) return "Checking the project";
  if (/shell|command|exec|terminal/.test(hint)) return "Running a command";
  return cleanString(event.text, 160) ?? "Agent activity";
}

function activityStatus(
  event: ExternalAgentTimelineEvent,
  turnStatus: ExternalAgentRunStatus,
): ToolCallInfo["status"] {
  const value =
    `${event.payload.status ?? ""} ${event.payload.rawType ?? ""}`.toLowerCase();
  if (/fail|error|denied/.test(value)) return "error";
  if (/complete|completed|success|succeeded|finish|done/.test(value)) {
    return "complete";
  }
  return turnStatus === "failed"
    ? "error"
    : turnStatus === "succeeded" || turnStatus === "cancelled"
      ? "complete"
      : "loading";
}

function activityItems(
  events: readonly ExternalAgentTimelineEvent[],
  turnStatus: ExternalAgentRunStatus,
): ToolCallInfo[] {
  const items = new Map<string, ToolCallInfo>();
  for (const event of events) {
    if (event.type !== "tool") continue;
    const explicitKey = [
      event.payload.operation_id,
      event.payload.operationId,
      event.payload.call_id,
      event.payload.callId,
    ].find((value) => typeof value === "string");
    const label = operationLabel(event);
    const key = String(explicitKey ?? label);
    const status = activityStatus(event, turnStatus);
    items.set(key, {
      id: key,
      name: label,
      label:
        status === "complete"
          ? label.replace(/^Running /, "").replace(/^Editing /, "Edited ")
          : label,
      status,
    });
  }
  return [...items.values()];
}

function statusForTurn(turn: ExternalRemoteTurn): ExternalAgentRunStatus {
  const value = turn.status.toLowerCase();
  if (value.includes("approval")) return "waiting_approval";
  if (["succeeded", "completed", "complete", "ok"].includes(value))
    return "succeeded";
  if (["failed", "error", "timed_out", "timeout"].includes(value))
    return "failed";
  if (["cancelled", "canceled", "aborted", "interrupted"].includes(value))
    return "cancelled";
  if (["running", "starting", "aborting"].includes(value)) return "running";
  return "queued";
}

function projectTurn(
  session: ExternalAgentSession,
  turn: ExternalRemoteTurn,
): AgentConversationTurn {
  const events = session.events
    .filter((event) => event.turnId === turn.id)
    .sort((left, right) => left.sequence - right.sequence);
  const status = statusForTurn(turn);
  const text = assistantText(turn, events);
  const tools = activityItems(events, status);
  const pending = status === "queued" || status === "running";
  const error = turn.error
    ? presentExternalAgentError(turn.error)
    : status === "failed"
      ? presentExternalAgentError(
          events.find((event) => event.type === "error")?.text,
        )
      : undefined;
  const userText = cleanString(turn.user_message);
  const userMessage: UiChatMessage | undefined = userText
    ? {
        id: `${turn.id}:user`,
        role: "user",
        text: userText,
      }
    : undefined;
  const assistantMessage: UiChatMessage | undefined =
    text || tools.length || pending
      ? {
          id: `${turn.id}:assistant`,
          role: "assistant",
          text,
          pending,
          toolCalls: tools,
          error: error?.message,
        }
      : undefined;
  return Object.freeze({
    id: turn.id,
    sequence: turn.sequence,
    status,
    userMessage,
    assistantMessage,
    approvals: session.approvals.filter(
      (approval) => approval.turnId === turn.id,
    ),
    artifacts: session.artifacts
      .filter((artifact) => artifact.turnId === turn.id)
      .map((artifact) => ({
        ...artifact,
        preview: cleanString(artifact.content, 600),
      })),
    error,
  });
}

function fallbackTurn(
  session: ExternalAgentSession,
): ExternalRemoteTurn | null {
  const turnId =
    session.activeTurnId ??
    session.events[0]?.turnId ??
    session.approvals[0]?.turnId ??
    session.artifacts[0]?.turnId;
  if (!turnId && !session.output && !session.error) return null;
  return {
    id: turnId ?? `${session.remoteSessionId}:turn`,
    session_id: session.remoteSessionId,
    sequence: 1,
    status: session.status,
    continuation_mode: "unknown",
    requested_at: Date.parse(session.createdAt),
    final_text: session.output,
    error: session.error,
  };
}

export function projectExternalAgentConversation(
  session: ExternalAgentSession,
): AgentConversationProjection {
  const sourceTurns = session.turns.length
    ? [...session.turns]
    : [fallbackTurn(session)].filter((turn): turn is ExternalRemoteTurn =>
        Boolean(turn),
      );
  const turns = sourceTurns
    .sort(
      (left, right) =>
        left.sequence - right.sequence ||
        left.requested_at - right.requested_at,
    )
    .map((turn) => projectTurn(session, turn));
  if (session.output && turns.length) {
    const last = turns.at(-1)!;
    if (!last.assistantMessage?.text) {
      turns[turns.length - 1] = {
        ...last,
        assistantMessage: {
          id: `${last.id}:assistant`,
          role: "assistant",
          text: cleanString(session.output) ?? "",
          pending: false,
          toolCalls: last.assistantMessage?.toolCalls,
        },
      };
    }
  }
  const diagnostics = session.events.slice(-MAX_DIAGNOSTICS).map((event) => ({
    id: event.id,
    occurredAt: event.occurredAt,
    category: event.type,
    summary:
      event.type === "message"
        ? "Agent message update"
        : event.type === "status"
          ? "Agent status update"
          : event.type === "error"
            ? presentExternalAgentError(event.text).message
            : operationLabel(event),
  }));
  return Object.freeze({
    title: session.title,
    status: session.status,
    turns: Object.freeze(turns),
    pendingApprovalCount: session.approvals.filter(
      (approval) => approval.status === "pending",
    ).length,
    isRunning: session.status === "queued" || session.status === "running",
    diagnostics: Object.freeze(diagnostics),
  });
}
