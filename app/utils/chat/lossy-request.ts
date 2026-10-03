import { trimOrMessagesByTokenBudget } from './messages';
import { countTokensApprox } from './tokens';
import { buildOpenRouterRequestBody, prepareOpenRouterRequest, type OpenRouterStreamParams } from './openrouterStream';
import { estimateMeasuredChatRequest } from '~~/shared/chat/request-usage';
import { admitChatContext, ChatContextAdmissionError } from '~~/shared/chat/context-budget';

export interface LossyRequestPreview {
    readonly input_tokens: number;
    readonly effective_context_tokens: number;
    readonly reply_tokens: number;
    readonly omitted_message_count: number;
    readonly omitted_turn_count: number;
    readonly omitted_messages: readonly { position: number; role: string; excerpt: string }[];
    readonly original_digest: string;
    readonly candidate_digest: string;
    readonly protected_digest: string;
}
interface Scope { db: object; generation: number; threadId?: string; sourceFingerprint?: string }
type Body = ReturnType<typeof buildOpenRouterRequestBody>;
const previews = new WeakMap<LossyRequestPreview, { scope: Scope; original: string; policy: string;
    messages: Body['messages']; omission: { version: 1; omitted_positions: number[]; original_digest: string; candidate_digest: string; protected_digest: string } }>();
async function digest(value: unknown) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
    return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
function policyKey(params: OpenRouterStreamParams) {
    const { measuredUsage: _usage, ...policy } = params.contextPolicy ?? {};
    return JSON.stringify(policy);
}

