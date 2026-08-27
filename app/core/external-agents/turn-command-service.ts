import type {
  ExternalAgentApprovalInput,
  ExternalAgentAttachment,
  ExternalAgentClient,
  ExternalAgentCreateSessionInput,
  ExternalAgentStartTurnInput,
  ExternalAgentStagingCleanupResult,
  ExternalAgentUploadAttachment,
} from "./types";

/**
 * Narrow transport boundary for mutating an external-agent turn. Canonical UI
 * state stays in the coordinator and session repository.
 */
export class ExternalAgentTurnCommandService {
  createSession(
    client: ExternalAgentClient,
    input: ExternalAgentCreateSessionInput,
    signal?: AbortSignal,
  ) {
    return client.createSession(input, { signal });
  }

  stageFiles(
    client: ExternalAgentClient,
    uploads: readonly ExternalAgentUploadAttachment[],
    signal?: AbortSignal,
  ) {
    return uploads.length
      ? client.stageFiles(uploads, { signal })
      : Promise.resolve([]);
  }

  releaseFiles(
    client: ExternalAgentClient,
    attachments: readonly ExternalAgentAttachment[],
  ): Promise<ExternalAgentStagingCleanupResult | undefined> {
    return Promise.resolve(client.releaseStagedFiles?.(attachments));
  }

  startTurn(
    client: ExternalAgentClient,
    sessionId: string,
    input: ExternalAgentStartTurnInput,
    signal?: AbortSignal,
  ) {
    return client.startTurn(sessionId, input, { signal });
  }

  cancel(
    client: ExternalAgentClient,
    sessionId: string,
    turnId: string,
    signal?: AbortSignal,
  ) {
    return client.abortTurn(sessionId, turnId, { signal });
  }

  decide(
    client: ExternalAgentClient,
    sessionId: string,
    turnId: string,
    decision: "approve" | "reject" | "cancel",
    input: ExternalAgentApprovalInput,
    signal?: AbortSignal,
  ) {
    return client.decideTurn(sessionId, turnId, decision, input, { signal });
  }

  readArtifact(
    client: ExternalAgentClient,
    artifactId: string,
    sessionKey: string,
    signal?: AbortSignal,
  ) {
    return client.readArtifact(
      artifactId,
      { sessionKey, maxBytes: 256 * 1024 },
      { signal },
    );
  }
}
