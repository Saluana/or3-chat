export type ExternalAgentConnectionState =
  | "disconnected"
  | "connecting"
  | "online"
  | "offline"
  | "degraded";

export type ExternalAgentRunStatus =
  | "queued"
  | "running"
  | "waiting_approval"
  | "succeeded"
  | "failed"
  | "cancelled";

export type ExternalAgentDriver = "intern" | "runs";

export interface ExternalAgentHost {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly credentialRef: string;
  readonly driver?: ExternalAgentDriver;
  readonly trustedAt: string;
  readonly lastConnectedAt?: string;
}

export function externalAgentDriver(
  host: Pick<ExternalAgentHost, "driver">,
): ExternalAgentDriver {
  return host.driver ?? "intern";
}

export interface ExternalAgentHostHealth {
  readonly status: string;
  readonly runtimeAvailable: boolean;
  readonly [key: string]: unknown;
}

export interface ExternalAgentHostReadiness {
  readonly status: string;
  readonly ready: boolean;
  readonly [key: string]: unknown;
}

export interface ExternalAgentCapabilities {
  readonly hostId: string;
  readonly execAvailable: boolean;
  readonly approvalBroker?: Readonly<Record<string, unknown>>;
  readonly approvals?: Readonly<Record<string, string>>;
  readonly [key: string]: unknown;
}

export interface ExternalAgentRunner {
  readonly id: string;
  readonly display_name: string;
  readonly status: string;
  readonly auth_status: string;
  readonly supports: Readonly<Record<string, unknown>>;
  readonly chat_capabilities?: Readonly<Record<string, unknown>>;
  readonly default_mode?: string;
  readonly default_isolation?: string;
  readonly default_cwd?: string;
  readonly models?: readonly Readonly<Record<string, unknown>>[];
  readonly commands?: readonly ExternalAgentCommand[];
  readonly runtime?: Readonly<Record<string, unknown>>;
  readonly [key: string]: unknown;
}

export interface ExternalAgentCommandChoice {
  readonly label: string;
  readonly command: string;
}

export interface ExternalAgentCommandArgument {
  readonly name: string;
  readonly description?: string;
  readonly required?: boolean;
  readonly dynamic?: boolean;
  readonly choices?: readonly Readonly<{ value: string; label: string }>[];
}

export interface ExternalAgentCommand {
  readonly name: string;
  readonly command: string;
  readonly description: string;
  readonly category?: string;
  readonly accepts_args?: boolean;
  readonly args?: readonly ExternalAgentCommandArgument[];
}

export interface ExternalAgentModelReasoning {
  readonly values: readonly string[];
  readonly defaultValue?: string;
}

export interface ExternalRemoteSession {
  readonly id: string;
  readonly app_session_key: string;
  readonly runner_id: string;
  readonly continuation_mode: string;
  readonly created_at: number;
  readonly updated_at: number;
  readonly model?: string;
  readonly mode?: string;
  readonly isolation?: string;
  readonly cwd?: string;
  readonly [key: string]: unknown;
}

export interface ExternalRemoteTurn {
  readonly id: string;
  readonly session_id: string;
  readonly sequence: number;
  readonly status: string;
  readonly continuation_mode: string;
  readonly requested_at: number;
  readonly started_at?: number;
  readonly completed_at?: number;
  readonly user_message?: string;
  readonly final_text?: string;
  readonly error?: string;
  readonly runner_job_id?: string;
  readonly model?: string;
  readonly mode?: string;
  readonly isolation?: string;
  readonly cwd?: string;
  readonly thinking_level?: string;
  readonly [key: string]: unknown;
}

export interface ExternalRemoteEvent {
  readonly id?: number;
  readonly turn_id: string;
  readonly seq: number;
  readonly ts?: number;
  readonly type: string;
  readonly stream?: string;
  readonly text?: string;
  readonly job_id?: string;
  readonly payload?: unknown;
  readonly [key: string]: unknown;
}

export interface ExternalRemoteStreamEvent {
  readonly event?: string;
  readonly id?: string;
  readonly cursor?: string | number;
  readonly json?: unknown;
  readonly data?: string;
}

export interface ExternalRemoteArtifact {
  readonly id: string;
  readonly mime: string;
  readonly size_bytes: number;
  readonly offset: number;
  readonly read_bytes: number;
  readonly truncated: boolean;
  readonly content: string;
  readonly [key: string]: unknown;
}

