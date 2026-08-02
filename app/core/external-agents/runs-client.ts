import { presentExternalAgentError } from "./presentation";
import type {
  ExternalAgentApprovalInput,
  ExternalAgentAttachment,
  ExternalAgentCapabilities,
  ExternalAgentClient,
  ExternalAgentCommand,
  ExternalAgentCreateSessionInput,
  ExternalAgentHostHealth,
  ExternalAgentHostReadiness,
  ExternalAgentRunner,
  ExternalAgentStartTurnInput,
  ExternalAgentUploadAttachment,
  ExternalRemoteEvent,
  ExternalRemoteSession,
  ExternalRemoteStreamEvent,
  ExternalRemoteTurn,
} from "./types";

const MAX_ERROR_TEXT = 500;
const MAX_SSE_BUFFER_BYTES = 1024 * 1024;
const MAX_RUN_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_RUN_ATTACHMENT_COUNT = 10;
const RUNNER_ID = "agent";
const REASONING_LEVELS = ["minimal", "low", "medium", "high", "xhigh"];

type JsonRecord = Record<string, unknown>;

interface RunsFeatureSet {
  readonly sessions: boolean;
  readonly history: boolean;
  readonly events: boolean;
  readonly stop: boolean;
  readonly approval: boolean;
  readonly attachments: boolean;
}

interface RunMetadata {
  readonly runId: string;
  readonly sessionId: string;
  readonly userMessage: string;
  readonly sequence: number;
  readonly requestedAt: number;
}

interface RunStreamState {
  readonly events: ExternalRemoteEvent[];
  readonly waiters: Set<() => void>;
  nextSequence: number;
  started: boolean;
  done: boolean;
  error?: unknown;
}

interface StagedRunAttachment {
  readonly fileName: string;
  readonly mimeType?: string;
  readonly content: string;
}

export interface CreateRunsExternalAgentClientOptions {
  readonly baseUrl: string;
  readonly resolveCredential: () => Promise<string | null>;
  readonly fetch?: RunsFetch;
}

export type RunsFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export class RunsClientError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "RunsClientError";
    this.status = status;
  }
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function rawString(value: unknown): string | undefined {
  return typeof value === "string" && value.length ? value : undefined;
}

function displayName(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function timestamp(value: unknown, fallback = Date.now() / 1000): number {
  const numeric = numberValue(value);
  if (numeric !== undefined) return numeric;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed / 1000;
  }
  return fallback;
}

function messageContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .flatMap((part) => {
      if (typeof part === "string") return [part];
      const item = record(part);
      const text = stringValue(item.text ?? item.content);
      return text ? [text] : [];
    })
    .join("\n");
}

function encodePath(value: string): string {
  return encodeURIComponent(value);
}

function normalizedBaseUrl(value: string): URL {
  const url = new URL(value);
  if (url.username || url.password) {
    throw new RunsClientError("Agent service URLs cannot contain credentials");
  }
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}

function safeErrorMessage(value: unknown, fallback: string): string {
  const message = presentExternalAgentError(value, fallback).message;
  return message.slice(0, MAX_ERROR_TEXT);
}

function featureSet(raw: JsonRecord): RunsFeatureSet {
  const features = record(raw.features);
  const endpoints = record(raw.endpoints);
  const hasEndpoint = (name: string) => Object.hasOwn(endpoints, name);
  return {
    sessions:
      features.session_resources === true ||
      features.session_create === true ||
      hasEndpoint("sessions"),
    history:
      features.session_resources === true || hasEndpoint("session_messages"),
    events:
      features.run_events_sse === true ||
      features.run_events === true ||
      hasEndpoint("run_events"),
    stop: features.run_stop === true || hasEndpoint("run_stop"),
    approval:
      features.run_approval_response === true ||
      features.run_approval === true ||
      hasEndpoint("run_approval"),
    attachments: features.inline_attachments === true,
  };
}

function advertisedEndpoint(raw: JsonRecord, name: string): string | undefined {
  const path = stringValue(record(record(raw.endpoints)[name]).path);
  return path?.startsWith("/") && !path.startsWith("//") ? path : undefined;
}

