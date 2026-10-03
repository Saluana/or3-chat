/** Provider capacity is a fact; usage is an estimate and the user's maximum is optional. */
export interface ContextModelMetadata {
    context_length?: unknown;
    top_provider?: { context_length?: unknown; max_completion_tokens?: unknown } | null;
}
export interface ContextRouteLimits {
    /** Only limits verified for the selected route belong here; catalog defaults are not routing authority. */
    contextTokens?: number;
    inputTokens?: number;
    outputTokens?: number;
}
export interface ContextBudget {
    model_context_tokens: number;
    model_max_completion_tokens: number | null;
    user_max_context_tokens: number | null;
    effective_context_tokens: number;
    requested_completion_tokens: number | null;
    available_completion_tokens: number;
    source: 'openrouter-live' | 'openrouter-cache';
    limited_by: 'model' | 'user' | 'provider';
}
export interface ContextEstimate {
    input_tokens: number;
    basis: 'estimated' | 'measured-prefix';
    media_cost: 'none' | 'estimated' | 'unknown';
}
/** Captured once for a generation; never filled from an arbitrary fallback. */
export interface ContextRequestPolicy {
    model: ContextModelMetadata;
    userMaxContextTokens: number | null;
    requestedCompletionTokens?: number | null;
    source: ContextBudget['source'];
}
export type ContextAdmission =
    | { ok: true; budget: ContextBudget; estimate: ContextEstimate }
    | { ok: false; code: 'context_full' | 'invalid_output_limit' | 'invalid_context_limit'; budget: ContextBudget; estimate: ContextEstimate }
    | { ok: false; code: 'model_metadata_unavailable' };

