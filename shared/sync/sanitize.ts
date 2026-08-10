/**
 * Shared payload sanitization for sync operations
 *
 * This utility ensures consistent sanitization of payloads before
 * they are sent to the sync backend.
 */
import { toServerFormat } from './field-mappings';

/** Tables that require a `deleted` field */
const TABLES_WITH_DELETED = ['threads', 'messages', 'projects', 'posts', 'kv', 'file_meta', 'notifications'];

/** Max inline data URL size in bytes (anything larger will be stripped) */
const MAX_INLINE_DATA_URL_SIZE = 10000; // 10KB - small icons/thumbnails OK, large images stripped
/** Max recursive depth when sanitizing nested payloads */
const MAX_SANITIZE_DEPTH = 20;
/** Shared per-operation payload ceiling enforced by every sync provider. */
export const MAX_SYNC_PAYLOAD_BYTES = 256 * 1024;
/** Message payloads are compacted before they exceed the provider ceiling. */
const MAX_SYNC_MESSAGE_PAYLOAD_BYTES = MAX_SYNC_PAYLOAD_BYTES;
/** Truncation marker used when compacting oversized sync payloads */
const SYNC_TRUNCATED_MARKER = '[truncated-for-sync]';

/**
 * Sanitize a payload for sync by removing internal/derived fields
 *
 * @param tableName - The table the payload belongs to
 * @param payload - The raw payload to sanitize
 * @param operation - Whether this is a put or delete operation
 * @returns Sanitized payload or undefined for delete operations with no payload
 */
export function sanitizePayloadForSync(
    tableName: string,
    payload: unknown,
    operation: 'put' | 'delete'
): Record<string, unknown> | undefined {
    // If no payload provided or invalid type, return undefined
    if (!payload || typeof payload !== 'object') {
        return undefined;
    }

    // Filter out dotted keys (Dexie compound index artifacts)
    const sanitized = { ...(payload as Record<string, unknown>) };
    for (const key in sanitized) {
        if (key.includes('.')) {
            delete sanitized[key];
        }
    }

    // Remove HLC - it's stored separately in the stamp
    delete sanitized.hlc;

    // Remove derived fields
    if (tableName === 'file_meta') {
        // ref_count is derived locally, not synced
        delete sanitized.ref_count;
    }

    // Ensure required `deleted` field exists for synced tables
    // Legacy local data may not have this field
    if (TABLES_WITH_DELETED.includes(tableName) && sanitized.deleted === undefined) {
        sanitized.deleted = operation === 'delete' ? true : false;
    }

    // Ensure required `forked` field exists for threads
    // Legacy local threads may not have this field
    if (tableName === 'threads' && sanitized.forked === undefined) {
        sanitized.forked = false;
    }

    // Backfill required thread fields for legacy records that predate the sync schema.
    // Without these, ThreadPayloadSchema rejects the entire push batch.
    if (tableName === 'threads') {
        const now = Date.now();
        if (sanitized.status === undefined) sanitized.status = 'ready';
        if (sanitized.pinned === undefined) sanitized.pinned = false;
        if (typeof sanitized.created_at !== 'number') sanitized.created_at = now;
        if (typeof sanitized.updated_at !== 'number') sanitized.updated_at = now;
        if (typeof sanitized.clock !== 'number') sanitized.clock = 0;
    }

    // Convert error: null to undefined for Convex schema compatibility
    // (Convex expects v.optional(v.string()), so null is invalid but undefined is fine)
    if (tableName === 'messages' && sanitized.error === null) {
        delete sanitized.error;
    }

    // Convert value: null to undefined for KV Convex schema compatibility
    // (Convex expects v.optional(v.string()), so null is invalid but undefined is fine)
    if (tableName === 'kv' && sanitized.value === null) {
        delete sanitized.value;
    }

    // Strip large base64 data URLs from message attachments
    // File content should be synced via file_meta/file_blobs, not embedded in messages
    if (tableName === 'messages' && sanitized.data) {
        sanitized.data = stripLargeDataUrls(sanitized.data as Record<string, unknown>);
    }

    // Handle snake_case/camelCase mapping for posts
    const wirePayload = toServerFormat(tableName, sanitized);

    if (tableName === 'messages' && operation === 'put') {
        return compactMessagePayloadForSync(wirePayload);
    }

    return wirePayload;
}