function modelOptions(
  raw: JsonRecord,
  fallbackModel?: string,
): Array<Readonly<Record<string, unknown>>> {
  const providers = Array.isArray(raw.providers)
    ? raw.providers.map(record)
    : [];
  const currentProvider = stringValue(raw.provider);
  const defaultModel = stringValue(raw.model) ?? fallbackModel;
  const available = providers
    .filter(
      (candidate) =>
        candidate.authenticated === true ||
        candidate.is_current === true ||
        stringValue(candidate.slug ?? candidate.id) === currentProvider,
    )
    .sort((left, right) => {
      const current = (candidate: JsonRecord) =>
        candidate.is_current === true ||
        stringValue(candidate.slug ?? candidate.id) === currentProvider;
      return Number(current(right)) - Number(current(left));
    });
  const seen = new Set<string>();
  return available.flatMap((provider) => {
    const providerId = stringValue(provider.slug ?? provider.id);
    if (!providerId) return [];
    const providerName = stringValue(provider.name) ?? providerId;
    const capabilities = record(provider.capabilities);
    const isCurrent =
      provider.is_current === true || providerId === currentProvider;
    return (Array.isArray(provider.models) ? provider.models : []).flatMap(
      (candidate) => {
        const item = record(candidate);
        const id =
          typeof candidate === "string"
            ? stringValue(candidate)
            : stringValue(item.id ?? item.model);
        if (!id || seen.has(id)) return [];
        seen.add(id);
        const capability = record(capabilities[id]);
        return [
          {
            id,
            display_name: stringValue(item.name ?? item.display_name) ?? id,
            provider: providerId,
            provider_name: providerName,
            default: isCurrent && id === defaultModel,
            ...(capability.reasoning === true
              ? { reasoning: REASONING_LEVELS }
              : {}),
          },
        ];
      },
    );
  });
}

function arrayBufferBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }
  return btoa(binary);
}

async function blobBase64(blob: Blob): Promise<string> {
  if (typeof blob.arrayBuffer === "function") {
    return arrayBufferBase64(await blob.arrayBuffer());
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(new RunsClientError("Could not read an attachment"));
    reader.onabort = () =>
      reject(new RunsClientError("Attachment reading was cancelled"));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const separator = result.indexOf(",");
      if (separator < 0)
        reject(new RunsClientError("Could not encode an attachment"));
      else resolve(result.slice(separator + 1));
    };
    reader.readAsDataURL(blob);
  });
}

function sessionPayload(value: unknown): JsonRecord {
  const container = record(value);
  return Object.keys(record(container.session)).length
    ? record(container.session)
    : container;
}

function mapSession(value: unknown): ExternalRemoteSession {
  const session = sessionPayload(value);
  const id = stringValue(session.id ?? session.session_id);
  if (!id)
    throw new RunsClientError("Agent service returned an invalid session");
  const createdAt = timestamp(session.started_at ?? session.created_at);
  const updatedAt = timestamp(
    session.last_active ?? session.updated_at ?? session.ended_at,
    createdAt,
  );
  return {
    id,
    app_session_key:
      stringValue(session.app_session_key ?? session.appSessionKey) ?? id,
    runner_id: stringValue(session.runner_id) ?? RUNNER_ID,
    continuation_mode: "replay",
    created_at: createdAt,
    updated_at: updatedAt,
    model: stringValue(session.model),
    title: stringValue(session.title),
  };
}

function statusValue(value: unknown): string {
  switch (String(value ?? "").toLowerCase()) {
    case "started":
    case "starting":
    case "queued":
      return "queued";
    case "waiting_for_approval":
    case "approval_required":
      return "waiting_approval";
    case "stopping":
    case "running":
      return "running";
    case "completed":
    case "succeeded":
      return "succeeded";
    case "cancelled":
    case "canceled":
    case "interrupted":
      return "cancelled";
    case "failed":
    case "error":
      return "failed";
    default:
      return "queued";
  }
}

function turnFromStatus(
  raw: JsonRecord,
  metadata: RunMetadata,
): ExternalRemoteTurn {
  const status = statusValue(raw.status);
  const updatedAt = timestamp(raw.updated_at, metadata.requestedAt);
  return {
    id: metadata.runId,
    session_id: metadata.sessionId,
    sequence: metadata.sequence,
    status,
    continuation_mode: "replay",
    requested_at: timestamp(raw.created_at, metadata.requestedAt),
    started_at:
      status === "queued" ? undefined : timestamp(raw.started_at, updatedAt),
    completed_at:
      status === "succeeded" || status === "failed" || status === "cancelled"
        ? updatedAt
        : undefined,
    user_message: metadata.userMessage,
    final_text: stringValue(raw.output ?? raw.final_text),
    error: stringValue(raw.error),
    runner_job_id: metadata.runId,
    model: stringValue(raw.model),
  };
}