export interface ExternalAgentTimelineEvent {
  readonly id: string;
  readonly hostId: string;
  readonly hostGeneration: number;
  readonly sessionId: string;
  readonly turnId: string;
  readonly sequence: number;
  readonly occurredAt: string;
  readonly type:
    | "status"
    | "message"
    | "tool"
    | "approval"
    | "artifact"
    | "error"
    | "metric";
  readonly text?: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface ExternalAgentApproval {
  readonly id: string;
  readonly turnId: string;
  readonly title: string;
  readonly description?: string;
  readonly status: "pending" | "approved" | "denied" | "cancelled";
}

export interface ExternalAgentArtifact {
  readonly id: string;
  readonly turnId: string;
  readonly kind: "diff" | "file" | "artifact";
  readonly label: string;
  readonly content?: string;
  readonly artifactId?: string;
}

export interface ExternalAgentSession {
  readonly hostId: string;
  readonly hostGeneration: number;
  readonly remoteSessionId: string;
  readonly appSessionKey: string;
  readonly runnerId: string;
  title: string;
  status: ExternalAgentRunStatus;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  activeTurnId?: string;
  model?: string;
  mode?: string;
  isolation?: string;
  cwd?: string;
  thinkingLevel?: string;
  output?: string;
  error?: string;
  actionError?: string;
  streamState: "idle" | "connecting" | "connected" | "disconnected";
  turns: ExternalRemoteTurn[];
  events: ExternalAgentTimelineEvent[];
  approvals: ExternalAgentApproval[];
  artifacts: ExternalAgentArtifact[];
}

export interface ExternalAgentSessionRef {
  readonly hostId: string;
  readonly remoteSessionId: string;
  readonly title?: string;
  readonly runnerId?: string;
  readonly updatedAt?: string;
  readonly status?: ExternalAgentRunStatus;
  readonly pendingApprovalCount?: number;
  readonly preview?: string;
  readonly model?: string;
  readonly thinkingLevel?: string;
  readonly activeTurnId?: string;
}

export interface ExternalAgentPersistenceSnapshot {
  readonly hosts: readonly ExternalAgentHost[];
  readonly activeHostId: string | null;
  readonly sessionRefs: readonly ExternalAgentSessionRef[];
}

export interface ExternalAgentPersistenceLease {
  readonly workspaceId: string;
  load(): Promise<ExternalAgentPersistenceSnapshot>;
  save(snapshot: ExternalAgentPersistenceSnapshot): Promise<void>;
}

export interface ExternalAgentPersistence {
  bind(workspaceId: string): ExternalAgentPersistenceLease;
}

export interface ExternalAgentCredentialVault {
  put(reference: string, secret: string): Promise<void>;
  resolve(reference: string): Promise<string | null>;
  remove(reference: string): Promise<void>;
}

export interface ExternalAgentPinCredentialVaultStatus {
  readonly supported: boolean;
  readonly configured: boolean;
  readonly locked: boolean;
  readonly persistedCredentialCount: number;
}

export interface ExternalAgentPinCredentialVault extends ExternalAgentCredentialVault {
  readonly supportsPinPersistence: true;
  getStatus(): ExternalAgentPinCredentialVaultStatus;
  hasPersistent?(reference: string): boolean;
  putPersistent(reference: string, secret: string, pin: string): Promise<void>;
  unlock(pin: string): Promise<void>;
  lock(): void;
}

export interface ExternalAgentCreateSessionInput {
  readonly app_session_key: string;
  readonly runner_id: string;
  readonly continuation_mode?: string;
  readonly model?: string;
  readonly mode?: string;
  readonly isolation?: string;
  readonly cwd?: string;
  readonly max_turns?: number;
  readonly approval_autopilot?: boolean;
}

export interface ExternalAgentStartTurnInput {
  readonly user_message: string;
  readonly attachments?: readonly ExternalAgentAttachment[];
  readonly continuation_mode?: string;
  readonly model?: string;
  readonly mode?: string;
  readonly isolation?: string;
  readonly cwd?: string;
  readonly max_turns?: number;
  readonly timeout_seconds?: number;
  readonly thinking_level?: string;
  readonly approval_token?: string;
  readonly approval_autopilot?: boolean;
}

export type ExternalAgentAttachmentKind =
  | "file"
  | "image"
  | "audio"
  | "video"
  | "text";

export interface ExternalAgentUploadAttachment {
  readonly id: string;
  readonly kind: ExternalAgentAttachmentKind;
  readonly name: string;
  readonly mimeType?: string;
  readonly sizeBytes?: number;
  readonly data: Blob;
}

export interface ExternalAgentAttachment {
  readonly id: string;
  readonly source: "workspace_ref" | "local_artifact" | "text_block";
  readonly kind: ExternalAgentAttachmentKind;
  readonly name: string;
  readonly mime_type?: string;
  readonly size_bytes?: number;
  readonly root_id?: string;
  readonly path?: string;
  readonly artifact_id?: string;
  readonly preview?: string;
  readonly content_excerpt?: string;
}

export interface ExternalAgentApprovalInput {
  readonly note?: string;
  readonly allow_session?: boolean;
  readonly allowlist?: boolean;
}

export interface ExternalAgentClient {
  health(options?: { signal?: AbortSignal }): Promise<ExternalAgentHostHealth>;
  readiness(options?: {
    signal?: AbortSignal;
  }): Promise<ExternalAgentHostReadiness>;
  capabilities(options?: {
    signal?: AbortSignal;
  }): Promise<ExternalAgentCapabilities>;
  listRunners(options?: { signal?: AbortSignal }): Promise<{
    runners: ExternalAgentRunner[];
    default_runner?: string;
  }>;
  createSession(
    input: ExternalAgentCreateSessionInput,
    options?: { signal?: AbortSignal },
  ): Promise<ExternalRemoteSession>;
  listSessions(
    input?: {
      readonly appSessionKeyPrefix?: string;
      readonly limit?: number;
    },
    options?: { signal?: AbortSignal },
  ): Promise<{ sessions: ExternalRemoteSession[] }>;
  getSession(
    sessionId: string,
    options?: { signal?: AbortSignal },
  ): Promise<ExternalRemoteSession>;
  listTurns(
    sessionId: string,
    input?: { limit?: number; signal?: AbortSignal },
  ): Promise<{ turns: ExternalRemoteTurn[] }>;
  startTurn(
    sessionId: string,
    input: ExternalAgentStartTurnInput,
    options?: { signal?: AbortSignal },
  ): Promise<{
    session_id: string;
    turn_id: string;
    job_id?: string;
    status: string;
  }>;
  stageFiles(
    attachments: readonly ExternalAgentUploadAttachment[],
    options?: { signal?: AbortSignal },
  ): Promise<readonly ExternalAgentAttachment[]>;
  getTurn(
    sessionId: string,
    turnId: string,
    options?: { signal?: AbortSignal },
  ): Promise<ExternalRemoteTurn>;
  listTurnEvents(
    sessionId: string,
    turnId: string,
    input?: { afterSeq?: number; limit?: number; signal?: AbortSignal },
  ): Promise<{ events: ExternalRemoteEvent[] }>;
  streamTurn(
    sessionId: string,
    turnId: string,
    input?: { afterSeq?: number; signal?: AbortSignal },
  ): AsyncIterable<ExternalRemoteStreamEvent>;
  abortTurn(
    sessionId: string,
    turnId: string,
    options?: { signal?: AbortSignal },
  ): Promise<Readonly<Record<string, unknown>>>;
  decideTurn(
    sessionId: string,
    turnId: string,
    decision: "approve" | "reject" | "cancel",
    input?: ExternalAgentApprovalInput,
    options?: { signal?: AbortSignal },
  ): Promise<Readonly<Record<string, unknown>>>;
  readArtifact(
    artifactId: string,
    input: {
      readonly sessionKey: string;
      readonly offset?: number;
      readonly maxBytes?: number;
    },
    options?: { signal?: AbortSignal },
  ): Promise<ExternalRemoteArtifact>;
}

export type ExternalAgentClientFactory = (input: {
  host: ExternalAgentHost;
  resolveCredential: () => Promise<string | null>;
}) => ExternalAgentClient;

export type ExternalAgentDriverDetector = (input: {
  readonly baseUrl: string;
  readonly resolveCredential: () => Promise<string | null>;
}) => Promise<ExternalAgentDriver>;

export interface ExternalAgentLaunchInput {
  readonly runnerId: string;
  readonly instruction: string;
  readonly cwd?: string;
  readonly mode: string;
  readonly isolation: string;
  readonly model?: string;
  readonly thinkingLevel?: string;
  readonly continuationMode?: string;
  readonly confirmDangerous?: boolean;
  readonly attachments?: readonly ExternalAgentUploadAttachment[];
}

export interface ExternalAgentFollowUpInput {
  readonly instruction: string;
  readonly cwd?: string;
  readonly mode: string;
  readonly isolation: string;
  readonly model?: string;
  readonly thinkingLevel?: string;
  readonly confirmDangerous?: boolean;
  readonly attachments?: readonly ExternalAgentUploadAttachment[];
}

export interface ExternalAgentStoreSnapshot {
  readonly hosts: readonly ExternalAgentHost[];
  readonly activeHostId: string | null;
  readonly connectionState: ExternalAgentConnectionState;
  readonly connectionError: string | null;
  readonly generation: number;
  readonly health: ExternalAgentHostHealth | null;
  readonly readiness: ExternalAgentHostReadiness | null;
  readonly capabilities: ExternalAgentCapabilities | null;
  readonly runners: readonly ExternalAgentRunner[];
  readonly sessions: readonly ExternalAgentSession[];
  readonly sessionRefs: readonly ExternalAgentSessionRef[];
}

export type ExternalAgentStoreEvent =
  | {
      readonly type: "snapshot";
      readonly snapshot: ExternalAgentStoreSnapshot;
    }
  | {
      readonly type: "session";
      readonly session: ExternalAgentSession;
    }
  | {
      readonly type: "timeline";
      readonly session: ExternalAgentSession;
      readonly event: ExternalAgentTimelineEvent;
    };