/**
 * Recursively strip large base64 data URLs from an object.
 * Preserves small data URLs (icons, thumbnails) but removes large embedded images.
 */
function stripLargeDataUrls(data: unknown, depth = 0): unknown {
    if (depth >= MAX_SANITIZE_DEPTH) {
        return '[max-depth-stripped]';
    }

    if (data === null || data === undefined) {
        return data;
    }

    if (typeof data === 'string') {
        // Check if it's a data URL that's too large
        if (data.startsWith('data:') && data.length > MAX_INLINE_DATA_URL_SIZE) {
            // Return placeholder indicating the data was stripped
            return '[data-url-stripped]';
        }
        return data;
    }

    if (Array.isArray(data)) {
        return data.map((item) => stripLargeDataUrls(item, depth + 1));
    }

    if (typeof data === 'object') {
        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
            result[key] = stripLargeDataUrls(value, depth + 1);
        }
        return result;
    }

    return data;
}

function compactMessagePayloadForSync(
    payload: Record<string, unknown>
): Record<string, unknown> {
    const sizeBytes = getPayloadSizeBytes(payload);
    if (sizeBytes <= MAX_SYNC_MESSAGE_PAYLOAD_BYTES) {
        return payload;
    }

    const data = toRecord(payload.data);
    if (data.type === 'workflow-execution') {
        const compacted = {
            ...payload,
            data: compactWorkflowDataForSync(data),
        };
        if (getPayloadSizeBytes(compacted) <= MAX_SYNC_MESSAGE_PAYLOAD_BYTES) {
            return compacted;
        }

        // A workflow can legitimately contain several long competing drafts.
        // Keep an even smaller cross-device status snapshot rather than
        // rejecting the local write. The full node outputs remain in Dexie and
        // the durable background job; only the sync operation is compacted.
        const minimal = {
            ...payload,
            data: compactWorkflowDataForSync(data, { minimal: true }),
        };
        if (getPayloadSizeBytes(minimal) <= MAX_SYNC_MESSAGE_PAYLOAD_BYTES) {
            return minimal;
        }
    }

    throw new SyncPayloadTooLargeError('messages', sizeBytes, MAX_SYNC_MESSAGE_PAYLOAD_BYTES);
}

export class SyncPayloadTooLargeError extends Error {
    readonly code = 'OVERSIZED' as const;

    constructor(
        readonly tableName: string,
        readonly sizeBytes: number,
        readonly maxBytes: number
    ) {
        super(`Payload too large for ${tableName}: ${sizeBytes} bytes exceeds ${maxBytes} bytes`);
        this.name = 'SyncPayloadTooLargeError';
    }
}

function compactWorkflowDataForSync(
    data: Record<string, unknown>,
    options: { minimal?: boolean } = {}
): Record<string, unknown> {
    const minimal = options.minimal === true;
    const compacted: Record<string, unknown> = {
        type: 'workflow-execution',
        workflowId:
            typeof data.workflowId === 'string' ? data.workflowId : undefined,
        workflowName:
            typeof data.workflowName === 'string'
                ? truncateString(data.workflowName, 200)
                : undefined,
        prompt:
            typeof data.prompt === 'string'
                ? truncateString(data.prompt, 2000)
                : undefined,
        executionState:
            typeof data.executionState === 'string'
                ? data.executionState
                : undefined,
        executionOrder: limitStringArray(data.executionOrder, minimal ? 32 : 64),
        currentNodeId:
            typeof data.currentNodeId === 'string' || data.currentNodeId === null
                ? data.currentNodeId
                : null,
        lastActiveNodeId:
            typeof data.lastActiveNodeId === 'string' ||
            data.lastActiveNodeId === null
                ? data.lastActiveNodeId
                : undefined,
        finalNodeId:
            typeof data.finalNodeId === 'string' || data.finalNodeId === null
                ? data.finalNodeId
                : undefined,
        failedNodeId:
            typeof data.failedNodeId === 'string' || data.failedNodeId === null
                ? data.failedNodeId
                : undefined,
        finalOutput:
            typeof data.finalOutput === 'string'
                ? truncateString(data.finalOutput, minimal ? 4000 : 6000)
                : undefined,
        imageCaption:
            typeof data.imageCaption === 'string'
                ? truncateString(data.imageCaption, 1000)
                : undefined,
        background_job_id:
            typeof data.background_job_id === 'string'
                ? truncateString(data.background_job_id, 200)
                : undefined,
        background_job_status:
            typeof data.background_job_status === 'string'
                ? data.background_job_status
                : undefined,
        background_job_error:
            typeof data.background_job_error === 'string'
                ? truncateString(data.background_job_error, 1000)
                : undefined,
    };

    const attachments = compactAttachments(data.attachments, minimal);
    if (attachments) {
        compacted.attachments = attachments;
    }

    const nodeStates = compactNodeStates(data.nodeStates, minimal);
    if (nodeStates) {
        compacted.nodeStates = nodeStates;
    }

    const branches = compactBranches(data.branches, minimal);
    if (branches) {
        compacted.branches = branches;
    }

    const nodeOutputs = compactStringMap(
        data.nodeOutputs,
        minimal ? 8 : 16,
        minimal ? 400 : 600
    );
    if (nodeOutputs) {
        compacted.nodeOutputs = nodeOutputs;
    }

    const resumeState = compactResumeState(data.resumeState, minimal);
    if (resumeState) {
        compacted.resumeState = resumeState;
    }

    const resultSummary = compactResultSummary(data.result);
    if (resultSummary) {
        compacted.result = resultSummary;
    }

    return compacted;
}