function normalizedApprovalDecision(value: unknown): string {
  return String(value ?? "").toLowerCase() === "deny" ? "deny" : "approve";
}

function normalizeRunEvent(
  raw: JsonRecord,
  metadata: RunMetadata,
  sequence: number,
): ExternalRemoteEvent | null {
  const event = stringValue(raw.event ?? raw.type);
  if (!event) return null;
  const ts = timestamp(raw.timestamp ?? raw.ts);
  const base = {
    id: sequence,
    turn_id: metadata.runId,
    seq: sequence,
    ts,
  };
  switch (event) {
    case "message.delta":
    case "assistant.delta": {
      const delta = rawString(raw.delta ?? raw.text);
      return delta
        ? { ...base, type: "text_delta", text: delta, payload: { delta } }
        : null;
    }
    case "reasoning.available": {
      const text = stringValue(raw.text ?? raw.preview);
      return text
        ? { ...base, type: "reasoning", text, payload: { text } }
        : null;
    }
    case "tool.started":
    case "tool.completed":
    case "tool.failed":
      return {
        ...base,
        type: event,
        text: stringValue(raw.preview),
        payload: {
          type: event,
          name: stringValue(raw.tool ?? raw.tool_name) ?? "Tool",
          status:
            event === "tool.started"
              ? "running"
              : event === "tool.failed"
                ? "failed"
                : "completed",
          detail: stringValue(raw.preview),
          duration_ms:
            numberValue(raw.duration) !== undefined
              ? Math.round(numberValue(raw.duration)! * 1000)
              : undefined,
        },
      };
    case "subagent.start":
    case "subagent.complete":
      return {
        ...base,
        type: event === "subagent.start" ? "tool.started" : "tool.completed",
        text: stringValue(raw.summary ?? raw.preview ?? raw.goal),
        payload: {
          type: event,
          name: "Subagent",
          status:
            stringValue(raw.status) ??
            (event === "subagent.start" ? "running" : "completed"),
          summary: stringValue(raw.summary ?? raw.preview ?? raw.goal),
        },
      };
    case "approval.request": {
      const command = stringValue(raw.command);
      return {
        ...base,
        type: "approval.request",
        text: stringValue(raw.reason ?? raw.description) ?? command,
        payload: {
          approval_id: metadata.runId,
          request_type: command ? "command" : "permission",
          description: stringValue(raw.reason ?? raw.description) ?? command,
          command,
          status: "pending",
        },
      };
    }
    case "approval.responded":
      return {
        ...base,
        type: "approval.resolved",
        payload: {
          approval_id: metadata.runId,
          decision: normalizedApprovalDecision(raw.choice),
          status: normalizedApprovalDecision(raw.choice),
        },
      };
    case "command.choices":
      return {
        ...base,
        type: "command.choices",
        payload: {
          rawType: "command.choices",
          choices: Array.isArray(raw.choices) ? raw.choices : [],
        },
      };
    case "run.completed":
      return {
        ...base,
        type: "turn.completed",
        text: stringValue(raw.output),
        payload: { status: "completed" },
      };
    case "run.failed": {
      const error = stringValue(raw.error) ?? "Agent run failed";
      return {
        ...base,
        type: "failed",
        text: error,
        payload: { status: "failed", error },
      };
    }
    case "run.cancelled":
      return {
        ...base,
        type: "turn.completed",
        payload: { status: "cancelled" },
      };
    default:
      return null;
  }
}

async function* parseSseJson(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<JsonRecord> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder
        .decode(value, { stream: !done })
        .replaceAll("\r\n", "\n");
      if (buffer.length > MAX_SSE_BUFFER_BYTES) {
        throw new RunsClientError("Agent event stream exceeded its size limit");
      }
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const eventName = frame
          .split("\n")
          .find((line) => line.startsWith("event:"))
          ?.slice(6)
          .trim();
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (data && data !== "[DONE]") {
          let parsed: unknown;
          try {
            parsed = JSON.parse(data);
          } catch {
            throw new RunsClientError(
              "Agent event stream returned malformed JSON",
            );
          }
          const item = record(parsed);
          if (eventName && !item.event) item.event = eventName;
          if (Object.keys(item).length) yield item;
        }
        boundary = buffer.indexOf("\n\n");
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}

