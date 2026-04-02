export interface Or3NetExchangeResponse {
    token: string;
    workspace_id: string;
    expires_at: string;
    scopes: string[];
}

export type Or3NetToolPolicyMode =
    | 'allow_all'
    | 'deny_all'
    | 'allow_list'
    | 'deny_list';

export interface Or3NetToolPolicy {
    mode: Or3NetToolPolicyMode;
    allowed_tools: string[];
    blocked_tools: string[];
}

export interface Or3NetNodeRequirements {
    adapter_kind?: 'local' | 'remote' | 'sandbox';
    capabilities: string[];
    isolation_class?: string;
    preferred_node_ids: string[];
}

export interface Or3NetAgent {
    agent_id: string;
    workspace_id: string;
    name: string;
    instructions: string;
    tool_policy: Or3NetToolPolicy;
    node_requirements: Or3NetNodeRequirements;
    created_at?: string;
    updated_at?: string;
}

export interface Or3NetAgentDraftSnapshot {
    agent_id: string;
    name: string;
    instructions: string;
    tool_policy_mode: Or3NetToolPolicyMode;
    allowed_tools_text: string;
    blocked_tools_text: string;
    adapter_kind: '' | 'local' | 'remote' | 'sandbox';
    capabilities_text: string;
    isolation_class: string;
    preferred_node_ids_text: string;
}

export interface Or3NetPreset {
    name: string;
    host_url: string | null;
    execution_target: 'local' | 'remote';
    agent_draft: Or3NetAgentDraftSnapshot;
    created_at: number;
    updated_at: number;
}

export type Or3NetJobStatus =
    | 'pending'
    | 'scheduled'
    | 'running'
    | 'completed'
    | 'failed'
    | 'aborted';

export interface Or3NetJobSummary {
    job_id: string;
    status: Or3NetJobStatus;
    node_id: string | null;
    created_at: string;
    started_at: string | null;
    completed_at: string | null;
    network_session_id?: string | null;
}

export interface Or3NetJobError {
    code?: string;
    message?: string;
    retriable?: boolean;
    details?: Record<string, unknown>;
}

export interface Or3NetJobDetail {
    job_id: string;
    workspace_id: string;
    status: Or3NetJobStatus;
    node_id?: string;
    created_at: string;
    started_at?: string;
    completed_at?: string;
    result?: unknown;
    error?: Or3NetJobError;
}

export interface Or3NetSessionRecord {
    network_session_id: string;
    workspace_id: string;
    client_kind: string;
    client_session_id?: string | null;
    intern_session_key: string;
    initiator_subject?: string | null;
    status: string;
    created_at: string;
    updated_at: string;
    last_job_id?: string | null;
    last_activity_at: string;
    closed_at?: string | null;
}

export interface Or3NetSessionDetail {
    session: Or3NetSessionRecord;
    jobs: Array<Pick<Or3NetJobSummary, 'job_id' | 'status' | 'created_at'>>;
}

export interface Or3NetCreateJobInput {
    session_key?: string;
    network_session_id?: string;
    client_kind?: string;
    client_session_id?: string;
    message: string;
    allowed_tools?: string[];
    meta?: Record<string, unknown>;
    profile_name?: string;
    execution_target?: 'local' | 'remote';
}

export interface Or3NetCreateJobResponse {
    job_id: string;
    status: Or3NetJobStatus;
    workspace_id: string;
}

export interface Or3NetNodeManifest {
    node_id: string;
    adapter_kind: 'local' | 'remote' | 'sandbox' | string;
    capabilities: string[];
    isolation_class: string;
    version: string;
    resource_limits: {
        max_concurrent_jobs: number;
        cpu_cores: number;
        memory_mb: number;
        disk_mb: number;
    };
}

export interface Or3NetNodeRecord {
    workspace_id: string;
    manifest: Or3NetNodeManifest;
    pubkey_fingerprint: string;
    status: string;
    health_status: string;
    approved_at: string | null;
    revoked_at: string | null;
    last_seen_at: string | null;
    last_error: string | null;
    created_at: string;
}

export interface Or3NetNodeService {
    service_id: string;
    label: string;
    status: 'ready' | 'unknown';
    launchable: boolean;
    target_port: number;
}

export interface Or3NetLaunchMetadata {
    preview_id: string;
    workspace_id: string;
    launch_url: string;
    embed_url?: string;
    delivery_mode:
        | 'embedded'
        | 'external'
        | 'embedded-preferred'
        | 'external-preferred';
    supports_iframe: boolean;
    supports_new_tab: boolean;
    reused_tunnel: boolean;
    service_status: 'ready' | 'pending' | 'revoked' | 'expired' | 'error';
    expires_at: string;
}

export interface Or3NetPreviewDescriptor {
    preview_id: string;
    workspace_id: string;
    node_id?: string;
    kind: 'static-site' | 'web-app' | 'dashboard' | 'artifact-preview';
    delivery_mode:
        | 'embedded'
        | 'external'
        | 'embedded-preferred'
        | 'external-preferred';
    source_type: 'files' | 'live-service';
    path?: string;
    port?: number;
    entry_path?: string;
    service_id?: string;
    status: 'ready' | 'pending' | 'revoked' | 'expired' | 'error';
    embed_url?: string;
    launch_url?: string;
    expires_at?: string;
    supports_iframe: boolean;
    supports_new_tab: boolean;
}

export interface Or3NetServiceRestartResponse {
    service_id: string;
    status: 'ready';
}

export type Or3NetJobStreamEvent =
    | { event: 'job.accepted'; data: { job_id: string } }
    | { event: 'job.started'; data: { job_id: string; started_at?: string } }
    | { event: 'text.delta'; data: { text: string } }
    | {
          event: 'tool.call';
          data: {
              name: string;
              tool_call_id?: string;
              arguments?: string | Record<string, unknown>;
          };
      }
    | {
          event: 'tool.result';
          data: {
              name: string;
              tool_call_id?: string;
              result?: string | Record<string, unknown>;
              content?: string;
          };
      }
    | { event: 'job.completed'; data: Record<string, unknown> & { job_id?: string } }
    | { event: 'job.failed'; data: Record<string, unknown> }
    | { event: 'job.aborted'; data: { job_id: string } }
    | { event: 'error'; data: Or3NetErrorEnvelope };

export interface Or3NetErrorEnvelope {
    error?: string;
    code?: string;
    status?: number;
    request_id?: string;
    retry_after_ms?: number;
}

export class Or3NetRequestError extends Error {
    public readonly status: number;
    public readonly code?: string;
    public readonly retryAfterMs?: number;
    public readonly requestId?: string;
    public readonly data?: unknown;

    public constructor(input: {
        message: string;
        status: number;
        code?: string;
        retryAfterMs?: number;
        requestId?: string;
        data?: unknown;
    }) {
        super(input.message);
        this.name = 'Or3NetRequestError';
        this.status = input.status;
        this.code = input.code;
        this.retryAfterMs = input.retryAfterMs;
        this.requestId = input.requestId;
        this.data = input.data;
    }
}

export function normalizeOr3NetHostUrl(value: string | null | undefined): string | null {
    const trimmed = value?.trim() ?? '';
    if (!trimmed) return null;

    try {
        const url = new URL(trimmed);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            return null;
        }
        url.pathname = url.pathname.replace(/\/$/, '');
        url.search = '';
        url.hash = '';
        return url.toString().replace(/\/$/, '');
    } catch {
        return null;
    }
}