function compactAttachments(
    value: unknown,
    minimal: boolean
): Array<Record<string, unknown>> | undefined {
    if (!Array.isArray(value)) return undefined;
    return value.slice(0, minimal ? 4 : 8).map((entry) => {
        const source = toRecord(entry);
        return {
            id: typeof source.id === 'string' ? source.id : undefined,
            type: typeof source.type === 'string' ? source.type : undefined,
            name:
                typeof source.name === 'string'
                    ? truncateString(source.name, 200)
                    : undefined,
            mimeType:
                typeof source.mimeType === 'string'
                    ? truncateString(source.mimeType, 120)
                    : undefined,
            url:
                typeof source.url === 'string'
                    ? truncateString(source.url, 600)
                    : undefined,
        };
    });
}

function compactNodeStates(
    value: unknown,
    minimal: boolean
): Record<string, Record<string, unknown>> | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const entries = Object.entries(value as Record<string, unknown>).slice(
        0,
        minimal ? 16 : 24
    );
    if (!entries.length) return undefined;
    const result: Record<string, Record<string, unknown>> = {};
    for (const [nodeId, nodeValue] of entries) {
        const node = toRecord(nodeValue);
        result[nodeId] = {
            status: typeof node.status === 'string' ? node.status : undefined,
            label:
                typeof node.label === 'string'
                    ? truncateString(node.label, 200)
                    : undefined,
            type: typeof node.type === 'string' ? node.type : undefined,
            modelId:
                typeof node.modelId === 'string'
                    ? truncateString(node.modelId, 200)
                    : undefined,
            route:
                typeof node.route === 'string'
                    ? truncateString(node.route, 200)
                    : undefined,
            output:
                typeof node.output === 'string'
                    ? truncateString(node.output, minimal ? 300 : 700)
                    : undefined,
            error:
                typeof node.error === 'string'
                    ? truncateString(node.error, 500)
                    : undefined,
            startedAt:
                typeof node.startedAt === 'number' ? node.startedAt : undefined,
            finishedAt:
                typeof node.finishedAt === 'number' ? node.finishedAt : undefined,
            tokenCount:
                typeof node.tokenCount === 'number' ? node.tokenCount : undefined,
        };
    }
    return result;
}

function compactBranches(
    value: unknown,
    minimal: boolean
): Record<string, Record<string, unknown>> | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const entries = Object.entries(value as Record<string, unknown>).slice(
        0,
        minimal ? 8 : 12
    );
    if (!entries.length) return undefined;
    const result: Record<string, Record<string, unknown>> = {};
    for (const [branchId, branchValue] of entries) {
        const branch = toRecord(branchValue);
        result[branchId] = {
            id:
                typeof branch.id === 'string'
                    ? truncateString(branch.id, 120)
                    : undefined,
            label:
                typeof branch.label === 'string'
                    ? truncateString(branch.label, 200)
                    : undefined,
            status:
                typeof branch.status === 'string' ? branch.status : undefined,
            output:
                typeof branch.output === 'string'
                    ? truncateString(branch.output, minimal ? 300 : 600)
                    : undefined,
            error:
                typeof branch.error === 'string'
                    ? truncateString(branch.error, 500)
                    : undefined,
        };
    }
    return result;
}

