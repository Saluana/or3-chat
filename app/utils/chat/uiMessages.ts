// Canonical UI message utilities (content part type no longer needed directly)
import { parseHashes } from '~/utils/files/attachments';
import {
    isWorkflowMessageData,
    type UiWorkflowState,
} from '~/utils/chat/workflow-types';
import { TRANSPARENT_PIXEL_GIF_DATA_URI } from '~/utils/chat/imagePlaceholders';

interface ContentPartLike {
    type?: string;
    text?: string;
    image?: string | Uint8Array | Buffer;
    image_url?: { url?: string };
}

interface RawMessageLike {
    id?: string;
    stream_id?: string;
    role?: 'user' | 'assistant' | 'system' | 'tool';
    text?: string;
    content?: string | ContentPartLike[];
    file_hashes?: string[] | string | null;
    reasoning_text?: string | null;
    error?: string | null;
    pending?: boolean;
    data?: {
        reasoning_text?: string | null;
        tool_calls?: ToolCallInfo[];
        [key: string]: unknown;
    } | null;
    index?: number | string | null;
    created_at?: number | null;
}

export interface ToolCallInfo {
    id?: string;
    name: string;
    label?: string;
    status: 'loading' | 'complete' | 'error' | 'pending';
    args?: string;
    result?: string;
    error?: string;
}

export interface UiChatMessage {
    id: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    text: string; // flattened text + markdown image placeholders
    file_hashes?: string[];
    reasoning_text?: string | null;
    stream_id?: string;
    pending?: boolean;
    toolCalls?: ToolCallInfo[];
    error?: string | null;

    // Workflow-specific fields (optional - no breaking changes)
    /** True if this message represents a workflow execution */
    isWorkflow?: boolean;
    /** Workflow execution state for UI rendering */
    workflowState?: UiWorkflowState;
}

export function partsToText(
    parts: string | ContentPartLike[] | null | undefined,
    role?: string
): string {
    if (!parts) return '';
    if (typeof parts === 'string') return parts;
    if (!Array.isArray(parts)) return '';
    let out = '';
    for (const p of parts) {
        if (typeof p === 'object') {
            if (p.type === 'text' && typeof p.text === 'string') out += p.text;
            else if (p.type === 'image') {
                // Skip embedding images for user messages (they're shown via attachments gallery)
                // Only convert assistant-generated images to markdown
                if (role === 'assistant') {
                    const src = p.image || p.image_url?.url;
                    if (typeof src === 'string') {
                        out +=
                            (out ? '\n\n' : '') + `![generated image](${src})`;
                    }
                }
            }
        }
    }
    return out;
}

