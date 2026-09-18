/**
 * Model Compare: pure comparison logic.
 *
 * One prompt goes to every selected model; each answer is rendered with its own
 * attributed provider spend, and the chosen answer can continue in normal chat.
 * Nothing here holds a credential or a provider endpoint: a host-mediated
 * completion is the only way a model is called.
 */

/** Recorded limits; the host enforces its own budgets on top of these. */
export const COMPARE_LIMITS = Object.freeze({
    maxModels: 4,
    minModels: 2,
    maxPromptChars: 8000,
    maxSystemPromptChars: 2000,
    maxOutputTokens: 1024,
    defaultOutputTokens: 512,
});

export const COMPARE_FAILURE_COPY = Object.freeze({
    'permission-denied': 'This host has not approved the model provider for plugins.',
    'quota-exceeded': 'This plugin’s AI budget for the session is spent. Start a new session or raise the limit.',
    'budget-exceeded': 'This plugin’s AI budget for the session is spent. Start a new session or raise the limit.',
    timeout: 'The model did not answer in time. Try again or lower the output length.',
    aborted: 'The comparison was cancelled.',
    'network-error': 'The model provider could not be reached. Try again shortly.',
    'host-unavailable': 'The host model provider is unavailable right now.',
    'invalid-input': 'The host refused the request as invalid. Check the selected model.',
    internal: 'The model call failed unexpectedly.',
});

export function classifyFailure(error) {
    const raw = error && typeof error === 'object' && typeof error.code === 'string' ? error.code : 'internal';
    const code = Object.hasOwn(COMPARE_FAILURE_COPY, raw) ? raw : 'internal';
    return {
        code,
        message: COMPARE_FAILURE_COPY[code],
        retryable: error && typeof error === 'object' && error.retryable === true,
    };
}

function readString(value, max, { required = false, fallback = '' } = {}) {
    if (typeof value !== 'string') return required ? null : fallback;
    const trimmed = value.trim();
    if (required && trimmed.length === 0) return null;
    if (trimmed.length > max) return null;
    return trimmed;
}

/**
 * Validate the comparison request. Models are bounded, de-duplicated and kept in
 * the caller's order; the prompt is required and length-bounded.
 */
export function normalizeCompareOptions(input = {}) {
    const prompt = readString(input.prompt, COMPARE_LIMITS.maxPromptChars, { required: true });
    if (prompt === null) {
        return {
            ok: false,
            code: 'prompt-required',
            message: `A prompt of 1–${COMPARE_LIMITS.maxPromptChars} characters is required.`,
        };
    }
    const rawModels = Array.isArray(input.models) ? input.models : [];
    const models = [];
    for (const entry of rawModels) {
        const model = readString(entry, 192);
        if (!model || models.includes(model)) continue;
        models.push(model);
        if (models.length >= COMPARE_LIMITS.maxModels) break;
    }
    if (models.length < COMPARE_LIMITS.minModels) {
        return {
            ok: false,
            code: 'models-required',
            message: `Choose at least ${COMPARE_LIMITS.minModels} models to compare.`,
        };
    }
    const systemPrompt = readString(input.systemPrompt, COMPARE_LIMITS.maxSystemPromptChars) ?? '';
    let maxOutputTokens = COMPARE_LIMITS.defaultOutputTokens;
    if (typeof input.maxOutputTokens === 'number' && Number.isFinite(input.maxOutputTokens)) {
        maxOutputTokens = Math.min(
            COMPARE_LIMITS.maxOutputTokens,
            Math.max(64, Math.trunc(input.maxOutputTokens)),
        );
    }
    return { ok: true, value: { prompt, models, systemPrompt, maxOutputTokens } };
}

/**
 * Default models from the setup text field. The host stores a `text` field as a
 * string, so a comma-separated list is the contract; an array is accepted for
 * programmatic callers and tests.
 */
export function parseDefaultModels(input) {
    const entries = Array.isArray(input)
        ? input
        : typeof input === 'string'
          ? input.split(',')
          : [];
    const models = [];
    for (const entry of entries) {
        const id = typeof entry === 'string' ? entry.trim() : '';
        if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,191}$/.test(id)) continue;
        if (models.includes(id)) continue;
        models.push(id);
        if (models.length >= COMPARE_LIMITS.maxModels) break;
    }
    return models;
}

/** One identical prompt for every model, so the comparison is fair. */
export function buildComparisonPrompt({ prompt, systemPrompt = '' }) {
    const system = systemPrompt.trim();
    return system.length > 0 ? `${system}\n\n${prompt.trim()}` : prompt.trim();
}

/** Markdown for the chosen answer, used by chat continuation and document writes. */
export function formatAnswerMarkdown({ prompt, model, text }) {
    const question = prompt.trim().split(/\r?\n/).filter((line) => line.trim().length > 0)[0] ?? 'Prompt';
    const trimmedQuestion = question.length > 120 ? `${question.slice(0, 117)}…` : question;
    return `## ${trimmedQuestion}\n\n_Model: ${model}_\n\n${text.trim()}`;
}

export function summarizeSpendUsd(results) {
    return results.reduce((total, result) => total + (Number.isFinite(result?.spendUsd) ? result.spendUsd : 0), 0);
}

/** Table rows for a completed comparison: model, tokens, attributed spend. */
export function comparisonTableRows(results) {
    return results.map((result) => ({
        model: result.label ?? result.model,
        status: result.status === 'ok' ? 'Answered' : 'Failed',
        completionTokens: String(result.completionTokens ?? 0),
        spend: `$${(Number.isFinite(result.spendUsd) ? result.spendUsd : 0).toFixed(4)}`,
    }));
}
