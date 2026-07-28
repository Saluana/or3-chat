import { describe, expect, it } from "vitest";
import {
  presentExternalAgentError,
  projectExternalAgentConversation,
  sanitizeExternalAgentPayload,
} from "../presentation";
import type {
  ExternalAgentSession,
  ExternalAgentTimelineEvent,
} from "../types";

function session(
  overrides: Partial<ExternalAgentSession> = {},
): ExternalAgentSession {
  return {
    hostId: "host-1",
    hostGeneration: 1,
    remoteSessionId: "session-secret",
    appSessionKey: "app-1",
    runnerId: "codex",
    title: "Fix the composer",
    status: "running",
    createdAt: "2026-07-27T10:00:00.000Z",
    updatedAt: "2026-07-27T10:01:00.000Z",
    activeTurnId: "turn-1",
    streamState: "connected",
    turns: [
      {
        id: "turn-1",
        session_id: "session-secret",
        sequence: 1,
        status: "running",
        continuation_mode: "native",
        requested_at: 1_753_611_200_000,
        user_message: "Make Agents feel like Chat",
      },
    ],
    events: [],
    approvals: [],
    artifacts: [],
    ...overrides,
  };
}

function event(
  id: string,
  sequence: number,
  type: ExternalAgentTimelineEvent["type"],
  text?: string,
  payload: Readonly<Record<string, unknown>> = {},
): ExternalAgentTimelineEvent {
  return {
    id,
    hostId: "host-1",
    hostGeneration: 1,
    sessionId: "session-secret",
    turnId: "turn-1",
    sequence,
    occurredAt: "2026-07-27T10:01:00.000Z",
    type,
    text,
    payload,
  };
}

describe("external agent presentation", () => {
  it("reconstructs user and coalesced streaming assistant messages", () => {
    const projection = projectExternalAgentConversation(
      session({
        events: [
          event("1", 1, "message", "Hello", { rawType: "text_delta" }),
          event("2", 2, "message", " world", { rawType: "text_delta" }),
        ],
      }),
    );

    expect(projection.turns).toHaveLength(1);
    expect(projection.turns[0]?.userMessage?.text).toBe(
      "Make Agents feel like Chat",
    );
    expect(projection.turns[0]?.assistantMessage?.text).toBe("Hello world");
    expect(projection.turns[0]?.assistantMessage?.pending).toBe(true);
  });

  it("coalesces repeated tool lifecycle events into one logical item", () => {
    const projection = projectExternalAgentConversation(
      session({
        events: [
          event("1", 1, "tool", undefined, {
            rawType: "tool.started",
            operation_id: "tests",
            name: "vitest",
            status: "running",
          }),
          event("2", 2, "tool", undefined, {
            rawType: "tool.progress",
            operation_id: "tests",
            name: "vitest",
            status: "running",
          }),
          event("3", 3, "tool", undefined, {
            rawType: "tool.completed",
            operation_id: "tests",
            name: "vitest",
            status: "completed",
          }),
        ],
      }),
    );

    expect(projection.turns[0]?.assistantMessage?.toolCalls).toEqual([
      expect.objectContaining({
        id: "tests",
        name: "Running tests",
        status: "complete",
      }),
    ]);
  });

  it("keeps approvals and artifacts associated with their turn", () => {
    const projection = projectExternalAgentConversation(
      session({
        status: "waiting_approval",
        approvals: [
          {
            id: "approval-1",
            turnId: "turn-1",
            title: "Run tests",
            status: "pending",
          },
        ],
        artifacts: [
          {
            id: "artifact-1",
            turnId: "turn-1",
            kind: "diff",
            label: "Composer changes",
            content: "+ polished",
          },
        ],
      }),
    );

    expect(projection.pendingApprovalCount).toBe(1);
    expect(projection.turns[0]?.approvals[0]?.id).toBe("approval-1");
    expect(projection.turns[0]?.artifacts[0]?.label).toBe("Composer changes");
  });

  it("uses terminal canonical turns instead of stale replay status", () => {
    const projection = projectExternalAgentConversation(
      session({
        status: "succeeded",
        turns: [
          {
            id: "turn-1",
            session_id: "session-secret",
            sequence: 1,
            status: "succeeded",
            continuation_mode: "native",
            requested_at: 1,
            completed_at: 2,
            user_message: "Ship it",
            final_text: "Done.",
          },
        ],
        events: [
          event("old", 1, "status", "running", {
            rawType: "runtime.started",
            status: "running",
          }),
        ],
      }),
    );

    expect(projection.turns[0]?.status).toBe("succeeded");
    expect(projection.turns[0]?.assistantMessage?.text).toBe("Done.");
    expect(projection.turns[0]?.assistantMessage?.pending).toBe(false);
  });

  it("drops transport details before they enter presentation state", () => {
    const payload = sanitizeExternalAgentPayload(
      {
        title: "Approval",
        responseHeaders: {
          "set-cookie": "session=secret",
        },
        endpoint: "https://provider.example/v1/jobs/secret",
        job_id: "job-secret",
        message: "https://provider.example/internal",
        status: "pending",
      },
      "approval.requested",
    );

    expect(payload).toEqual({
      title: "Approval",
      status: "pending",
      rawType: "approval.requested",
    });
    expect(JSON.stringify(payload)).not.toContain("secret");
    expect(JSON.stringify(payload)).not.toContain("provider.example");
  });

  it("maps raw provider errors to concise, actionable messages", () => {
    const error = presentExternalAgentError(
      `POST https://provider.example failed: 402 insufficient credits
responseHeaders={"set-cookie":"token=secret"}`,
    );

    expect(error).toEqual({
      message:
        "This agent could not continue because its model account has insufficient credits.",
      action: "provider-settings",
      category: "credits",
    });
    expect(error.message).not.toContain("https://");
    expect(error.message).not.toContain("secret");
  });
});
