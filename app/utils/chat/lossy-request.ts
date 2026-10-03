import { trimOrMessagesByTokenBudget } from './messages';
import { countTokensApprox } from './tokens';
import { buildOpenRouterRequestBody, prepareOpenRouterRequest, type OpenRouterStreamParams } from './openrouterStream';
import { ChatContextAdmissionError } from '~~/shared/chat/context-budget';

export interface LossyRequestPreview {
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
    for (let position = 0; position < body.messages.length; position++) {
        const row = body.messages[position]!;
        if (row.role === 'system' || position >= latestUser) {
            groups.push({ positions: [position], protected: true });
        } else if (row.role === 'user' || !groups.length || groups.at(-1)!.protected) {
            groups.push({ positions: [position], protected: false });
        } else groups.at(-1)!.positions.push(position);
    }
    // Apply the existing complete-turn remover to group envelopes. Protected
    // groups include every system/summary and the entire latest user suffix.
    const envelopes = groups.map((group) => ({ role: group.protected ? 'system' : 'assistant',
        content: JSON.stringify(group.positions.map((position) => body.messages[position])) }));
    let retained = envelopes.slice(); let budget = (await Promise.all(envelopes.map((row) => countTokensApprox(row.content)))).reduce((a, b) => a + b, 0);
    for (;;) {
        if (params.signal?.aborted) throw new DOMException('Lossy inspection canceled.', 'AbortError');
        const selected = new Set(retained.flatMap((envelope) => groups[envelopes.indexOf(envelope)]!.positions));
        const messages = body.messages.filter((_row, position) => selected.has(position));
        try {
            await prepareOpenRouterRequest({ ...params, orMessages: messages });
            const omitted = body.messages.flatMap((row, position) => selected.has(position) ? [] : [{ position, role: row.role,
                excerpt: Array.from(typeof row.content === 'string' ? row.content : JSON.stringify(row.content) ?? '').slice(0, 200).join('') }]);
            if (!omitted.length) throw new Error('This request fits without omissions. Send the full request.');
            const [originalDigest, candidateDigest, protectedDigest] = await Promise.all([digest(body), digest(messages),
                digest(groups.filter((group) => group.protected).flatMap((group) => group.positions.map((position) => body.messages[position])))]);
            const preview = Object.freeze({ omitted_message_count: omitted.length,
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