class RunsExternalAgentClient implements ExternalAgentClient {
  readonly #baseUrl: URL;
  readonly #resolveCredential: () => Promise<string | null>;
  readonly #fetch: RunsFetch;
  readonly #runMetadata = new Map<string, RunMetadata>();
  readonly #runStreams = new Map<string, RunStreamState>();
  readonly #historyTurns = new Map<string, ExternalRemoteTurn[]>();
  readonly #historyEvents = new Map<string, ExternalRemoteEvent[]>();
  readonly #nextTurnSequence = new Map<string, number>();
  readonly #stagedAttachments = new Map<string, StagedRunAttachment>();
  readonly #modelProviders = new Map<string, string>();
  #rawCapabilities: JsonRecord | null = null;

  constructor(options: CreateRunsExternalAgentClientOptions) {
    this.#baseUrl = normalizedBaseUrl(options.baseUrl);
    this.#resolveCredential = options.resolveCredential;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async #response(path: string, init: RequestInit = {}): Promise<Response> {
    const credential = await this.#resolveCredential();
    if (!credential)
      throw new RunsClientError("Agent service credential is unavailable", 401);
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json, text/event-stream");
    headers.set("Authorization", `Bearer ${credential}`);
    if (init.body && !(init.body instanceof FormData)) {
      headers.set("Content-Type", "application/json");
    }
    let response: Response;
    try {
      response = await this.#fetch(
        new URL(path.replace(/^\//, ""), this.#baseUrl),
        {
          ...init,
          headers,
          cache: "no-store",
        },
      );
    } catch (error) {
      throw new RunsClientError(
        safeErrorMessage(error, "Could not reach the agent service"),
      );
    }
    if (response.ok) return response;
    let detail = "";
    try {
      const body = record(await response.clone().json());
      detail = stringValue(record(body.error).message ?? body.message) ?? "";
    } catch {
      // Do not expose arbitrary response bodies.
    }
    const fallback = `Agent service request failed (${response.status})`;
    throw new RunsClientError(
      detail ? safeErrorMessage(detail, fallback) : fallback,
      response.status,
    );
  }

  async #json(path: string, init: RequestInit = {}): Promise<JsonRecord> {
    const response = await this.#response(path, init);
    try {
      return record(await response.json());
    } catch {
      throw new RunsClientError(
        "Agent service returned malformed JSON",
        response.status,
      );
    }
  }