/** Explicit inspection only. Normal sends never enter this omission path. */
export async function prepareLossyRequest(params: OpenRouterStreamParams, scope: Scope): Promise<LossyRequestPreview> {
    const body = buildOpenRouterRequestBody(params); const latestUser = body.messages.findLastIndex((row) => row.role === 'user');
    if (latestUser < 0) throw new Error('An explicit lossy request must contain its latest user message.');
    const groups: { positions: number[]; protected: boolean }[] = [];
    let turn: { positions: number[]; protected: boolean } | undefined;
    for (let position = 0; position < body.messages.length; position++) {
        const row = body.messages[position]!;
        if (row.role === 'system' || position >= latestUser) {
            groups.push({ positions: [position], protected: true });
        } else if (row.role === 'user') {
            turn = { positions: [position], protected: false }; groups.push(turn);
        } else if (turn) turn.positions.push(position);
        else groups.push({ positions: [position], protected: true });
    }
    // A system row between a call and result is protected independently; it
    // must not split their containing user turn into separate omissions.
    const owners = new Map(groups.flatMap((group) => group.positions.map((position) => [position, group] as const)));
    const calls = new Map<string, number[]>(); const results = new Map<string, number[]>();
    for (let position = 0; position < body.messages.length; position++) {
        const row = body.messages[position]!;
        for (const call of Array.isArray(row.tool_calls) ? row.tool_calls : []) if (typeof call.id === 'string') calls.set(call.id, [...calls.get(call.id) ?? [], position]);
        if (row.role === 'tool' && typeof row.tool_call_id === 'string') results.set(row.tool_call_id, [...results.get(row.tool_call_id) ?? [], position]);
    }
    for (const id of new Set([...calls.keys(), ...results.keys()])) {
        const positions = [...calls.get(id) ?? [], ...results.get(id) ?? []];
        const associated = [...new Set(positions.map((position) => owners.get(position)!))];
        // Unmatched or cross-turn evidence remains protected. This never
        // creates an orphan call/result merely to make a candidate fit.
        if (calls.get(id)?.length !== 1 || results.get(id)?.length !== 1 || associated.length !== 1) associated.forEach((group) => { group.protected = true; });
    }
    for (const group of groups) if (!group.protected && !group.positions.some((position) => body.messages[position]?.role === 'assistant')) group.protected = true;
    // Apply the existing complete-turn remover to group envelopes. Protected
    // groups include every system/summary and the entire latest user suffix.
    const envelopes = groups.map((group) => ({ role: group.positions.includes(latestUser) || !group.protected ? 'user' : 'system',
        content: JSON.stringify(group.positions.map((position) => body.messages[position])) }));
    let retained = envelopes.slice(); let budget = (await Promise.all(envelopes.map((row) => countTokensApprox(row.content)))).reduce((a, b) => a + b, 0);
    for (;;) {
        if (params.signal?.aborted) throw new DOMException('Lossy inspection canceled.', 'AbortError');
        const selected = new Set(retained.flatMap((envelope) => groups[envelopes.indexOf(envelope)]!.positions));
        const messages = body.messages.filter((_row, position) => selected.has(position));
        try {
            const admitted = await prepareOpenRouterRequest({ ...params, orMessages: messages });
            if (!params.contextPolicy) throw new Error('Lossy inspection requires a captured context policy.');
            const { messages: admittedMessages, ...configuration } = admitted;
            const estimate = await estimateMeasuredChatRequest({ model: params.model, messages: admittedMessages,
                tools: admitted.tools, modalities: admitted.modalities, configuration,
                usage: params.contextPolicy.measuredUsage, countText: countTokensApprox });
            const admission = admitChatContext({ ...params.contextPolicy, inputTokens: estimate.input_tokens, estimate,
                requestedCompletionTokens: params.contextPolicy.requestedCompletionTokens ?? params.maxCompletionTokens });
            if (!admission.ok) throw new ChatContextAdmissionError(admission);
            const omitted = body.messages.flatMap((row, position) => selected.has(position) ? [] : [{ position, role: row.role,
                excerpt: Array.from(typeof row.content === 'string' ? row.content : JSON.stringify(row.content)).slice(0, 200).join('') }]);
            if (!omitted.length) throw new Error('This request fits without omissions. Send the full request.');
            const [originalDigest, candidateDigest, protectedDigest] = await Promise.all([digest(body), digest(messages),
                digest(groups.filter((group) => group.protected).flatMap((group) => group.positions.map((position) => body.messages[position])))]);
            const preview = Object.freeze({ input_tokens: estimate.input_tokens,
                effective_context_tokens: admission.budget.effective_context_tokens,
                reply_tokens: admission.budget.available_completion_tokens, omitted_message_count: omitted.length,
                omitted_turn_count: groups.filter((group) => !group.protected && !selected.has(group.positions[0]!)).length,
                omitted_messages: Object.freeze(omitted.map((row) => Object.freeze(row))), original_digest: originalDigest,
                candidate_digest: candidateDigest, protected_digest: protectedDigest });
            previews.set(preview, { scope: { ...scope }, original: originalDigest, policy: policyKey(params),
                messages: structuredClone(messages), omission: { version: 1, omitted_positions: omitted.map((row) => row.position),
                    original_digest: originalDigest, candidate_digest: candidateDigest, protected_digest: protectedDigest } });
            return preview;
        } catch (error) {
            if (!(error instanceof ChatContextAdmissionError) || error.code !== 'context_full') throw error;
            const next = groups.find((group, index) => !group.protected && retained.includes(envelopes[index]!));
            if (!next) throw new Error('The protected prompt, summary and latest user message do not fit. Edit the request or choose a larger model.');
            const nextEnvelope = envelopes[groups.indexOf(next)]!;
            budget -= await countTokensApprox(nextEnvelope.content);
            retained = await trimOrMessagesByTokenBudget(envelopes, Math.max(0, budget), countTokensApprox);
        }
    }
}

/** Consume the exact reviewed candidate once. A changed source/configuration requires a new inspection. */
export async function confirmLossyRequest(preview: LossyRequestPreview, params: OpenRouterStreamParams, scope: Scope) {
    const record = previews.get(preview); previews.delete(preview);
    if (!record || record.scope.db !== scope.db || record.scope.generation !== scope.generation
        || record.scope.threadId !== scope.threadId || record.scope.sourceFingerprint !== scope.sourceFingerprint
        || record.policy !== policyKey(params) || record.original !== await digest(buildOpenRouterRequestBody(params))) {
        throw new Error('The request changed after inspection. Inspect its omissions again before sending.');
    }
    await prepareOpenRouterRequest({ ...params, orMessages: record.messages });
    return { messages: structuredClone(record.messages), omission: structuredClone(record.omission) };
}
