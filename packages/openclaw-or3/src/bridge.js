import { Buffer } from "node:buffer";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

const MAX_BODY_BYTES = 32 * 1024 * 1024;
const MAX_ATTACHMENT_COUNT = 10;
const MAX_ATTACHMENT_CONTENT_CHARS = Math.ceil((20 * 1024 * 1024 * 4) / 3) + 4;
const MAX_EVENTS = 2_000;
const MAX_SESSIONS = 200;
const MAX_RUNS = 200;
const MAX_COMMAND_CHOICES = 24;
const MODEL_PAGE_SIZE = 8;
const SSE_HEARTBEAT_MS = 15_000;

function text(value) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function stringValue(value) {
  return typeof value === "string" ? value : undefined;
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function normalizeAttachments(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw Object.assign(new Error("Attachments must be an array"), {
      status: 400,
    });
  }
  if (value.length > MAX_ATTACHMENT_COUNT) {
    throw Object.assign(
      new Error(`Attach up to ${MAX_ATTACHMENT_COUNT} files at a time`),
      {
        status: 413,
      },
    );
  }
  let contentChars = 0;
  return value.map((entry) => {
    const attachment = object(entry);
    const fileName = text(attachment.fileName);
    const content = stringValue(attachment.content);
    if (!fileName || !content) {
      throw Object.assign(
        new Error("Each attachment requires fileName and content"),
        {
          status: 400,
        },
      );
    }
    contentChars += content.length;
    if (contentChars > MAX_ATTACHMENT_CONTENT_CHARS) {
      throw Object.assign(
        new Error("Attachments can total up to 20 MB per message"),
        {
          status: 413,
        },
      );
    }
    return {
      fileName: fileName.slice(0, 255),
      ...(text(attachment.mimeType)
        ? { mimeType: text(attachment.mimeType).slice(0, 255) }
        : {}),
      content,
    };
  });
}

function nowSeconds() {
  return Date.now() / 1_000;
}

function contentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (typeof part === "string" ? part : text(object(part).text)))
    .filter(Boolean)
    .join("\n");
}

function normalizeMessages(messages) {
  return messages.map((message, index) => {
    const item = object(message);
    return {
      id: text(item.id) ?? `message-${index + 1}`,
      role: text(item.role) ?? "assistant",
      content: contentText(item.content),
      timestamp:
        typeof item.timestamp === "number"
          ? item.timestamp
          : typeof item.createdAt === "number"
            ? item.createdAt / 1_000
            : nowSeconds(),
    };
  });
}

function commandText(command, value) {
  return value ? `/${command} ${value}` : `/${command}`;
}

function normalizeDiscovery(rawModels, rawCommands, rawAgents, agentId) {
  const agents = Array.isArray(object(rawAgents).agents)
    ? rawAgents.agents
    : [];
  const agent =
    agents.find((entry) => text(object(entry).id) === agentId) ?? {};
  const primary = text(object(agent).model?.primary);
  const thinkingLevels = Array.isArray(object(agent).thinkingLevels)
    ? agent.thinkingLevels
        .map((entry) => ({
          value: text(object(entry).id),
          label: text(object(entry).label),
        }))
        .filter((entry) => entry.value)
    : [];
  const models = (
    Array.isArray(object(rawModels).models) ? rawModels.models : []
  )
    .map((entry) => {
      const model = object(entry);
      const provider = text(model.provider);
      const id = text(model.id);
      if (!provider || !id || model.available === false) return null;
      const ref = id.startsWith(`${provider}/`) ? id : `${provider}/${id}`;
      return {
        id: ref,
        display_name: text(model.name) ?? id,
        provider,
        provider_name: provider,
        default: ref === primary,
        ...(model.reasoning === true && thinkingLevels.length
          ? {
              reasoning: thinkingLevels.map((level) => level.value),
              reasoning_default: text(object(agent).thinkingDefault),
            }
          : {}),
      };
    })
    .filter(Boolean);
  const commands = (
    Array.isArray(object(rawCommands).commands) ? rawCommands.commands : []
  )
    .map((entry) => {
      const command = object(entry);
      const name = text(command.name);
      if (!name) return null;
      const args = Array.isArray(command.args)
        ? command.args.map((arg) => {
            const value = object(arg);
            return {
              name: text(value.name) ?? "value",
              description: text(value.description),
              required: value.required === true,
              dynamic: value.dynamic === true,
              choices: Array.isArray(value.choices)
                ? value.choices
                    .map((choice) => ({
                      value: text(object(choice).value),
                      label: text(object(choice).label),
                    }))
                    .filter((choice) => choice.value)
                : [],
            };
          })
        : [];
      return {
        name,
        command: `/${name}`,
        description: text(command.description) ?? "",
        category: text(command.category),
        accepts_args: command.acceptsArgs === true,
        args,
      };
    })
    .filter(Boolean);
  return { models, commands, thinkingLevels };
}

