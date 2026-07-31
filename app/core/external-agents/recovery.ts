import type { ExternalAgentConnectionState } from "./types";

export type ExternalAgentConversationRecoveryCategory =
  | "offline"
  | "credential"
  | "stale_host"
  | "transient";

function errorStatus(cause: unknown): number | undefined {
  if (!cause || typeof cause !== "object") return undefined;
  const error = cause as {
    status?: unknown;
    statusCode?: unknown;
    data?: { statusCode?: unknown };
  };
  const value = Number(
    error.statusCode ?? error.status ?? error.data?.statusCode,
  );
  return Number.isFinite(value) ? value : undefined;
}

export function classifyExternalAgentConversationLoadError(input: {
  readonly cause: unknown;
  readonly message: string;
  readonly connectionState?: ExternalAgentConnectionState;
}): ExternalAgentConversationRecoveryCategory {
  const status = errorStatus(input.cause);
  const causeMessage =
    input.cause instanceof Error ? input.cause.message : String(input.cause ?? "");
  const message = `${input.message} ${causeMessage}`.toLowerCase();
  if (
    status === 401 ||
    status === 403 ||
    /unauthori[sz]ed|forbidden|credential|access token|sign[ -]?in/.test(message)
  ) {
    return "credential";
  }
  if (
    input.connectionState === "offline" ||
    input.connectionState === "disconnected" ||
    input.connectionState === "connecting" ||
    /offline|network|unreachable|failed to fetch|connection refused|timed out/.test(
      message,
    )
  ) {
    return "offline";
  }
  if (
    status === 404 ||
    /trusted host|unknown host|host no longer|stale|not found/.test(message)
  ) {
    return "stale_host";
  }
  return "transient";
}