export function ensureUiMessage(raw: RawMessageLike): UiChatMessage {
    const id = raw.id || raw.stream_id || crypto.randomUUID();
    const role = raw.role || 'user';
    let file_hashes: string[] | undefined;
    if (Array.isArray(raw.file_hashes)) file_hashes = raw.file_hashes.slice();
    else if (typeof raw.file_hashes === 'string') {
        try {
            file_hashes = parseHashes(raw.file_hashes);
        } catch {
            // ignore
        }
    }
    // Extract reasoning_text from data field (if present) or top level
    const reasoning_text =
        raw.data && typeof raw.data.reasoning_text === 'string'
            ? raw.data.reasoning_text
            : typeof raw.reasoning_text === 'string'
            ? raw.reasoning_text
            : null;

    // Extract tool calls from data field
    let toolCalls: ToolCallInfo[] | undefined;
    if (raw.data && Array.isArray(raw.data.tool_calls)) {
        toolCalls = raw.data.tool_calls;
    }

    // ─────────────────────────────────────────────────────────────────────
    // Handle workflow messages (check discriminator in data field)
    // ─────────────────────────────────────────────────────────────────────
    let isWorkflow = false;
    let workflowState: UiChatMessage['workflowState'] = undefined;

    if (isWorkflowMessageData(raw.data)) {
        isWorkflow = true;
        workflowState = {
            workflowId: raw.data.workflowId,
            workflowName: raw.data.workflowName,
            prompt: raw.data.prompt,
            attachments: raw.data.attachments,
            imageCaption: raw.data.imageCaption,
            executionState: raw.data.executionState,
            nodeStates: raw.data.nodeStates,
            executionOrder: raw.data.executionOrder,
            currentNodeId: raw.data.currentNodeId,
            branches: raw.data.branches,
            hitlRequests: raw.data.hitlRequests,
            finalOutput: raw.data.finalOutput,
            failedNodeId:
                raw.data.failedNodeId ?? raw.data.resumeState?.startNodeId,
            nodeOutputs: raw.data.nodeOutputs,
            sessionMessages: raw.data.sessionMessages,
            resumeState: raw.data.resumeState,
            version: raw.data.version ?? 0,
        };
    }

    let text: string;
    // For workflow messages, use finalOutput as the primary text
    if (isWorkflow && isWorkflowMessageData(raw.data)) {
        text = raw.data.finalOutput || '';
    } else if (typeof raw.text === 'string' && !Array.isArray(raw.text)) {
        text = raw.text;
    } else if (typeof raw.content === 'string') {
        text = raw.content;
    } else {
        text = partsToText(raw.content, role);
    }
    // Inject markdown placeholders for assistant file_hashes with de-duplication logic.
    // Goal: avoid showing the same logical image twice when the model already emitted
    // a markdown image (e.g. data: URL) for a hash we also have stored.
    if (role === 'assistant' && file_hashes && file_hashes.length) {
        const IMG_RE = /!\[[^\]]*]\(([^)]+)\)/g; // basic markdown image matcher
        const existingImages = [...text.matchAll(IMG_RE)];
        const existingCount = existingImages.length;
        if (existingCount < file_hashes.length) {
            // Determine how many placeholders we still need to represent each hash once.
            const needed = file_hashes.length - existingCount;
            // Candidate hashes: those not already present via a file-hash placeholder.
            const candidate = file_hashes.filter(
                (h) => h && !text.includes(`file-hash:${h}`)
            );
            // Only take up to the number we still need to avoid duplication.
            const missing = candidate.slice(0, needed);
            if (missing.length) {
                // Use transparent placeholder image with hash in alt to avoid browser errors
                const placeholders = missing.map(
                    (h) =>
                        `![file-hash:${h}](${TRANSPARENT_PIXEL_GIF_DATA_URI})`
                );
                text += (text ? '\n\n' : '') + placeholders.join('\n\n');
                if (import.meta.dev) {
                    console.debug(
                        '[uiMessages.ensureUiMessage] appended placeholders',
                        {
                            id,
                            added: missing.length,
                            totalHashes: file_hashes.length,
                            existingCount,
                        }
                    );
                }
            } else if (import.meta.dev) {
                console.debug(
                    '[uiMessages.ensureUiMessage] no additional placeholders needed',
                    { id, totalHashes: file_hashes.length, existingCount }
                );
            }
        } else if (import.meta.dev) {
            console.debug(
                '[uiMessages.ensureUiMessage] existing images >= hashes; skipping placeholder injection',
                { id, totalHashes: file_hashes.length, existingCount }
            );
        }
    }
    const pending = workflowState
        ? workflowState.executionState === 'running'
        : Boolean(raw.pending);

    return {
        id,
        role,
        text,
        file_hashes,
        reasoning_text,
        stream_id: raw.stream_id,
        pending,
        toolCalls,
        error:
            raw.error ??
            (raw.data && typeof raw.data === 'object'
                ? (raw.data as { error?: string | null }).error ?? null
                : null),
        isWorkflow,
        workflowState,
    };
}

// Legacy raw storage (non reactive). We expose accessor for plugins.
const _rawMessages: RawMessageLike[] = [];
export function recordRawMessage(m: RawMessageLike): void {
    _rawMessages.push(m);
}
export function getRawMessages(): readonly RawMessageLike[] {
    return _rawMessages.slice();
}