function sendJson(res, status, value) {
  res.statusCode = status;
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(value));
}

function sameSecret(left, right) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.byteLength === rightBytes.byteLength &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function bearerToken(req) {
  const value = req.headers?.authorization;
  const header = Array.isArray(value) ? value[0] : value;
  return typeof header === "string" && header.startsWith("Bearer ")
    ? header.slice(7).trim()
    : "";
}

function applyCors(req, res, allowedOrigins) {
  const value = req.headers?.origin;
  const origin = Array.isArray(value) ? value[0] : value;
  if (!origin) return true;
  if (!allowedOrigins.includes(origin)) return false;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Vary", "Origin");
  return true;
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_BODY_BYTES)
      throw Object.assign(new Error("Payload too large"), { status: 413 });
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  try {
    return object(JSON.parse(raw));
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON"), {
      status: 400,
    });
  }
}

function sessionKey(agentId, sessionId) {
  const digest = createHash("sha256").update(sessionId, "utf8").digest("hex");
  return `agent:${agentId}:or3:${digest}`;
}

function sessionView(session) {
  return {
    id: session.id,
    source: "or3",
    started_at: session.createdAt,
    last_active: session.updatedAt,
  };
}

function runView(run) {
  return {
    id: run.id,
    run_id: run.id,
    session_id: run.sessionId,
    status: run.status,
    created_at: run.createdAt,
    updated_at: run.updatedAt,
    output: run.output || undefined,
    error: run.error,
  };
}

export class Or3RunsBridge {
  constructor({ agentId = "main", control }) {
    this.agentId = agentId;
    this.control = control;
    this.sessions = new Map();
    this.runs = new Map();
    this.runAliases = new Map();
    this.discovery = { models: [], commands: [], thinkingLevels: [] };
    this.discoveryPromise = undefined;
  }

  async capabilities() {
    if (this.discoveryPromise) return this.discoveryPromise;
    const request = (async () => {
      const [models, commands, agents] = await Promise.all([
        this.control.models(),
        this.control.commands({ agentId: this.agentId }),
        this.control.agents(),
      ]);
      this.discovery = normalizeDiscovery(
        models,
        commands,
        agents,
        this.agentId,
      );
      return {
        object: "or3.runs.capabilities",
        platform: "openclaw",
        display_name: "OpenClaw",
        features: {
          session_resources: true,
          run_events_sse: true,
          run_stop: true,
          run_approval_response: true,
          tool_progress_events: true,
          model_selection: this.discovery.models.length > 0,
          thinking_levels: this.discovery.thinkingLevels.length > 0,
          commands: this.discovery.commands.length > 0,
          interactive_commands: true,
          inline_attachments: true,
        },
        models: this.discovery.models,
        commands: this.discovery.commands,
        endpoints: {
          sessions: { method: "GET", path: "/api/sessions" },
          session_messages: {
            method: "GET",
            path: "/api/sessions/{session_id}/messages",
          },
          run_events: { method: "GET", path: "/v1/runs/{run_id}/events" },
          run_stop: { method: "POST", path: "/v1/runs/{run_id}/stop" },
          run_approval: {
            method: "POST",
            path: "/v1/runs/{run_id}/approval",
          },
        },
      };
    })();
    this.discoveryPromise = request;
    try {
      return await request;
    } finally {
      if (this.discoveryPromise === request) this.discoveryPromise = undefined;
    }
  }

