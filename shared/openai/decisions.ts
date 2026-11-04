import { parseRetryAfter } from '../errors';
import { openAiApiUrl } from './models';

/** OpenAI's Decisions model; the API serves no other. */
export const OPENAI_DECISIONS_MODEL = 'gpt-6-luna';

type ChoiceQuestion = { type: 'choice'; instructions: string; criteria: Record<string, string> };
export type OpenAiDecisionsResult = {
    model: string;
    answers: Record<string, { type: string; choice?: unknown; probabilities?: Record<string, number> } | undefined>;
    usage: { cost: null };
};

/**
 * OpenAI's Decisions API, answered in the OpenRouter Decisions shape OR3's memory code reads:
 * the state is sent as JSON text and each named choice question becomes an entry with choices.
 */
export function createOpenAiDecisions(options: {
    apiKey: string;
    baseUrl: unknown;
    signal: AbortSignal;
    beforeDispatch?: () => Promise<void>;
}) {
    return async (request: { model: string; state: unknown; questions: Record<string, ChoiceQuestion> }, timeoutMs: number): Promise<OpenAiDecisionsResult> => {
        await options.beforeDispatch?.();
        options.signal.throwIfAborted();
        const response = await fetch(openAiApiUrl(options.baseUrl, 'decisions'), {
            method: 'POST',
            redirect: 'error',
            headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: request.model,
                input: JSON.stringify(request.state),
                questions: Object.entries(request.questions).map(([name, question]) => ({
                    type: question.type, name, instructions: question.instructions,
                    choices: Object.entries(question.criteria).map(([value, description]) => ({ value, description })),
                })),
            }),
            signal: AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)]),
        });
        if (!response.ok) throw Object.assign(new Error('OpenAI Decisions unavailable.'), {
            status: response.status, retryAfterMs: parseRetryAfter(response.headers.get('retry-after')) });
        const body = await response.json() as {
            model?: unknown;
            answers?: Array<{ name?: unknown; type?: unknown; choice?: unknown; probabilities?: Array<{ value?: unknown; probability?: unknown }> }>;
        };
        const answers: OpenAiDecisionsResult['answers'] = {};
        for (const answer of Array.isArray(body.answers) ? body.answers : []) {
            if (typeof answer?.name !== 'string' || typeof answer.type !== 'string') continue;
            const entries = Array.isArray(answer.probabilities) ? answer.probabilities
                .filter(entry => typeof entry?.value === 'string' && typeof entry.probability === 'number')
                .map(entry => [entry.value as string, entry.probability as number] as const) : [];
            // Probabilities arrive rounded to two places; restore a unit total so the callers' checks stay strict.
            const total = entries.reduce((sum, [, probability]) => sum + probability, 0);
            answers[answer.name] = { type: answer.type, choice: answer.choice,
                ...(entries.length && Math.abs(total - 1) <= 0.03
                    ? { probabilities: Object.fromEntries(entries.map(([value, probability]) => [value, probability / total])) } : {}) };
        }
        return { model: typeof body.model === 'string' ? body.model : '', answers, usage: { cost: null } };
    };
}
