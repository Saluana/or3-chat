import type {
  ExternalAgentApproval,
  ExternalAgentArtifact,
  ExternalAgentRunStatus,
  ExternalAgentSession,
  ExternalAgentTimelineEvent,
  ExternalRemoteTurn,
} from "./types";
import type {
  ToolCallInfo,
  UiChatMessage,
  UiChatMessagePart,
} from "~/utils/chat/uiMessages";

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
  "state",
  "detail",
  "description",
  "reason",
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
  "type",
  "item_type",
  "stream_kind",
  "delta",
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
  const args = record(input.args);
  const reason = cleanString(args.reason);
  if (reason && !output.reason) output.reason = reason;
  const data = record(input.data);
  const state = record(data.state);
  const nestedOperationId = [
    data.call_id,
    data.callId,
    data.tool_call_id,
    data.toolCallId,
    data.message_id,
    data.messageId,
    data.id,
  ].find((candidate) => typeof candidate === "string");
  if (nestedOperationId && !output.operation_id) {
    output.operation_id = nestedOperationId.slice(0, 500);
  }
  const nestedToolName = cleanString(data.tool ?? data.name, 500);
  if (nestedToolName && !output.name) output.name = nestedToolName;
  const nestedDetail = cleanString(
    data.path ?? data.command ?? state.title,
    2_000,
  );
  if (nestedDetail && !output.detail) output.detail = nestedDetail;
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
    (lower.includes("insufficient") &&
      (lower.includes("credit") || lower.includes("balance"))) ||
    lower.includes("not enough credits")
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
    lower.includes("connect") ||
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
      lower.includes("not supported") ||
      lower.includes("unsupported"))
  ) {
    return {
      message: "The selected model is unavailable for this agent.",
      action: "change-model",
      category: "model",
    };
  }
  if (
    lower.includes("approval reject") ||
    lower.includes("approval denied") ||
    lower.includes("request denied")
  ) {
    return {
      message: "You denied this request. No changes were made.",
      action: "retry",
      category: "cancelled",
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

type OperationKind =
  | "tests"
  | "search"
  | "read"
  | "edit"
  | "command"
  | "other";

function operationHint(event: ExternalAgentTimelineEvent): string {
  return [
    event.payload.name,
    event.payload.tool,
    event.payload.title,
    event.payload.item_type,
    event.payload.summary,
    event.payload.command,
    event.payload.path,
    event.payload.rawType,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
}

function operationKind(event: ExternalAgentTimelineEvent): OperationKind {
  const hint = operationHint(event);
  if (/test|vitest|jest|pytest|xcodebuild/.test(hint)) return "tests";
  if (/search|find|grep|glob/.test(hint)) return "search";
  if (/read|open|inspect/.test(hint)) return "read";
  if (/edit|write|patch|create|delete|file_change/.test(hint)) return "edit";
  if (/shell|command|exec|terminal|bash/.test(hint)) return "command";
  return "other";
}

function operationLabel(
  event: ExternalAgentTimelineEvent,
  status: ToolCallInfo["status"] = "loading",
): string {
  const kind = operationKind(event);
  const complete = status === "complete";
  if (kind === "tests") return complete ? "Ran tests" : "Running tests";
  if (kind === "search")
    return complete ? "Searched the workspace" : "Searching the workspace";
  if (kind === "read") return complete ? "Read files" : "Reading files";
  if (kind === "edit") return complete ? "Edited files" : "Editing files";
  if (kind === "command")
    return complete ? "Ran a command" : "Running a command";

  const hint = [
    event.payload.name,
    event.payload.tool,
    event.payload.title,
    event.payload.item_type,
    event.payload.summary,
    event.payload.command,
    event.payload.path,
    event.payload.rawType,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  if (/build|compile|typecheck|lint/.test(hint))
    return complete ? "Checked the project" : "Checking the project";
  return (
    cleanString(event.payload.title, 160) ??
    cleanString(event.payload.name, 160) ??
    cleanString(event.text, 160) ??
    (complete ? "Completed an action" : "Working")
  );
}

function operationId(event: ExternalAgentTimelineEvent): string | undefined {
  return [
    event.payload.operation_id,
    event.payload.operationId,
    event.payload.call_id,
    event.payload.callId,
    event.payload.id,
  ].find(
    (value): value is string => typeof value === "string" && Boolean(value),
  );
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

function isReasoningEvent(event: ExternalAgentTimelineEvent): boolean {
  const kind =
    `${event.payload.rawType ?? ""} ${event.payload.stream_kind ?? ""}`.toLowerCase();
  return kind.includes("reasoning") || kind.includes("thought");
}

interface AssistantPresentation {
  readonly text: string;
  readonly reasoningText?: string;
  readonly tools: readonly ToolCallInfo[];
  readonly parts: readonly UiChatMessagePart[];
}

function assistantPresentation(
  turn: ExternalRemoteTurn,
  events: readonly ExternalAgentTimelineEvent[],
  turnStatus: ExternalAgentRunStatus,
): AssistantPresentation {
  const parts: UiChatMessagePart[] = [];
  const toolPartIndexes = new Map<string, number>();
  const activeToolByLabel = new Map<string, string>();
  let reasoningText = "";
  let activeTextPart: Extract<UiChatMessagePart, { type: "text" }> | null =
    null;

  for (const event of events) {
    if (event.type === "message") {
      const candidate = cleanStreamText(event.text);
      if (!candidate) continue;
      if (isReasoningEvent(event)) {
        reasoningText = appendDelta(reasoningText, candidate);
        continue;
      }
      if (!activeTextPart) {
        activeTextPart = {
          id: `${turn.id}:text:${event.sequence}`,
          type: "text",
          text: "",
        };
        parts.push(activeTextPart);
      }
      activeTextPart.text = appendDelta(activeTextPart.text, candidate);
      continue;
    }
    if (event.type !== "tool") continue;

    activeTextPart = null;
    const status = activityStatus(event, turnStatus);
    const label = operationLabel(event, status);
    const kind = operationKind(event);
    const explicitKey = operationId(event);
    let key = explicitKey ?? activeToolByLabel.get(label);
    if (!key) key = `event-${event.sequence}`;

    const existingIndex = toolPartIndexes.get(key);
    const existingPart =
      existingIndex === undefined ? undefined : parts[existingIndex];
    const existingCall =
      existingPart?.type === "tool" ? existingPart.toolCall : undefined;
    const detail = cleanString(event.payload.detail, 4_000);
    const toolCall: ToolCallInfo = {
      id: key,
      name: existingCall?.name ?? operationLabel(event, "loading"),
      label,
      status,
      args:
        detail &&
        (kind === "command" || kind === "read" || kind === "edit")
          ? detail
          : existingCall?.args,
      result:
        detail && status === "complete" && kind === "search"
          ? detail
          : existingCall?.result,
      error:
        status === "error"
          ? cleanString(event.payload.message ?? event.payload.reason, 2_000)
          : existingCall?.error,
    };
    if (existingIndex === undefined) {
      toolPartIndexes.set(key, parts.length);
      parts.push({
        id: `${turn.id}:tool:${key}`,
        type: "tool",
        toolCall,
      });
    } else {
      parts[existingIndex] = {
        id: `${turn.id}:tool:${key}`,
        type: "tool",
        toolCall,
      };
    }
    if (status === "loading" || status === "pending") {
      activeToolByLabel.set(label, key);
    } else if (activeToolByLabel.get(label) === key) {
      activeToolByLabel.delete(label);
    }
  }

  const finalText = cleanString(turn.final_text);
  const streamedText = parts
    .filter(
      (
        part,
      ): part is Extract<UiChatMessagePart, { type: "text" }> =>
        part.type === "text",
    )
    .map((part) => part.text)
    .join("");
  if (finalText && finalText !== streamedText) {
    if (streamedText && finalText.startsWith(streamedText)) {
      const lastText = [...parts]
        .reverse()
        .find(
          (
            part,
          ): part is Extract<UiChatMessagePart, { type: "text" }> =>
            part.type === "text",
        );
      if (lastText) lastText.text += finalText.slice(streamedText.length);
    } else if (!streamedText || !streamedText.includes(finalText)) {
      parts.push({
        id: `${turn.id}:text:final`,
        type: "text",
        text: finalText,
      });
    }
  }

  const text = parts
    .filter(
      (
        part,
      ): part is Extract<UiChatMessagePart, { type: "text" }> =>
        part.type === "text",
    )
    .map((part) => part.text)
    .join("");
  const tools = parts
    .filter(
      (
        part,
      ): part is Extract<UiChatMessagePart, { type: "tool" }> =>
        part.type === "tool",
    )
    .map((part) => part.toolCall);
  return {
    text,
    reasoningText,
    tools,
    parts,
  };
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
  const assistant = assistantPresentation(turn, events, status);
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
    assistant.text || assistant.tools.length || pending
      ? {
          id: `${turn.id}:assistant`,
          role: "assistant",
          text: assistant.text,
          pending,
          toolCalls: [...assistant.tools],
          parts: [...assistant.parts],
          reasoning_text: assistant.reasoningText,
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