  commandChoices(input) {
    const match = /^\/([^\s]+)(?:\s+(.+?))?\s*$/u.exec(input.trim());
    if (!match) return [];
    const name = match[1].toLowerCase();
    const argument = text(match[2]);
    if ((name === "model" || name === "models") && !argument) {
      const providers = new Map();
      for (const model of this.discovery.models) {
        const current = providers.get(model.provider);
        providers.set(model.provider, {
          label: model.provider_name ?? model.provider,
          count: (current?.count ?? 0) + 1,
        });
      }
      return [...providers.entries()]
        .slice(0, MAX_COMMAND_CHOICES)
        .map(([provider, details]) => ({
          label: `${details.label} (${details.count})`,
          command: commandText("models", provider),
        }));
    }
    if (name === "models" && argument) {
      const [provider, ...tokens] = argument.split(/\s+/u);
      const requestedPage = tokens
        .map((token) => /^(?:page=)?(\d+)$/iu.exec(token)?.[1])
        .find(Boolean);
      const models = this.discovery.models.filter(
        (model) => model.provider.toLowerCase() === provider.toLowerCase(),
      );
      if (!models.length) return [];
      const pageCount = Math.max(1, Math.ceil(models.length / MODEL_PAGE_SIZE));
      const page = Math.min(pageCount, Math.max(1, Number(requestedPage) || 1));
      const choices = models
        .slice((page - 1) * MODEL_PAGE_SIZE, page * MODEL_PAGE_SIZE)
        .map((model) => ({
          label: model.display_name,
          command: commandText("model", model.id),
        }));
      if (page > 1) {
        choices.push({
          label: "← Previous",
          command: `/models ${provider} page=${page - 1}`,
        });
      }
      if (page < pageCount) {
        choices.push({
          label: "Next →",
          command: `/models ${provider} page=${page + 1}`,
        });
      }
      choices.push({ label: "← Providers", command: "/models" });
      return choices;
    }
    if (
      !argument &&
      (name === "think" || name === "thinking" || name === "t")
    ) {
      return this.discovery.thinkingLevels
        .slice(0, MAX_COMMAND_CHOICES)
        .map((level) => ({
          label: level.label ?? level.value,
          command: commandText("think", level.value),
        }));
    }
    if (argument) return [];
    const command = this.discovery.commands.find(
      (entry) => entry.name === name,
    );
    const choices = command?.args?.[0]?.choices ?? [];
    return choices.slice(0, MAX_COMMAND_CHOICES).map((choice) => ({
      label: choice.label ?? choice.value,
      command: commandText(name, choice.value),
    }));
  }

  ensureSession(id) {
    let session = this.sessions.get(id);
    if (!session) {
      const createdAt = nowSeconds();
      session = {
        id,
        sessionKey: sessionKey(this.agentId, id),
        createdAt,
        updatedAt: createdAt,
      };
      this.sessions.set(id, session);
      this.prune();
    }
    return session;
  }

  async createSession(id, model) {
    if (!text(id))
      throw Object.assign(new Error("Session id is required"), { status: 400 });
    const session = this.ensureSession(id);
    try {
      await this.control.createSession({
        key: session.sessionKey,
        agentId: this.agentId,
        ...(text(model) ? { model: text(model) } : {}),
      });
    } catch (error) {
      this.sessions.delete(id);
      throw error;
    }
    return session;
  }