  async #capabilities(): Promise<JsonRecord> {
    if (!this.#rawCapabilities) {
      this.#rawCapabilities = await this.#json("/v1/capabilities");
    }
    return this.#rawCapabilities;
  }

  async health(options?: {
    signal?: AbortSignal;
  }): Promise<ExternalAgentHostHealth> {
    const raw = await this.#json("/health", { signal: options?.signal });
    const status = stringValue(raw.status) ?? "unknown";
    return {
      ...raw,
      status,
      runtimeAvailable: status === "ok" || status === "ready",
    };
  }

  async readiness(options?: {
    signal?: AbortSignal;
  }): Promise<ExternalAgentHostReadiness> {
    const raw = await this.#json("/health/detailed", {
      signal: options?.signal,
    });
    const status = stringValue(raw.status) ?? "unknown";
    return { ...raw, status, ready: status === "ok" || status === "ready" };
  }

  async capabilities(options?: {
    signal?: AbortSignal;
  }): Promise<ExternalAgentCapabilities> {
    if (options?.signal) {
      this.#rawCapabilities = await this.#json("/v1/capabilities", {
        signal: options.signal,
      });
    }
    const raw = await this.#capabilities();
    const features = featureSet(raw);
    const product =
      stringValue(raw.platform ?? raw.product ?? raw.runtime) ??
      "agent-service";
    const productName =
      stringValue(raw.display_name ?? raw.name) ?? displayName(product);
    return {
      ...raw,
      hostId:
        stringValue(raw.host_id ?? raw.instance_id) ??
        `runs:${this.#baseUrl.origin}${this.#baseUrl.pathname}`,
      execAvailable: features.sessions && features.events,
      runtimeProduct: product,
      runtimeDisplayName: productName,
      approvalBroker: {
        enabled: features.approval,
        available: features.approval,
      },
      approvals: features.approval ? { mode: "runtime" } : {},
      runsFeatures: features,
    };
  }

  async listRunners(options?: { signal?: AbortSignal }): Promise<{
    runners: ExternalAgentRunner[];
    default_runner?: string;
  }> {
    if (options?.signal) {
      this.#rawCapabilities = await this.#json("/v1/capabilities", {
        signal: options.signal,
      });
    }
    const raw = await this.#capabilities();
    const features = featureSet(raw);
    const product =
      stringValue(raw.platform ?? raw.product ?? raw.runtime) ??
      "Agent service";
    const productName =
      stringValue(raw.display_name ?? raw.name) ?? displayName(product);
    let models = (Array.isArray(raw.models) ? raw.models : [])
      .map((value) => record(value))
      .filter((value) => stringValue(value.id));
    const model = stringValue(raw.model);
    const modelOptionsPath = advertisedEndpoint(raw, "model_options");
    if (modelOptionsPath) {
      const discovered = await this.#json(modelOptionsPath, {
        signal: options?.signal,
      })
        .then((value) => modelOptions(value, model))
        .catch(() => []);
      if (discovered.length) models = discovered;
    }
    this.#modelProviders.clear();
    for (const candidate of models) {
      const id = stringValue(candidate.id);
      const provider = stringValue(candidate.provider);
      if (id && provider) this.#modelProviders.set(id, provider);
    }
    const commands: ExternalAgentCommand[] = (
      Array.isArray(raw.commands) ? raw.commands : []
    ).flatMap((value) => {
      const command = record(value);
      const name = stringValue(command.name);
      const commandText = stringValue(command.command);
      if (!name || !commandText) return [];
      return [
        {
          name,
          command: commandText,
          description: stringValue(command.description) ?? "",
          category: stringValue(command.category),
          accepts_args: command.accepts_args === true,
          args: Array.isArray(command.args)
            ? (command.args as ExternalAgentCommand["args"])
            : undefined,
        },
      ];
    });
    return {
      default_runner: RUNNER_ID,
      runners: [
        {
          id: RUNNER_ID,
          display_name: productName,
          status:
            features.sessions && features.events ? "available" : "unsupported",
          auth_status: "ready",
          supports: {
            chat: {
              chatSelectable: features.sessions && features.events,
              chatReplay: features.history,
              chatNativeSession: features.sessions,
              cancel: features.stop,
              approvalDecisions: features.approval,
              customCwd: false,
              attachments: features.attachments,
            },
          },
          chat_capabilities: {
            chatSelectable: features.sessions && features.events,
            chatReplay: features.history,
            chatNativeSession: features.sessions,
            cancel: features.stop,
            approvalDecisions: features.approval,
            customCwd: false,
            attachments: features.attachments,
            modeSelection: false,
            isolationSelection: false,
          },
          default_mode: "review",
          default_isolation: "host_readonly",
          models: models.length
            ? models
            : model
              ? [{ id: model, name: model, default: true }]
              : undefined,
          commands,
          runtime: { product },
        },
      ],
    };
  }

  async createSession(
    input: ExternalAgentCreateSessionInput,
    options?: { signal?: AbortSignal },
  ): Promise<ExternalRemoteSession> {
    const raw = await this.#json("/api/sessions", {
      method: "POST",
      body: JSON.stringify({
        id: input.app_session_key,
        source: "api_server",
        model: input.model,
        provider: input.model
          ? this.#modelProviders.get(input.model)
          : undefined,
      }),
      signal: options?.signal,
    });
    const session = mapSession(raw);
    this.#nextTurnSequence.set(session.id, 0);
    return session;
  }

  async listSessions(
    input: {
      readonly appSessionKeyPrefix?: string;
      readonly limit?: number;
    } = {},
    options?: { signal?: AbortSignal },
  ): Promise<{ sessions: ExternalRemoteSession[] }> {
    const query = new URLSearchParams();
    query.set("limit", String(Math.min(Math.max(input.limit ?? 50, 1), 200)));
    const raw = await this.#json(`/api/sessions?${query}`, {
      signal: options?.signal,
    });
    const sessions = (Array.isArray(raw.data) ? raw.data : [])
      .map(mapSession)
      .filter(
        (session) =>
          !input.appSessionKeyPrefix ||
          session.app_session_key.startsWith(input.appSessionKeyPrefix),
      );
    return { sessions };
  }

  async getSession(
    sessionId: string,
    options?: { signal?: AbortSignal },
  ): Promise<ExternalRemoteSession> {
    return mapSession(
      await this.#json(`/api/sessions/${encodePath(sessionId)}`, {
        signal: options?.signal,
      }),
    );
  }

  async #history(
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<ExternalRemoteTurn[]> {
    const raw = await this.#json(
      `/api/sessions/${encodePath(sessionId)}/messages`,
      {
        signal,
      },
    );
    const messages = Array.isArray(raw.data) ? raw.data.map(record) : [];
    const turns: ExternalRemoteTurn[] = [];
    let current:
      | {
          id: string;
          requestedAt: number;
          userMessage: string;
          assistant: string[];
          toolEvents: JsonRecord[];
        }
      | undefined;
    const commit = () => {
      if (!current) return;
      const sequence = turns.length + 1;
      const finalText = current.assistant.join("\n").trim();
      const completedAt =
        current.toolEvents
          .map((event) => timestamp(event.timestamp, current!.requestedAt))
          .at(-1) ?? current.requestedAt;
      const turn: ExternalRemoteTurn = {
        id: current.id,
        session_id: sessionId,
        sequence,
        status: "succeeded",
        continuation_mode: "replay",
        requested_at: current.requestedAt,
        completed_at: completedAt,
        user_message: current.userMessage,
        final_text: finalText || undefined,
      };
      const events: ExternalRemoteEvent[] = [];
      let eventSequence = 0;
      if (finalText) {
        events.push({
          id: ++eventSequence,
          turn_id: turn.id,
          seq: eventSequence,
          ts: completedAt,
          type: "text_delta",
          text: finalText,
          payload: { delta: finalText },
        });
      }
      for (const tool of current.toolEvents) {
        const name = stringValue(tool.tool_name) ?? "Tool";
        events.push({
          id: ++eventSequence,
          turn_id: turn.id,
          seq: eventSequence,
          ts: timestamp(tool.timestamp, completedAt),
          type: "tool.completed",
          payload: { name, status: "completed" },
        });
      }
      events.push({
        id: ++eventSequence,
        turn_id: turn.id,
        seq: eventSequence,
        ts: completedAt,
        type: "turn.completed",
        payload: { status: "completed" },
      });
      this.#historyEvents.set(turn.id, events);
      turns.push(turn);
      current = undefined;
    };
    for (const [index, message] of messages.entries()) {
      const role = String(message.role ?? "").toLowerCase();
      if (role === "user") {
        commit();
        current = {
          id: stringValue(message.id) ?? `${sessionId}:turn:${index + 1}`,
          requestedAt: timestamp(message.timestamp),
          userMessage: messageContent(message.content),
          assistant: [],
          toolEvents: [],
        };
      } else if (current && role === "assistant") {
        const content = messageContent(message.content);
        if (content) current.assistant.push(content);
      } else if (current && role === "tool") {
        current.toolEvents.push(message);
      }
    }
    commit();
    this.#historyTurns.set(sessionId, turns);
    this.#nextTurnSequence.set(
      sessionId,
      Math.max(this.#nextTurnSequence.get(sessionId) ?? 0, turns.length),
    );
    return turns;
  }

  async listTurns(
    sessionId: string,
    input: { limit?: number; signal?: AbortSignal } = {},
  ): Promise<{ turns: ExternalRemoteTurn[] }> {
    const history = await this.#history(sessionId, input.signal);
    const live: ExternalRemoteTurn[] = [];
    for (const metadata of this.#runMetadata.values()) {
      if (metadata.sessionId !== sessionId) continue;
      try {
        const raw = await this.#json(`/v1/runs/${encodePath(metadata.runId)}`, {
          signal: input.signal,
        });
        live.push(turnFromStatus(raw, metadata));
      } catch (error) {
        if (!(error instanceof RunsClientError && error.status === 404))
          throw error;
      }
    }
    const turns = [...history, ...live]
      .sort((left, right) => left.sequence - right.sequence)
      .slice(-(input.limit ?? 50));
    return { turns };
  }

  async startTurn(
    sessionId: string,
    input: ExternalAgentStartTurnInput,
    options?: { signal?: AbortSignal },
  ): Promise<{
    session_id: string;
    turn_id: string;
    job_id?: string;
    status: string;
  }> {
    const nextSequence = (this.#nextTurnSequence.get(sessionId) ?? 0) + 1;
    const attachmentIds =
      input.attachments?.map((attachment) => attachment.id) ?? [];
    const attachments = attachmentIds.map((id) => {
      const attachment = this.#stagedAttachments.get(id);
      if (!attachment) {
        throw new RunsClientError(
          "An attachment is no longer available. Add it again and retry.",
        );
      }
      return attachment;
    });
    let raw: JsonRecord;
    try {
      raw = await this.#json("/v1/runs", {
        method: "POST",
        body: JSON.stringify({
          input: input.user_message,
          session_id: sessionId,
          model: input.model,
          provider: input.model
            ? this.#modelProviders.get(input.model)
            : undefined,
          model_options: input.thinking_level
            ? { reasoning_effort: input.thinking_level }
            : undefined,
          attachments: attachments.length ? attachments : undefined,
        }),
        signal: options?.signal,
      });
    } finally {
      for (const id of attachmentIds) this.#stagedAttachments.delete(id);
    }
    const runId = stringValue(raw.run_id ?? raw.id);
    if (!runId)
      throw new RunsClientError("Agent service did not return a run ID");
    const metadata: RunMetadata = {
      runId,
      sessionId,
      userMessage: input.user_message,
      sequence: nextSequence,
      requestedAt: Date.now() / 1000,
    };
    this.#runMetadata.set(runId, metadata);
    this.#nextTurnSequence.set(sessionId, nextSequence);
    this.#ensureRunPump(metadata);
    return {
      session_id: sessionId,
      turn_id: runId,
      job_id: runId,
      status: statusValue(raw.status),
    };
  }

  async stageFiles(
    attachments: readonly ExternalAgentUploadAttachment[],
    options?: { signal?: AbortSignal },
  ): Promise<readonly ExternalAgentAttachment[]> {
    if (!attachments.length) return [];
    if (attachments.length > MAX_RUN_ATTACHMENT_COUNT) {
      throw new RunsClientError(
        `Attach up to ${MAX_RUN_ATTACHMENT_COUNT} files at a time.`,
      );
    }
    const totalBytes = attachments.reduce(
      (total, attachment) => total + attachment.data.size,
      0,
    );
    if (totalBytes > MAX_RUN_ATTACHMENT_BYTES) {
      throw new RunsClientError(
        "Attachments can total up to 20 MB per message.",
      );
    }
    const staged: ExternalAgentAttachment[] = [];
    for (const attachment of attachments) {
      if (options?.signal?.aborted) throw options.signal.reason;
      if (attachment.data.size > MAX_RUN_ATTACHMENT_BYTES) {
        throw new RunsClientError(
          `${attachment.name} exceeds the 20 MB attachment limit.`,
        );
      }
      this.#stagedAttachments.set(attachment.id, {
        fileName: attachment.name,
        mimeType: attachment.mimeType || attachment.data.type || undefined,
        content: await blobBase64(attachment.data),
      });
      staged.push({
        id: attachment.id,
        source: "local_artifact",
        kind: attachment.kind,
        name: attachment.name,
        mime_type: attachment.mimeType || attachment.data.type || undefined,
        size_bytes: attachment.data.size,
        artifact_id: attachment.id,
      });
    }
    return staged;
  }

  async getTurn(
    sessionId: string,
    turnId: string,
    options?: { signal?: AbortSignal },
  ): Promise<ExternalRemoteTurn> {
    const metadata = this.#runMetadata.get(turnId);
    if (metadata) {
      const raw = await this.#json(`/v1/runs/${encodePath(turnId)}`, {
        signal: options?.signal,
      });
      return turnFromStatus(raw, metadata);
    }
    const history =
      this.#historyTurns.get(sessionId) ??
      (await this.#history(sessionId, options?.signal));
    const turn = history.find((candidate) => candidate.id === turnId);
    if (!turn) throw new RunsClientError(`Agent turn was not found`, 404);
    return turn;
  }

  async listTurnEvents(
    _sessionId: string,
    turnId: string,
    input: { afterSeq?: number; limit?: number; signal?: AbortSignal } = {},
  ): Promise<{ events: ExternalRemoteEvent[] }> {
    if (input.signal?.aborted) throw input.signal.reason;
    const events =
      this.#runStreams.get(turnId)?.events ??
      this.#historyEvents.get(turnId) ??
      [];
    return {
      events: events
        .filter((event) => event.seq > (input.afterSeq ?? 0))
        .slice(0, input.limit ?? 500),
    };
  }

  #streamState(runId: string): RunStreamState {
    let state = this.#runStreams.get(runId);
    if (!state) {
      state = {
        events: [],
        waiters: new Set(),
        nextSequence: 0,
        started: false,
        done: false,
      };
      this.#runStreams.set(runId, state);
    }
    return state;
  }

  #wake(state: RunStreamState): void {
    for (const waiter of state.waiters) waiter();
    state.waiters.clear();
  }

  #ensureRunPump(metadata: RunMetadata): void {
    const state = this.#streamState(metadata.runId);
    if (state.started || state.done) return;
    state.started = true;
    void (async () => {
      try {
        const response = await this.#response(
          `/v1/runs/${encodePath(metadata.runId)}/events`,
        );
        if (!response.body) {
          throw new RunsClientError(
            "Agent service returned an empty event stream",
          );
        }
        for await (const raw of parseSseJson(response.body)) {
          const sequence = ++state.nextSequence;
          const event = normalizeRunEvent(raw, metadata, sequence);
          if (!event) continue;
          state.events.push(event);
          this.#wake(state);
        }
      } catch (error) {
        state.error = error;
      } finally {
        state.done = true;
        this.#wake(state);
      }
    })();
  }

  async *streamTurn(
    sessionId: string,
    turnId: string,
    input: { afterSeq?: number; signal?: AbortSignal } = {},
  ): AsyncIterable<ExternalRemoteStreamEvent> {
    let metadata = this.#runMetadata.get(turnId);
    if (!metadata) {
      metadata = {
        runId: turnId,
        sessionId,
        userMessage: "",
        sequence: this.#nextTurnSequence.get(sessionId) ?? 1,
        requestedAt: Date.now() / 1000,
      };
      this.#runMetadata.set(turnId, metadata);
    }
    this.#ensureRunPump(metadata);
    const state = this.#streamState(turnId);
    let afterSeq = input.afterSeq ?? 0;
    while (!input.signal?.aborted) {
      const event = state.events.find((candidate) => candidate.seq > afterSeq);
      if (event) {
        afterSeq = event.seq;
        yield {
          event: "message",
          id: String(event.seq),
          cursor: event.seq,
          json: event,
        };
        continue;
      }
      if (state.done) {
        if (state.error) throw state.error;
        return;
      }
      await new Promise<void>((resolve) => {
        const wake = () => {
          input.signal?.removeEventListener("abort", wake);
          resolve();
        };
        state.waiters.add(wake);
        input.signal?.addEventListener("abort", wake, { once: true });
        if (
          state.done ||
          state.events.some((candidate) => candidate.seq > afterSeq)
        ) {
          state.waiters.delete(wake);
          wake();
        }
      });
    }
  }

  async abortTurn(
    _sessionId: string,
    turnId: string,
    options?: { signal?: AbortSignal },
  ): Promise<Readonly<Record<string, unknown>>> {
    const capabilities = featureSet(await this.#capabilities());
    if (!capabilities.stop) {
      throw new RunsClientError(
        "This agent service does not support stopping runs",
      );
    }
    return this.#json(`/v1/runs/${encodePath(turnId)}/stop`, {
      method: "POST",
      body: JSON.stringify({}),
      signal: options?.signal,
    });
  }

  async decideTurn(
    _sessionId: string,
    turnId: string,
    decision: "approve" | "reject" | "cancel",
    input: ExternalAgentApprovalInput = {},
    options?: { signal?: AbortSignal },
  ): Promise<Readonly<Record<string, unknown>>> {
    const capabilities = featureSet(await this.#capabilities());
    if (!capabilities.approval) {
      throw new RunsClientError(
        "This agent service does not support approval decisions",
      );
    }
    const choice =
      decision !== "approve"
        ? "deny"
        : input.allowlist
          ? "always"
          : input.allow_session
            ? "session"
            : "once";
    return this.#json(`/v1/runs/${encodePath(turnId)}/approval`, {
      method: "POST",
      body: JSON.stringify({ choice }),
      signal: options?.signal,
    });
  }

  async readArtifact(): Promise<never> {
    throw new RunsClientError(
      "This agent service does not expose OR3 artifacts",
    );
  }
}

export function createRunsExternalAgentClient(
  options: CreateRunsExternalAgentClientOptions,
): ExternalAgentClient {
  return new RunsExternalAgentClient(options);
}
