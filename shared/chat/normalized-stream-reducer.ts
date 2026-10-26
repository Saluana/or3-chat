import { addUsageTotals, readMeasuredRequestUsage } from './request-usage';
import type { RequestUsage, UsageTotals } from './compaction';
import { normalizeProviderRequestUsage, type ORStreamEvent, type ProviderRequestUsage } from '../openrouter/parseOpenRouterSSE';
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
    /** Last measured provider request, never a sum of tool-loop prompt occupancy. */
    usage?: ProviderRequestUsage & { iteration: number };
    requestUsage?: RequestUsage;
    /** Sum of the measured requests of completed iterations; the current one is added when it reports. */
    usageTotals?: UsageTotals;
    cumulativeText: string;
    iterationText: string;
    reasoningText: string;
    chunks: number;
    outputBytes: number;
    /** Escaped JSON string bytes, conservatively counting split surrogates. */
    outputJsonBytes?: number;
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
        outputJsonBytes: 0,
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
    const finished = state.usage?.iteration === state.iteration ? state.usage : undefined;
    return {
        ...state,
        usageTotals: finished ? addUsageTotals(state.usageTotals, finished) : state.usageTotals,
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
    // Count JSON escaping as well as UTF-8. Two copies conservatively cover
    // content/data representations; reasoning may only need one.
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
    assertCanonicalBudget(state, outputJsonBytes(state), nextToolBytes);
    return {
        toolBytes: nextToolBytes,
        toolBytesById: { ...state.toolBytesById, [toolId]: nextEntryBytes },
    };
}

function outputJsonBytes(state: NormalizedStreamState): number {
    // Persisted reducer snapshots from earlier versions have no counter.
    return state.outputJsonBytes ?? utf8Bytes(JSON.stringify(state.cumulativeText)) - 2
        + utf8Bytes(JSON.stringify(state.reasoningText)) - 2;
}

function addOutputBytes(state: NormalizedStreamState, value: string): Pick<NormalizedStreamState, 'outputBytes' | 'outputJsonBytes'> {
    const next = state.outputBytes + utf8Bytes(value);
    if (next > MAX_STREAM_OUTPUT_BYTES) {
        throw new Error('Chat output exceeded UTF-8 byte limit');
    }
    const nextJsonBytes = outputJsonBytes(state) + utf8Bytes(JSON.stringify(value)) - 2;
    assertCanonicalBudget(state, nextJsonBytes, state.toolBytes);
    return { outputBytes: next, outputJsonBytes: nextJsonBytes };
}

export function reduceNormalizedStreamEvent(
    state: NormalizedStreamState,
    event: ORStreamEvent
): NormalizedStreamState {
    if (state.terminal !== 'active' || event.type === 'done') return state;
    if (event.type === 'usage') {
        const measurement = normalizeProviderRequestUsage(event.usage);
        if (!measurement) return state;
        const usage = { ...measurement, iteration: state.iteration };
        const record = readMeasuredRequestUsage(measurement, event.requestUsage);
        const requestUsage = record ? { ...record, iteration: state.iteration, totals: addUsageTotals(state.usageTotals, measurement) } : undefined;
        return JSON.stringify(state.usage) === JSON.stringify(usage) && JSON.stringify(state.requestUsage) === JSON.stringify(requestUsage)
            ? state : { ...state, usage, requestUsage };
    }
    if (event.type === 'text') {
        return {
            ...state,
            cumulativeText: state.cumulativeText + event.text,
            iterationText: state.iterationText + event.text,
            chunks: state.chunks + 1,
            ...addOutputBytes(state, event.text),
        };
    }
    if (event.type === 'reasoning') {
        return {
            ...state,
            reasoningText: state.reasoningText + event.text,
            ...addOutputBytes(state, event.text),
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
        ...addOutputBytes(state, text),
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
