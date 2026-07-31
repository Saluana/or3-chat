import type { ORStreamEvent } from '../openrouter/parseOpenRouterSSE';
import { MAX_STREAM_OUTPUT_BYTES, utf8Bytes } from './tool-limits';
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
    terminal: 'active' | 'complete' | 'aborted' | 'failed';
    error?: string;
};

export function createNormalizedStreamState(): NormalizedStreamState {
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

function addOutputBytes(state: NormalizedStreamState, value: string): number {
    const next = state.outputBytes + utf8Bytes(value);
    if (next > MAX_STREAM_OUTPUT_BYTES) {
        throw new Error('Chat output exceeded UTF-8 byte limit');
    }
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
    return {
        ...state,
        iterationToolCallIds: state.iterationToolCallIds.includes(call.id)
            ? state.iterationToolCallIds
            : [...state.iterationToolCallIds, call.id],
        tools: {
            ...state.tools,
            [call.id]: {
                id: call.id,
                name: call.function.name,
                arguments: call.function.arguments,
                status: 'pending',
            },
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
    return {
        ...state,
        tools: { ...state.tools, [callId]: { ...current, ...patch } },
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
