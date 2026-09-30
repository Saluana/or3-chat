import type { ORStreamEvent } from '../openrouter/parseOpenRouterSSE';
import {
    CANONICAL_MESSAGE_FIXED_BYTES,
    MAX_STREAM_OUTPUT_BYTES,
    OutputLimitExceededError,
    utf8Bytes,
} from './tool-limits';
import { ToolIterationLimitError } from './stream-errors';

export type NormalizedToolState = {
    id: string;
    name: string;
    arguments: string;
    status: 'pending' | 'loading' | 'complete' | 'error' | 'skipped';
    result?: string;
    error?: string;
};

export type NormalizedStreamState = {
    iteration: number;
    cumulativeText: string;
    iterationText: string;
    reasoningText: string;
    chunks: number;
    outputBytes: number;
    images: string[];
    iterationToolCallIds: string[];
    tools: Record<string, NormalizedToolState>;
    /**
     * Canonical message byte budget. When set, output is rejected before it
     * would produce a message that cannot be committed to sync history.
     */
    outputLimitBytes?: number;
    /** Accepted serialized-byte estimate for tool arguments/results/errors. */
    toolBytes: number;
    /** Per-tool accepted byte estimate, for incremental accounting. */
    toolBytesById: Record<string, number>;
    terminal: 'active' | 'complete' | 'aborted' | 'failed';
    error?: string;
};

export function createNormalizedStreamState(options?: {
    outputLimitBytes?: number;
}): NormalizedStreamState {
    return {
        iteration: 0,
        cumulativeText: '',
        iterationText: '',
        reasoningText: '',
        chunks: 0,
        outputBytes: 0,
        images: [],
        iterationToolCallIds: [],
        tools: {},
        outputLimitBytes: options?.outputLimitBytes,
        toolBytes: 0,
        toolBytesById: {},
        terminal: 'active',
    };
}

export function beginNormalizedIteration(
    state: NormalizedStreamState
): NormalizedStreamState {
    return {
        ...state,
        iteration: state.iteration + 1,
        iterationText: '',
        iterationToolCallIds: [],
        terminal: 'active',
        error: undefined,
    };
}

function assertCanonicalBudget(
    state: NormalizedStreamState,
    nextOutputBytes: number,
    nextToolBytes: number
): void {
    const limit = state.outputLimitBytes;
    if (limit === undefined) return;
    // `content` is serialized both top-level and inside `data`; reasoning once.
    const projected =
        nextOutputBytes * 2 + nextToolBytes + CANONICAL_MESSAGE_FIXED_BYTES;
    if (projected > limit) {
        throw new OutputLimitExceededError(limit, projected);
    }
}

function toolEntryBytes(tool: NormalizedToolState): number {
    // Canonical history serializes both the tool state and its transcript.
    // Measuring JSON also accounts for quotes/control-character escaping.
    return utf8Bytes(JSON.stringify({
        id: tool.id,
        name: tool.name,
        args: tool.arguments,
        result: tool.result,
        error: tool.error,
        transcript: {
            result: tool.result,
            error: tool.error,
        },
    })) + 256;
}

function applyToolBytes(
    state: NormalizedStreamState,
    toolId: string,
    nextEntryBytes: number
): Pick<NormalizedStreamState, 'toolBytes' | 'toolBytesById'> {
    const previous = state.toolBytesById[toolId] ?? 0;
    const nextToolBytes = Math.max(
        0,
        state.toolBytes - previous + nextEntryBytes
    );
    assertCanonicalBudget(state, state.outputBytes, nextToolBytes);
    return {
        toolBytes: nextToolBytes,
        toolBytesById: { ...state.toolBytesById, [toolId]: nextEntryBytes },
    };
}

function addOutputBytes(state: NormalizedStreamState, value: string): number {
    const next = state.outputBytes + utf8Bytes(value);
    if (next > MAX_STREAM_OUTPUT_BYTES) {
        throw new Error('Chat output exceeded UTF-8 byte limit');
    }
    assertCanonicalBudget(state, next, state.toolBytes);
    return next;
}

export function reduceNormalizedStreamEvent(
    state: NormalizedStreamState,
    event: ORStreamEvent
): NormalizedStreamState {
    if (state.terminal !== 'active' || event.type === 'done') return state;
    if (event.type === 'text') {
        return {
            ...state,
            cumulativeText: state.cumulativeText + event.text,
            iterationText: state.iterationText + event.text,
            chunks: state.chunks + 1,
            outputBytes: addOutputBytes(state, event.text),
        };
    }
    if (event.type === 'reasoning') {
        return {
            ...state,
            reasoningText: state.reasoningText + event.text,
            outputBytes: addOutputBytes(state, event.text),
        };
    }
    if (event.type === 'image') {
        if (state.images.includes(event.url)) return state;
        return { ...state, images: [...state.images, event.url] };
    }
    const call = event.tool_call;
    const nextTool: NormalizedToolState = {
        id: call.id,
        name: call.function.name,
        arguments: call.function.arguments,
        status: 'pending',
    };
    const toolBytePatch = applyToolBytes(
        state,
        call.id,
        toolEntryBytes(nextTool)
    );
    return {
        ...state,
        ...toolBytePatch,
        iterationToolCallIds: state.iterationToolCallIds.includes(call.id)
            ? state.iterationToolCallIds
            : [...state.iterationToolCallIds, call.id],
        tools: {
            ...state.tools,
            [call.id]: nextTool,
        },
    };
}

export function appendNormalizedAssistantText(
    state: NormalizedStreamState,
    text: string,
    options?: { iterationText?: string }
): NormalizedStreamState {
    const iterationText = options?.iterationText ?? text;
    return {
        ...state,
        cumulativeText: state.cumulativeText + text,
        iterationText: state.iterationText + iterationText,
        outputBytes: addOutputBytes(state, text),
    };
}

export function settleNormalizedTool(
    state: NormalizedStreamState,
    callId: string,
    patch: Pick<NormalizedToolState, 'status'> &
        Partial<Pick<NormalizedToolState, 'result' | 'error'>>
): NormalizedStreamState {
    const current = state.tools[callId];
    if (!current) return state;
    const nextTool: NormalizedToolState = { ...current, ...patch };
    const toolBytePatch = applyToolBytes(
        state,
        callId,
        toolEntryBytes(nextTool)
    );
    return {
        ...state,
        ...toolBytePatch,
        tools: { ...state.tools, [callId]: nextTool },
    };
}

export function finishNormalizedIteration(
    state: NormalizedStreamState,
    maxIterations: number
): { state: NormalizedStreamState; requiresFollowup: boolean } {
    const requiresFollowup = state.iterationToolCallIds.length > 0;
    if (requiresFollowup && state.iteration >= maxIterations) {
        throw new ToolIterationLimitError(maxIterations);
    }
    return {
        requiresFollowup,
        state: requiresFollowup ? state : { ...state, terminal: 'complete' },
    };
}

export function failNormalizedStream(
    state: NormalizedStreamState,
    error: unknown
): NormalizedStreamState {
    const aborted = error instanceof Error && error.name === 'AbortError';
    return {
        ...state,
        terminal: aborted ? 'aborted' : 'failed',
        error: error instanceof Error ? error.message : String(error),
    };
}
