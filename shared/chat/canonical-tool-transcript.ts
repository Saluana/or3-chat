export const CANONICAL_TRANSCRIPT_VERSION = 1 as const;

export type CanonicalToolResult = {
    transcriptVersion: typeof CANONICAL_TRANSCRIPT_VERSION;
    kind: 'tool_result';
    turnId: string;
    parentAssistantId: string;
    callId: string;
    toolName: string;
    fingerprint?: string;
    status: 'complete' | 'error';
    result: string;
    error?: string;
};

export function canonicalToolResult(params: Omit<CanonicalToolResult, 'transcriptVersion' | 'kind'>): CanonicalToolResult {
    return {
        transcriptVersion: CANONICAL_TRANSCRIPT_VERSION,
        kind: 'tool_result',
        ...params,
    };
}

export function canonicalToolResultData(record: CanonicalToolResult): Record<string, unknown> {
    return {
        transcript_version: record.transcriptVersion,
        transcript_kind: record.kind,
        turn_id: record.turnId,
        parent_turn_id: record.parentAssistantId,
        parent_assistant_id: record.parentAssistantId,
        tool_call_id: record.callId,
        tool_name: record.toolName,
        tool_fingerprint: record.fingerprint,
        tool_status: record.status,
        tool_error: record.error,
        content: record.result,
    };
}