function compactResumeState(
    value: unknown,
    minimal: boolean
): Record<string, unknown> | undefined {
    const resume = toRecord(value);
    if (!Object.keys(resume).length) return undefined;

    const compacted: Record<string, unknown> = {
        startNodeId:
            typeof resume.startNodeId === 'string'
                ? truncateString(resume.startNodeId, 120)
                : undefined,
        executionOrder: limitStringArray(resume.executionOrder, minimal ? 32 : 64),
        lastActiveNodeId:
            typeof resume.lastActiveNodeId === 'string' ||
            resume.lastActiveNodeId === null
                ? resume.lastActiveNodeId
                : undefined,
        resumeInput:
            typeof resume.resumeInput === 'string'
                ? truncateString(resume.resumeInput, minimal ? 1000 : 2000)
                : undefined,
    };

    const nodeOutputs = compactStringMap(
        resume.nodeOutputs,
        minimal ? 8 : 16,
        minimal ? 400 : 600
    );
    if (nodeOutputs) {
        compacted.nodeOutputs = nodeOutputs;
    }

    return compacted;
}

function compactResultSummary(value: unknown): Record<string, unknown> | undefined {
    const result = toRecord(value);
    if (!Object.keys(result).length) return undefined;
    return {
        success:
            typeof result.success === 'boolean' ? result.success : undefined,
        duration:
            typeof result.duration === 'number' ? result.duration : undefined,
        totalTokens:
            typeof result.totalTokens === 'number'
                ? result.totalTokens
                : undefined,
        error:
            typeof result.error === 'string'
                ? truncateString(result.error, 1000)
                : undefined,
        usage:
            result.usage && typeof result.usage === 'object'
                ? {
                      promptTokens:
                          typeof (result.usage as Record<string, unknown>)
                              .promptTokens === 'number'
                              ? (result.usage as Record<string, unknown>)
                                    .promptTokens
                              : undefined,
                      completionTokens:
                          typeof (result.usage as Record<string, unknown>)
                              .completionTokens === 'number'
                              ? (result.usage as Record<string, unknown>)
                                    .completionTokens
                              : undefined,
                      totalTokens:
                          typeof (result.usage as Record<string, unknown>)
                              .totalTokens === 'number'
                              ? (result.usage as Record<string, unknown>)
                                    .totalTokens
                              : undefined,
                  }
                : undefined,
    };
}

function compactStringMap(
    value: unknown,
    maxEntries: number,
    maxValueLength: number
): Record<string, string> | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const entries = Object.entries(value as Record<string, unknown>).slice(0, maxEntries);
    if (!entries.length) return undefined;
    const result: Record<string, string> = {};
    for (const [key, item] of entries) {
        if (typeof item !== 'string') continue;
        result[key] = truncateString(item, maxValueLength);
    }
    return Object.keys(result).length ? result : undefined;
}

function limitStringArray(value: unknown, maxEntries: number): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const result = value
        .filter((entry): entry is string => typeof entry === 'string')
        .slice(0, maxEntries);
    return result.length ? result : undefined;
}

function getPayloadSizeBytes(payload: Record<string, unknown>): number {
    try {
        const json = JSON.stringify(payload);
        if (typeof TextEncoder !== 'undefined') {
            return new TextEncoder().encode(json).length;
        }
        return json.length;
    } catch {
        return Number.MAX_SAFE_INTEGER;
    }
}

function truncateStringField(
    payload: Record<string, unknown>,
    key: string,
    maxLength: number
): void {
    const value = payload[key];
    if (typeof value === 'string') {
        payload[key] = truncateString(value, maxLength);
    }
}

function truncateString(value: string, maxLength: number): string {
    if (value.length <= maxLength) return value;
    if (maxLength <= SYNC_TRUNCATED_MARKER.length) {
        return value.slice(0, maxLength);
    }
    const head = value.slice(0, maxLength - SYNC_TRUNCATED_MARKER.length);
    return `${head}${SYNC_TRUNCATED_MARKER}`;
}

function toRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object') return {};
    return value as Record<string, unknown>;
}