function positiveInteger(value: unknown): number | null {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function admitChatContext(input: {
    model?: ContextModelMetadata | null;
    inputTokens: number;
    userMaxContextTokens?: number | null;
    requestedCompletionTokens?: number | null;
    routeLimits?: ContextRouteLimits;
    estimate?: ContextEstimate;
    source?: ContextBudget['source'];
}): ContextAdmission {
    const modelContext = positiveInteger(input.model?.context_length) ?? positiveInteger(input.model?.top_provider?.context_length);
    if (!modelContext) return { ok: false, code: 'model_metadata_unavailable' };
    const userMaximum = positiveInteger(input.userMaxContextTokens);
    const routeContext = positiveInteger(input.routeLimits?.contextTokens);
    const routeOutput = positiveInteger(input.routeLimits?.outputTokens);
    const catalogOutput = positiveInteger(input.model?.top_provider?.max_completion_tokens);
    // A verified selected route supersedes the default catalog provider configuration.
    const outputMaximum = routeOutput ?? catalogOutput;
    const effectiveContext = Math.min(modelContext, userMaximum ?? modelContext, routeContext ?? modelContext);
    const inputTokens = Number.isFinite(input.inputTokens) && input.inputTokens >= 0 ? Math.ceil(input.inputTokens) : Infinity;
    const remaining = Math.max(0, effectiveContext - inputTokens);
    const requested = input.requestedCompletionTokens ?? null;
    const estimate = input.estimate ?? { input_tokens: inputTokens, basis: 'estimated', media_cost: 'none' };
    const budget: ContextBudget = {
        model_context_tokens: modelContext, model_max_completion_tokens: outputMaximum,
        user_max_context_tokens: userMaximum, effective_context_tokens: effectiveContext,
        requested_completion_tokens: requested,
        available_completion_tokens: Math.min(remaining, outputMaximum ?? remaining),
        source: input.source ?? 'openrouter-cache',
        limited_by: userMaximum !== null && userMaximum === effectiveContext && userMaximum < modelContext ? 'user'
            : routeContext !== null && routeContext === effectiveContext && routeContext < modelContext ? 'provider' : 'model',
    };
    if (input.userMaxContextTokens !== null && input.userMaxContextTokens !== undefined && userMaximum === null) {
        return { ok: false, code: 'invalid_context_limit', budget, estimate };
    }
    if (requested !== null && (!positiveInteger(requested) || outputMaximum !== null && requested > outputMaximum)) {
        return { ok: false, code: 'invalid_output_limit', budget, estimate };
    }
    const inputMaximum = positiveInteger(input.routeLimits?.inputTokens);
    if (!Number.isFinite(inputTokens) || inputMaximum !== null && inputTokens > inputMaximum
        || remaining <= 0 || requested !== null && requested > remaining) {
        return { ok: false, code: 'context_full', budget, estimate };
    }
    return { ok: true, budget, estimate };
}

export interface CountableChatMessage {
    role: string;
    content?: string | Array<{ type: string; text?: string } | { type: string; [key: string]: unknown }> | null;
    name?: string;
    tool_call_id?: string;
    tool_calls?: unknown;
}

/** Count the final visible wire text/metadata once; media bytes are never treated as text tokens. */
export async function estimateChatRequest(input: {
    messages: readonly CountableChatMessage[];
    tools?: readonly unknown[];
    configuration?: Record<string, unknown>;
    countText: (text: string) => Promise<number>;
}): Promise<ContextEstimate> {
    let media: ContextEstimate['media_cost'] = 'none';
    let total = await input.countText('{"messages":[],"tools":[]}');
    for (const message of input.messages) {
        const content = message.content;
        const header = { role: message.role, name: message.name,
            tool_call_id: message.tool_call_id, tool_calls: message.tool_calls,
            content: Array.isArray(content) ? content.map((part) => ({ type: part.type })) : '' };
        total += await input.countText(JSON.stringify(header));
        if (typeof content === 'string') total += await input.countText(content);
        else if (Array.isArray(content)) {
            for (const part of content) {
                if (part.type === 'text' && typeof part.text === 'string') total += await input.countText(part.text);
                else media = 'unknown';
            }
        }
    }
    if (input.tools?.length) total += await input.countText(JSON.stringify(input.tools));
    if (input.configuration) total += await input.countText(JSON.stringify(input.configuration));
    return { input_tokens: total, basis: 'estimated', media_cost: media };
}

export class ChatContextAdmissionError extends Error {
    readonly code: Exclude<ContextAdmission, { ok: true }>['code'];
    constructor(readonly admission: Exclude<ContextAdmission, { ok: true }>) {
        super(admission.code === 'model_metadata_unavailable' ? 'Model capacity is unavailable. Refresh models or choose a model with known capacity.'
            : admission.code === 'invalid_output_limit' ? 'The requested reply allowance exceeds this model’s output limit or is invalid.'
            : admission.code === 'invalid_context_limit' ? 'Choose a positive maximum context value or use the model limit.'
            : 'Context full — compact, edit the request, or choose a larger supported model.');
        this.name = 'ChatContextAdmissionError'; this.code = admission.code;
    }
}

/** Internal OR3 transport envelope. Capacity facts never come from the caller. */
export interface ContextRequestEnvelope {
    version: 1;
    user_max_context_tokens: number | null;
    requested_completion_tokens: number | null;
}

export function captureContextEnvelope(policy: ContextRequestPolicy): ContextRequestEnvelope {
    return { version: 1, user_max_context_tokens: policy.userMaxContextTokens,
        requested_completion_tokens: policy.requestedCompletionTokens ?? null };
}

/** Keep provider/SSR classifications aligned with native request outcomes. */
export function contextAdmissionFailureReason(error: unknown): Exclude<ContextAdmission, { ok: true }>['code'] | undefined {
    const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
    switch (code) {
        case 'context_full': case 'ERR_CONTEXT_FULL': return 'context_full';
        case 'model_metadata_unavailable': case 'ERR_MODEL_METADATA_UNAVAILABLE': return 'model_metadata_unavailable';
        case 'invalid_context_limit': case 'ERR_CONTEXT_LIMIT_INVALID': return 'invalid_context_limit';
        case 'invalid_output_limit': case 'ERR_OUTPUT_LIMIT_INVALID': return 'invalid_output_limit';
        default: return undefined;
    }
}

/** Admit the complete provider payload using one policy captured for this generation. */
export async function admitProviderRequest<T extends {
    messages: readonly CountableChatMessage[];
    tools?: readonly unknown[];
    max_tokens?: number;
}>(body: T, policy: ContextRequestPolicy, countText: (text: string) => Promise<number>, signal?: AbortSignal): Promise<T> {
    for (;;) {
        const { messages, tools, ...configuration } = body;
        const estimate = await estimateChatRequest({ messages, tools, configuration, countText });
        if (signal?.aborted) throw new DOMException('Chat preparation canceled.', 'AbortError');
        if (body.max_tokens !== undefined && (!Number.isSafeInteger(body.max_tokens) || body.max_tokens <= 0)) {
            const invalid = admitChatContext({ ...policy, inputTokens: estimate.input_tokens, estimate,
                requestedCompletionTokens: body.max_tokens });
            if (!invalid.ok) throw new ChatContextAdmissionError(invalid);
        }
        const requested = policy.requestedCompletionTokens ?? undefined;
        const admission = admitChatContext({ ...policy, inputTokens: estimate.input_tokens, estimate,
            requestedCompletionTokens: requested });
        if (!admission.ok) throw new ChatContextAdmissionError(admission);
        const replyMaximum = requested ?? admission.budget.available_completion_tokens;
        if (body.max_tokens !== undefined && body.max_tokens <= replyMaximum) return body;
        body.max_tokens = replyMaximum;
    }
}
