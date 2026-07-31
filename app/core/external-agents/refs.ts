import type { ExternalAgentSessionRef } from "./types";

export const EXTERNAL_AGENT_PANE_APP_ID = "or3-external-agent";
export const EXTERNAL_AGENTS_SIDEBAR_PAGE_ID = "or3-external-agents";
export const EXTERNAL_AGENT_ACTIVITY_SOURCE_ID = "external-agents";
export const EXTERNAL_AGENT_LAUNCHER_REF = "new";
export const EXTERNAL_AGENT_OPEN_CONNECTIONS_EVENT =
  "or3:external-agents:open-connections";

export function encodeExternalAgentSessionRef(
  ref: Pick<ExternalAgentSessionRef, "hostId" | "remoteSessionId">,
): string {
  return encodeURIComponent(JSON.stringify([ref.hostId, ref.remoteSessionId]));
}

export function decodeExternalAgentSessionRef(
  value: string | null | undefined,
): Pick<ExternalAgentSessionRef, "hostId" | "remoteSessionId"> | null {
  if (!value || value === EXTERNAL_AGENT_LAUNCHER_REF) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as unknown;
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      typeof parsed[0] !== "string" ||
      typeof parsed[1] !== "string" ||
      !parsed[0] ||
      !parsed[1]
    ) {
      return null;
    }
    return { hostId: parsed[0], remoteSessionId: parsed[1] };
  } catch {
    return null;
  }
}
