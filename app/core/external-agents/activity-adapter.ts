import {
  activityErr,
  activityOk,
  type ActivityEvent,
  type ActivityRunAction,
  type ActivityRunDetail,
  type ActivityRunSummary,
  type ActivitySource,
} from "~/core/activity/contract";
import type { ExternalAgentController } from "./controller";
import { EXTERNAL_AGENT_ACTIVITY_SOURCE_ID } from "./refs";
import type { ExternalAgentSession, ExternalAgentTimelineEvent } from "./types";

function actionsForSession(
  controller: ExternalAgentController,
  session: ExternalAgentSession,
): readonly ActivityRunAction[] {
  const actions: ActivityRunAction[] = ["open-source"];
  if (controller.canCancel(session)) {
    actions.unshift("cancel");
  }
  if (controller.canDecideApproval(session)) {
    actions.unshift("approve", "deny");
  }
  return actions;
}

function toSummary(
  controller: ExternalAgentController,
  session: ExternalAgentSession,
): ActivityRunSummary {
  return Object.freeze({
    id: session.remoteSessionId,
    sourceId: EXTERNAL_AGENT_ACTIVITY_SOURCE_ID,
    title: session.title,
    kind: "external-agent",
    status: session.status,
    startedAt: session.createdAt,
    updatedAt: session.updatedAt,
    completedAt: session.completedAt,
    summary: `${session.runnerId} on ${session.hostId}`,
    actions: actionsForSession(controller, session),
  });
}

function toActivityEvent(event: ExternalAgentTimelineEvent): ActivityEvent {
  return Object.freeze({
    id: event.id,
    sourceId: EXTERNAL_AGENT_ACTIVITY_SOURCE_ID,
    runId: event.sessionId,
    type: event.type,
    occurredAt: event.occurredAt,
    sequence: event.sequence,
    coalesceKey:
      event.type === "message" ? `${event.turnId}:message` : undefined,
    payload: Object.freeze({
      ...event.payload,
      text: event.text,
      hostId: event.hostId,
      turnId: event.turnId,
    }),
  });
}

function toDetail(
  controller: ExternalAgentController,
  session: ExternalAgentSession,
): ActivityRunDetail {
  return Object.freeze({
    ...toSummary(controller, session),
    events: Object.freeze(session.events.map(toActivityEvent)),
    output: session.output,
    error: session.error,
    approvals: Object.freeze(
      session.approvals.map((approval) => ({
        id: approval.id,
        title: approval.title,
        description: approval.description,
        status: approval.status,
        metadata: Object.freeze({ turnId: approval.turnId }),
      })),
    ),
    artifacts: Object.freeze(
      session.artifacts.map((artifact) => ({
        id: artifact.id,
        kind: artifact.kind,
        label: artifact.label,
        metadata: Object.freeze({
          turnId: artifact.turnId,
          artifactId: artifact.artifactId,
          content: artifact.content,
        }),
      })),
    ),
  });
}

export function createExternalAgentActivitySource(input: {
  readonly controller: ExternalAgentController;
  readonly openSession: (session: ExternalAgentSession) => Promise<void> | void;
}): ActivitySource {
  const { controller } = input;
  return {
    id: EXTERNAL_AGENT_ACTIVITY_SOURCE_ID,
    label: "External Agents",
    actions: ["cancel", "approve", "deny", "open-source"],
    async listRuns(query) {
      const statuses = query.statuses?.length ? new Set(query.statuses) : null;
      const activeHostId = controller.snapshot.activeHostId;
      const sessions = controller.snapshot.sessions
        .filter(
          (session) =>
            session.hostId === activeHostId &&
            (!statuses || statuses.has(session.status)),
        )
        .slice(0, query.limit);
      return activityOk(
        sessions.map((session) => toSummary(controller, session)),
      );
    },
    async getRun(runId) {
      const session = controller.getSession(runId);
      return session
        ? activityOk(toDetail(controller, session))
        : activityErr({
            code: "run_not_found",
            message: "External agent session not found",
            sourceId: EXTERNAL_AGENT_ACTIVITY_SOURCE_ID,
            runId,
          });
    },
    subscribe(subscription) {
      return controller.subscribe((event) => {
        if (
          event.type === "timeline" &&
          (!subscription.runId ||
            subscription.runId === event.session.remoteSessionId)
        ) {
          subscription.onEvent(toActivityEvent(event.event));
          return;
        }
        if (
          event.type === "session" &&
          (!subscription.runId ||
            subscription.runId === event.session.remoteSessionId)
        ) {
          subscription.onEvent({
            id: `${event.session.remoteSessionId}:status:${event.session.status}:${event.session.updatedAt}`,
            sourceId: EXTERNAL_AGENT_ACTIVITY_SOURCE_ID,
            runId: event.session.remoteSessionId,
            type: "status",
            occurredAt: event.session.updatedAt,
            payload: {
              status: event.session.status,
              hostId: event.session.hostId,
            },
          });
        }
      });
    },
    async executeAction(action) {
      const session = controller.getSession(action.runId);
      if (!session) {
        return activityErr({
          code: "run_not_found",
          message: "External agent session not found",
          sourceId: EXTERNAL_AGENT_ACTIVITY_SOURCE_ID,
          runId: action.runId,
        });
      }
      try {
        if (action.action === "open-source") {
          await input.openSession(session);
          return activityOk(undefined);
        }
        if (action.action === "cancel") {
          if (!controller.canCancel(session)) {
            return activityErr({
              code: "capability_unavailable",
              message: "This external agent has no cancellable active turn",
              sourceId: EXTERNAL_AGENT_ACTIVITY_SOURCE_ID,
              runId: action.runId,
            });
          }
          await controller.cancel(action.runId);
          return activityOk(undefined);
        }
        if (action.action === "approve" || action.action === "deny") {
          const approvalId =
            typeof action.payload?.approvalId === "string"
              ? action.payload.approvalId
              : undefined;
          if (!controller.canDecideApproval(session, approvalId)) {
            return activityErr({
              code: "capability_unavailable",
              message: "This external agent has no actionable approval",
              sourceId: EXTERNAL_AGENT_ACTIVITY_SOURCE_ID,
              runId: action.runId,
            });
          }
          await controller.decideApproval(
            action.runId,
            action.action,
            approvalId,
          );
          return activityOk(undefined);
        }
        return activityErr({
          code: "capability_unavailable",
          message: `External Agents does not support "${action.action}"`,
          sourceId: EXTERNAL_AGENT_ACTIVITY_SOURCE_ID,
          runId: action.runId,
        });
      } catch (cause) {
        return activityErr({
          code: "source_failure",
          message:
            session.actionError ??
            (cause instanceof Error
              ? cause.message
              : "External agent action failed"),
          sourceId: EXTERNAL_AGENT_ACTIVITY_SOURCE_ID,
          runId: action.runId,
          cause,
        });
      }
    },
  };
}
