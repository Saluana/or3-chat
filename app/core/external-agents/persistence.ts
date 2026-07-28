import { getKvByName, setKvByName } from "~/db/kv";
import { getDefaultDb, getWorkspaceDb } from "~/db/client";
import type {
  ExternalAgentHost,
  ExternalAgentPersistence,
  ExternalAgentPersistenceSnapshot,
  ExternalAgentSessionRef,
} from "./types";

const EXTERNAL_AGENT_CONNECTIONS_KEY = "external-agents.connections.v1";

const EMPTY_SNAPSHOT: ExternalAgentPersistenceSnapshot = Object.freeze({
  hosts: Object.freeze([]),
  activeHostId: null,
  sessionRefs: Object.freeze([]),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseHost(value: unknown): ExternalAgentHost | null {
  if (!isRecord(value)) return null;
  const { id, name, baseUrl, credentialRef, trustedAt, lastConnectedAt } =
    value;
  if (
    typeof id !== "string" ||
    typeof name !== "string" ||
    typeof baseUrl !== "string" ||
    typeof credentialRef !== "string" ||
    typeof trustedAt !== "string"
  ) {
    return null;
  }
  return {
    id,
    name,
    baseUrl,
    credentialRef,
    trustedAt,
    lastConnectedAt:
      typeof lastConnectedAt === "string" ? lastConnectedAt : undefined,
  };
}

function parseSessionRef(value: unknown): ExternalAgentSessionRef | null {
  if (!isRecord(value)) return null;
  const { hostId, remoteSessionId, title, runnerId, updatedAt } = value;
  if (typeof hostId !== "string" || typeof remoteSessionId !== "string") {
    return null;
  }
  return {
    hostId,
    remoteSessionId,
    title: typeof title === "string" ? title : undefined,
    runnerId: typeof runnerId === "string" ? runnerId : undefined,
    updatedAt: typeof updatedAt === "string" ? updatedAt : undefined,
  };
}

export function parseExternalAgentPersistence(
  value: unknown,
): ExternalAgentPersistenceSnapshot {
  if (!isRecord(value)) return EMPTY_SNAPSHOT;
  const hosts = Array.isArray(value.hosts)
    ? value.hosts
        .map(parseHost)
        .filter((item): item is ExternalAgentHost => Boolean(item))
    : [];
  const sessionRefs = Array.isArray(value.sessionRefs)
    ? value.sessionRefs
        .map(parseSessionRef)
        .filter((item): item is ExternalAgentSessionRef => Boolean(item))
    : [];
  const activeHostId =
    typeof value.activeHostId === "string" &&
    hosts.some((host) => host.id === value.activeHostId)
      ? value.activeHostId
      : null;
  return Object.freeze({
    hosts: Object.freeze(hosts),
    activeHostId,
    sessionRefs: Object.freeze(sessionRefs),
  });
}

export function createWorkspaceExternalAgentPersistence(): ExternalAgentPersistence {
  return {
    bind(workspaceId) {
      const targetDb =
        workspaceId === "local"
          ? getDefaultDb()
          : getWorkspaceDb(workspaceId);
      return {
        workspaceId,
        async load() {
          const record = await getKvByName(
            EXTERNAL_AGENT_CONNECTIONS_KEY,
            targetDb,
          );
          if (!record?.value) return EMPTY_SNAPSHOT;
          try {
            return parseExternalAgentPersistence(
              JSON.parse(record.value) as unknown,
            );
          } catch {
            return EMPTY_SNAPSHOT;
          }
        },
        async save(snapshot) {
          await setKvByName(
            EXTERNAL_AGENT_CONNECTIONS_KEY,
            JSON.stringify(snapshot),
            targetDb,
          );
        },
      };
    },
  };
}