  listSessions(limit = 50) {
    return [...this.sessions.values()]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, Math.min(Math.max(Number(limit) || 50, 1), MAX_SESSIONS))
      .map(sessionView);
  }

  async messages(sessionId) {
    const session = this.ensureSession(sessionId);
    try {
      const request = { sessionKey: session.sessionKey, limit: 1_000 };
      const result = await this.control.messages(request);
      return normalizeMessages(
        Array.isArray(result.messages) ? result.messages : [],
      );
    } catch (error) {
      throw Object.assign(
        new Error("OpenClaw session history is unavailable"),
        {
          status: 503,
          cause: error,
        },
      );
    }
  }

  prune() {
    if (this.runs.size > MAX_RUNS) {
      const removable = [...this.runs.values()]
        .filter((run) =>
          ["completed", "failed", "cancelled"].includes(run.status),
        )
        .sort((left, right) => left.updatedAt - right.updatedAt);
      while (this.runs.size > MAX_RUNS && removable.length) {
        const run = removable.shift();
        this.runs.delete(run.id);
        for (const [alias, runId] of this.runAliases) {
          if (runId === run.id) this.runAliases.delete(alias);
        }
      }
    }
    if (this.sessions.size > MAX_SESSIONS) {
      const activeSessionIds = new Set(
        [...this.runs.values()]
          .filter(
            (run) => !["completed", "failed", "cancelled"].includes(run.status),
          )
          .map((run) => run.sessionId),
      );
      const removable = [...this.sessions.values()]
        .filter((session) => !activeSessionIds.has(session.id))
        .sort((left, right) => left.updatedAt - right.updatedAt);
      while (this.sessions.size > MAX_SESSIONS && removable.length) {
        this.sessions.delete(removable.shift().id);
      }
    }
  }

  async startRun(sessionId, requestInput) {
    const resolvedSessionId = text(sessionId);
    if (!resolvedSessionId) {
      throw Object.assign(new Error("Session id is required"), { status: 400 });
    }
    const prompt = text(requestInput.input);
    if (!prompt)
      throw Object.assign(new Error("Run input is required"), { status: 400 });
    const attachments = normalizeAttachments(requestInput.attachments);
    const session = this.ensureSession(resolvedSessionId);
    const idempotencyKey = randomUUID();
    const createdAt = nowSeconds();
    const run = {
      id: idempotencyKey,
      sessionId: resolvedSessionId,
      sessionKey: session.sessionKey,
      status: "running",
      createdAt,
      updatedAt: createdAt,
      output: "",
      error: undefined,
      events: [],
      nextEventSequence: 1,
      listeners: new Set(),
      approval: undefined,
      commandChoices: this.commandChoices(prompt),
    };
    this.runs.set(run.id, run);
    this.prune();
    session.updatedAt = createdAt;
    if (await this.handleLocalCommand(run, prompt)) return run;
    try {
      run.historyMessageIds = new Set(
        (await this.messages(resolvedSessionId)).map((message) => message.id),
      );
    } catch {
      // Gateway history is a fallback for runtimes that do not emit final
      // chat events. A missing snapshot must not prevent a new turn.
    }
    const model = text(requestInput.model);
    const thinkingLevel = text(
      object(requestInput.model_options).reasoning_effort,
    );
    const request = {
      sessionKey: session.sessionKey,
      message: prompt,
      deliver: false,
      idempotencyKey,
      ...(attachments.length ? { attachments } : {}),
    };
    let accepted;
    try {
      if (model || thinkingLevel) {
        await this.control.configure({
          key: session.sessionKey,
          ...(model ? { model } : {}),
          ...(thinkingLevel ? { thinkingLevel } : {}),
        });
      }
      accepted = await this.control.start(request);
    } catch (error) {
      this.runs.delete(run.id);
      throw error;
    }
    const acceptedRunId = text(accepted.runId ?? accepted.run_id);
    if (!acceptedRunId) {
      this.runs.delete(run.id);
      throw new Error("OpenClaw did not return a run ID");
    }
    run.controlRunId = acceptedRunId;
    this.runAliases.set(acceptedRunId, run.id);
    void this.settleRun(run);
    return run;
  }

  async handleLocalCommand(run, prompt) {
    const match = /^\/([^\s]+)(?:\s+(.+?))?\s*$/u.exec(prompt.trim());
    if (!match) return false;
    const name = match[1].toLowerCase();
    const argument = text(match[2]);
    const choices = this.commandChoices(prompt);

    // Picker commands are UI navigation, not agent turns. Returning their
    // choices as a completed run prevents a transient "generating" state and
    // keeps the flow identical to the runtime's Telegram channel.
    const pickerWithoutChoices =
      !argument &&
      ["models", "model", "think", "thinking", "t"].includes(name);
    if (choices.length > 0 || pickerWithoutChoices) {
      this.appendCommandChoices(run);
      if (pickerWithoutChoices) {
        this.append(run, {
          event: "message.delta",
          delta:
            name === "models" || name === "model"
              ? "No model choices are available from this agent."
              : "No reasoning levels are advertised by this agent.",
        });
      }
      this.append(run, { event: "run.completed", output: "" });
      return true;
    }

    if (!argument || !["model", "think", "thinking", "t"].includes(name)) {
      return false;
    }
    const value = argument.split(/\s+/u)[0];
    let message;
    if (name === "model") {
      const model = this.discovery.models.find(
        (entry) => entry.id.toLowerCase() === value.toLowerCase(),
      );
      if (!model) return false;
      try {
        await this.control.configure({
          key: run.sessionKey,
          model: model.id,
        });
      } catch (error) {
        this.append(run, {
          event: "run.failed",
          error:
            error instanceof Error ? error.message : "Model selection failed",
        });
        return true;
      }
      message = `Model set to ${model.display_name ?? model.id}.`;
    } else {
      const level = this.discovery.thinkingLevels.find(
        (entry) => entry.value.toLowerCase() === value.toLowerCase(),
      );
      if (!level) return false;
      try {
        await this.control.configure({
          key: run.sessionKey,
          thinkingLevel: level.value,
        });
      } catch (error) {
        this.append(run, {
          event: "run.failed",
          error:
            error instanceof Error
              ? error.message
              : "Thinking level selection failed",
        });
        return true;
      }
      message = `Thinking level set to ${level.label ?? level.value}.`;
    }
    this.append(run, { event: "message.delta", delta: message });
    this.append(run, { event: "run.completed", output: message });
    return true;
  }

  append(run, event) {
    if (["completed", "failed", "cancelled"].includes(run.status)) return;
    const value = {
      ...event,
      seq: run.nextEventSequence++,
      timestamp: nowSeconds(),
    };
    run.events.push(value);
    if (run.events.length > MAX_EVENTS) run.events.shift();
    run.updatedAt = value.timestamp;
    if (event.event === "message.delta") run.output += event.delta ?? "";
    if (event.event === "approval.request") run.status = "waiting_for_approval";
    if (event.event === "approval.responded") run.status = "running";
    if (event.event === "run.completed") run.status = "completed";
    if (event.event === "run.failed") {
      run.status = "failed";
      run.error = event.error;
    }
    if (event.event === "run.cancelled") run.status = "cancelled";
    for (const listener of run.listeners) listener(value);
    if (["completed", "failed", "cancelled"].includes(run.status)) {
      for (const listener of run.listeners) listener(null);
      run.listeners.clear();
    }
  }

  appendCommandChoices(run) {
    if (!run.commandChoices.length || run.choicesSent) return;
    run.choicesSent = true;
    this.append(run, { event: "command.choices", choices: run.commandChoices });
  }

  appendCumulativeOutput(run, cumulative) {
    if (!cumulative || cumulative === run.output) return;
    if (cumulative.startsWith(run.output)) {
      this.append(run, {
        event: "message.delta",
        delta: cumulative.slice(run.output.length),
      });
      return;
    }
    // A runtime can replace an incomplete streamed response with its final
    // content. The terminal event carries the authoritative replacement.
    run.output = cumulative;
  }

  handleChatEvent(event) {
    const payload = object(event);
    const runId = text(payload.runId ?? payload.run_id);
    const sessionKey = text(payload.sessionKey ?? payload.session_key);
    let run = runId
      ? this.runs.get(this.runAliases.get(runId) ?? runId)
      : undefined;
    // The Gateway can publish the first chat delta before chat.send resolves
    // with its accepted run id. Match that early event by its session key so
    // the initial streamed text is not lost.
    if (!run && sessionKey) {
      run = [...this.runs.values()]
        .reverse()
        .find(
          (candidate) =>
            candidate.sessionKey === sessionKey &&
            !["completed", "failed", "cancelled"].includes(candidate.status),
        );
    }
    if (!run || (sessionKey && sessionKey !== run.sessionKey)) {
      return;
    }
    if (runId) this.runAliases.set(runId, run.id);
    const state = text(payload.state);
    const message = object(payload.message);
    const cumulative = contentText(message.content);
    if (state === "delta") {
      const delta = stringValue(payload.deltaText);
      if (delta) this.append(run, { event: "message.delta", delta });
      else this.appendCumulativeOutput(run, cumulative);
      return;
    }
    if (state === "final") {
      this.appendCumulativeOutput(run, cumulative);
      this.appendCommandChoices(run);
      this.append(run, { event: "run.completed", output: run.output });
    } else if (state === "aborted") {
      this.append(run, { event: "run.cancelled" });
    } else if (state === "error") {
      this.append(run, {
        event: "run.failed",
        error: text(payload.errorMessage) ?? "OpenClaw run failed",
      });
    }
  }

  handleAgentEvent(event) {
    const directId = this.runAliases.get(event.runId) ?? event.runId;
    const directRun = this.runs.get(directId);
    const run =
      directRun ??
      (event.sessionKey
        ? [...this.runs.values()]
            .reverse()
            .find(
              (candidate) =>
                candidate.sessionKey === event.sessionKey &&
                !["completed", "failed", "cancelled"].includes(
                  candidate.status,
                ),
            )
        : undefined);
    if (!run || (event.sessionKey && event.sessionKey !== run.sessionKey))
      return;
    this.runAliases.set(event.runId, run.id);
    const data = object(event.data);
    if (event.stream === "assistant") {
      const delta = stringValue(data.delta);
      const cumulative = stringValue(data.text);
      if (delta) this.append(run, { event: "message.delta", delta });
      else this.appendCumulativeOutput(run, cumulative);
      return;
    }
    if (event.stream === "tool") {
      const phase = text(data.phase);
      // OpenClaw can emit progress updates between a tool's start and result.
      // OR3's Runs surface models lifecycle boundaries, so forwarding updates
      // as new starts would duplicate one invocation in the activity UI.
      if (phase !== "start" && phase !== "result") return;
      this.append(run, {
        event: phase === "result" ? "tool.completed" : "tool.started",
        tool: text(data.name) ?? "Tool",
        preview: text(data.meta),
      });
      return;
    }
    if (event.stream === "approval") {
      const phase = text(data.phase);
      const approvalId = text(
        data.approvalId ?? data.approvalSlug ?? data.itemId,
      );
      if (phase === "requested" && approvalId) {
        run.approval = { id: approvalId, kind: text(data.kind) ?? "exec" };
        this.append(run, {
          event: "approval.request",
          command: text(data.command),
          reason: text(data.reason ?? data.message ?? data.title),
        });
      } else if (phase === "resolved") {
        run.approval = undefined;
        this.append(run, {
          event: "approval.responded",
          choice: data.status === "denied" ? "deny" : "once",
        });
      }
      return;
    }
    if (event.stream === "error") {
      this.append(run, {
        event: "run.failed",
        error: text(data.error ?? data.message) ?? "OpenClaw run failed",
      });
      return;
    }
    if (event.stream === "lifecycle" && data.phase === "error") {
      this.append(run, {
        event: data.aborted ? "run.cancelled" : "run.failed",
        error: text(data.error),
      });
    } else if (event.stream === "lifecycle" && data.phase === "end") {
      this.appendCommandChoices(run);
      this.append(run, {
        event:
          data.aborted || data.status === "cancelled"
            ? "run.cancelled"
            : "run.completed",
        output: run.output,
      });
    }
  }

  async settleRun(run) {
    try {
      let result;
      do {
        result = await this.control.wait({ runId: run.controlRunId ?? run.id });
        if (["completed", "failed", "cancelled"].includes(run.status)) return;
      } while (result.status === "timeout");
      if (result.status === "ok") {
        const hasActiveSessionPeer = [...this.runs.values()].some(
          (candidate) =>
            candidate.id !== run.id &&
            candidate.sessionId === run.sessionId &&
            !["completed", "failed", "cancelled"].includes(candidate.status),
        );
        if (!run.output && run.historyMessageIds && !hasActiveSessionPeer) {
          const messages = await this.messages(run.sessionId);
          const output = [...messages]
            .reverse()
            .find(
              (item) =>
                item.role === "assistant" && !run.historyMessageIds.has(item.id),
            )?.content;
          this.appendCumulativeOutput(run, output);
        }
        this.appendCommandChoices(run);
        this.append(run, { event: "run.completed", output: run.output });
      } else if (result.status === "error") {
        this.append(run, {
          event: "run.failed",
          error: result.error ?? "OpenClaw run failed",
        });
      }
    } catch (error) {
      this.append(run, {
        event: "run.failed",
        error: error instanceof Error ? error.message : "OpenClaw run failed",
      });
    }
  }

  async stopRun(runId) {
    const run = this.runs.get(runId);
    if (!run) throw Object.assign(new Error("Run not found"), { status: 404 });
    const request = {
      sessionKey: run.sessionKey,
      runId: run.controlRunId ?? run.id,
    };
    await this.control.stop(request);
    this.append(run, { event: "run.cancelled" });
    return run;
  }

  async decideRun(runId, choice) {
    const run = this.runs.get(runId);
    if (!run) throw Object.assign(new Error("Run not found"), { status: 404 });
    if (!run.approval)
      throw Object.assign(new Error("No approval is pending"), { status: 409 });
    const decisions = {
      deny: "deny",
      once: "allow-once",
      always: "allow-always",
    };
    if (!Object.hasOwn(decisions, choice)) {
      throw Object.assign(new Error("Unsupported approval choice"), {
        status: 400,
      });
    }
    const decision = decisions[choice];
    const method =
      run.approval.kind === "plugin"
        ? "plugin.approval.resolve"
        : "exec.approval.resolve";
    const request = {
      id: run.approval.id,
      decision,
    };
    await this.control.decide({ method, ...request });
    return run;
  }
}

