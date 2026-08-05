import { registerPaletteCommand } from "~/core/search/command-palette/registry";
import type {
  PaletteActionResult,
  PaletteCommandHandler,
} from "~/core/search/command-palette/types";
import type { RegistrationHandle } from "~~/shared/plugins/registration-handle";
import type { ExternalAgentController } from "./controller";
import type { ExternalAgentSession } from "./types";

export const EXTERNAL_AGENT_COMMAND_IDS = Object.freeze({
  newSession: "external-agent-new-session",
  running: "external-agent-running",
  approvals: "external-agent-approvals",
  reconnect: "external-agent-reconnect",
});

function unavailable(message: string): PaletteActionResult {
  return {
    ok: false,
    error: { code: "disabled", message },
  };
}

function wrap(
  handler: () => Promise<PaletteActionResult> | PaletteActionResult,
): PaletteCommandHandler {
  return async () => {
    try {
      return await handler();
    } catch (cause) {
      return {
        ok: false,
        error: {
          code: "execution-failed",
          message:
            cause instanceof Error
              ? cause.message
              : "External agent command failed",
          cause,
        },
      };
    }
  };
}

function newest(
  sessions: readonly ExternalAgentSession[],
  predicate: (session: ExternalAgentSession) => boolean,
): ExternalAgentSession | undefined {
  return [...sessions]
    .filter(predicate)
    .sort(
      (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
    )[0];
}

export function registerExternalAgentCommands(input: {
  readonly controller: ExternalAgentController;
  readonly openLauncher: () => Promise<void> | void;
  readonly openSession: (session: ExternalAgentSession) => Promise<void> | void;
}): readonly RegistrationHandle[] {
  const { controller } = input;
  return [
    registerPaletteCommand(
      {
        id: EXTERNAL_AGENT_COMMAND_IDS.newSession,
        label: "New external agent session",
        description:
          "Launch a coding agent through the selected agent service",
        keywords: ["agent", "codex", "opencode", "runner"],
        icon: "i-lucide-bot",
        order: 90,
      },
      wrap(async () => {
        const snapshot = controller.snapshot;
        if (
          snapshot.connectionState !== "online" &&
          snapshot.connectionState !== "degraded"
        ) {
          return unavailable("Connect a trusted host first");
        }
        if (
          !controller
            .availableRunnerOptions()
            .some((runner) => runner.available)
        ) {
          return unavailable("No advertised external agent provider is ready");
        }
        await input.openLauncher();
        return { ok: true };
      }),
    ),
    registerPaletteCommand(
      {
        id: EXTERNAL_AGENT_COMMAND_IDS.running,
        label: "Open running external agent",
        description: "Open the most recently active agent session",
        keywords: ["agent", "running", "session"],
        icon: "i-lucide-play",
        order: 91,
      },
      wrap(async () => {
        const activeHostId = controller.snapshot.activeHostId;
        const session = newest(
          controller.snapshot.sessions,
          (item) =>
            item.hostId === activeHostId &&
            (item.status === "queued" || item.status === "running"),
        );
        if (!session) {
          return unavailable("No external agent is currently running");
        }
        await input.openSession(session);
        return { ok: true };
      }),
    ),
    registerPaletteCommand(
      {
        id: EXTERNAL_AGENT_COMMAND_IDS.approvals,
        label: "Review external agent approvals",
        description: "Open the newest session waiting for approval",
        keywords: ["agent", "approval", "permission"],
        icon: "i-lucide-shield-alert",
        order: 92,
      },
      wrap(async () => {
        const activeHostId = controller.snapshot.activeHostId;
        const session = newest(
          controller.snapshot.sessions,
          (item) =>
            item.hostId === activeHostId &&
            item.approvals.some((approval) => approval.status === "pending"),
        );
        if (!session) {
          return unavailable("No external agent approvals are pending");
        }
        await input.openSession(session);
        return { ok: true };
      }),
    ),
    registerPaletteCommand(
      {
        id: EXTERNAL_AGENT_COMMAND_IDS.reconnect,
        label: "Reconnect external agent host",
        description: "Reconnect the selected trusted agent service",
        keywords: ["agent", "host", "offline", "reconnect"],
        icon: "i-lucide-refresh-cw",
        order: 93,
      },
      wrap(async () => {
        if (!controller.snapshot.activeHostId) {
          return unavailable("No trusted host is selected");
        }
        const connected = await controller.reconnect();
        return connected
          ? { ok: true }
          : unavailable(
              controller.snapshot.connectionError ?? "Host reconnect failed",
            );
      }),
    ),
  ];
}