export function createOr3RunsHttpHandler(
  bridge,
  resolveAccess = () => ({
    token: "",
    allowedOrigins: /** @type {string[]} */ ([]),
  }),
) {
  return async function handle(req, res) {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname.replace(/^\/or3(?=\/|$)/, "") || "/";
    const method = (req.method ?? "GET").toUpperCase();
    try {
      const access = resolveAccess();
      const allowedOrigins = Array.isArray(access.allowedOrigins)
        ? access.allowedOrigins
        : [];
      if (!applyCors(req, res, allowedOrigins)) {
        sendJson(res, 403, { error: { message: "Origin is not allowed" } });
        return true;
      }
      if (method === "OPTIONS") {
        res.statusCode = 204;
        res.end();
        return true;
      }
      if (!text(access.token)) {
        sendJson(res, 503, {
          error: { message: "OR3 plugin token is not configured" },
        });
        return true;
      }
      if (!sameSecret(bearerToken(req), access.token)) {
        sendJson(res, 401, { error: { message: "Unauthorized" } });
        return true;
      }
      if (method === "GET" && path === "/health") {
        sendJson(res, 200, { status: "ok", platform: "openclaw" });
      } else if (method === "GET" && path === "/health/detailed") {
        sendJson(res, 200, { status: "ready", platform: "openclaw" });
      } else if (method === "GET" && path === "/v1/capabilities") {
        sendJson(res, 200, await bridge.capabilities());
      } else if (path === "/api/sessions" && method === "GET") {
        sendJson(res, 200, {
          object: "list",
          data: bridge.listSessions(url.searchParams.get("limit")),
        });
      } else if (path === "/api/sessions" && method === "POST") {
        const body = await readJson(req);
        const session = await bridge.createSession(
          text(body.id ?? body.session_id),
          body.model,
        );
        sendJson(res, 201, {
          object: "openclaw.session",
          session: sessionView(session),
        });
      } else {
        const messagesMatch = /^\/api\/sessions\/([^/]+)\/messages$/.exec(path);
        const sessionMatch = /^\/api\/sessions\/([^/]+)$/.exec(path);
        const eventsMatch = /^\/v1\/runs\/([^/]+)\/events$/.exec(path);
        const stopMatch = /^\/v1\/runs\/([^/]+)\/stop$/.exec(path);
        const approvalMatch = /^\/v1\/runs\/([^/]+)\/approval$/.exec(path);
        const runMatch = /^\/v1\/runs\/([^/]+)$/.exec(path);
        if (method === "GET" && messagesMatch) {
          sendJson(res, 200, {
            object: "list",
            data: await bridge.messages(decodeURIComponent(messagesMatch[1])),
          });
        } else if (method === "GET" && sessionMatch) {
          const session = bridge.ensureSession(
            decodeURIComponent(sessionMatch[1]),
          );
          sendJson(res, 200, {
            object: "openclaw.session",
            session: sessionView(session),
          });
        } else if (method === "POST" && path === "/v1/runs") {
          const body = await readJson(req);
          const run = await bridge.startRun(text(body.session_id), body);
          sendJson(res, 202, runView(run));
        } else if (method === "GET" && runMatch) {
          const run = bridge.runs.get(decodeURIComponent(runMatch[1]));
          if (!run)
            throw Object.assign(new Error("Run not found"), { status: 404 });
          sendJson(res, 200, runView(run));
        } else if (method === "GET" && eventsMatch) {
          const run = bridge.runs.get(decodeURIComponent(eventsMatch[1]));
          if (!run)
            throw Object.assign(new Error("Run not found"), { status: 404 });
          res.statusCode = 200;
          res.setHeader("Cache-Control", "no-store");
          res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
          res.setHeader("Connection", "keep-alive");
          res.write("retry: 1000\n\n");
          let closed = false;
          let replaying = true;
          let terminalDuringReplay = false;
          const queued = [];
          let heartbeat;
          const close = () => {
            if (closed) return;
            closed = true;
            clearInterval(heartbeat);
            run.listeners.delete(listener);
            res.end();
          };
          const listener = (event) => {
            if (!event) {
              if (replaying) terminalDuringReplay = true;
              else close();
            } else if (replaying) {
              queued.push(event);
            } else if (!closed) {
              res.write(`data: ${JSON.stringify(event)}\n\n`);
            }
          };
          // Subscribe before copying the replay window. Events emitted while
          // replaying are queued and de-duplicated by their monotonic seq.
          run.listeners.add(listener);
          const replay = [...run.events];
          const replaySequence = replay.at(-1)?.seq ?? 0;
          for (const event of replay)
            res.write(`data: ${JSON.stringify(event)}\n\n`);
          replaying = false;
          for (const event of queued) {
            if (event.seq > replaySequence && !closed)
              res.write(`data: ${JSON.stringify(event)}\n\n`);
          }
          heartbeat = setInterval(
            () => {
              if (!closed) res.write(": keepalive\n\n");
            },
            SSE_HEARTBEAT_MS,
          );
          req.once("close", () => {
            closed = true;
            clearInterval(heartbeat);
            run.listeners.delete(listener);
          });
          if (
            terminalDuringReplay ||
            ["completed", "failed", "cancelled"].includes(run.status)
          ) {
            close();
          }
        } else if (method === "POST" && stopMatch) {
          sendJson(
            res,
            200,
            runView(await bridge.stopRun(decodeURIComponent(stopMatch[1]))),
          );
        } else if (method === "POST" && approvalMatch) {
          const body = await readJson(req);
          sendJson(
            res,
            200,
            runView(
              await bridge.decideRun(
                decodeURIComponent(approvalMatch[1]),
                body.choice,
              ),
            ),
          );
        } else {
          sendJson(res, 404, { error: { message: "Not found" } });
        }
      }
    } catch (error) {
      const status = Number(error?.status) || 500;
      sendJson(res, status, {
        error: {
          message: status >= 500 ? "OpenClaw request failed" : error.message,
        },
      });
    }
    return true;
  };
}
