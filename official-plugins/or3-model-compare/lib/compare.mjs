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
    /**
     * The prompt is rendered in one textarea and sent to every model. It is
     * bounded in UTF-8 bytes, the unit the host renderer and RPC budgets count.
     */
    maxPromptBytes: 4000,
    maxSystemPromptBytes: 2000,
    /**
     * Each answer is rendered as its own markdown node. Display is abbreviated
     * past this bound (the full answer is what a write/continuation keeps), so
     * prompt plus four answers stay inside the host's 16 KiB tree budget.
     */
    maxDisplayAnswerBytes: 2500,
    maxOutputTokens: 1024,
    defaultOutputTokens: 512,
});

const encoder = new TextEncoder();

/** UTF-8 byte length, the unit the host renderer and RPC budgets count. */
export function utf8Bytes(value) {
    return encoder.encode(String(value ?? '')).byteLength;
}

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

function readString(value, max, { required = false, fallback = '', bytes = false } = {}) {
    if (typeof value !== 'string') return required ? null : fallback;
    const trimmed = value.trim();
    if (required && trimmed.length === 0) return null;
    const size = bytes ? utf8Bytes(trimmed) : trimmed.length;
    if (size > max) return null;
    return trimmed;
}

/**
 * Validate the comparison request. Models are bounded, de-duplicated and kept in
 * the caller's order; the prompt is required and byte-bounded.
 */
export function normalizeCompareOptions(input = {}) {
    const prompt = readString(input.prompt, COMPARE_LIMITS.maxPromptBytes, {
        required: true,
        bytes: true,
    });
    if (prompt === null) {
        return {
            ok: false,
            code: 'prompt-required',
            message: `A prompt of 1–${COMPARE_LIMITS.maxPromptBytes} bytes is required.`,
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
    const systemPrompt =
        readString(input.systemPrompt, COMPARE_LIMITS.maxSystemPromptBytes, { bytes: true }) ?? '';
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
        if (!/^[~A-Za-z0-9][A-Za-z0-9._:/-]{0,191}$/.test(id)) continue;
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

/** Display-bound an answer; the full text stays in state for writes. */
export function abbreviateAnswer(text) {
    const value = String(text ?? '');
    if (utf8Bytes(value) <= COMPARE_LIMITS.maxDisplayAnswerBytes) return value;
    const notice = '\n\n…(answer abbreviated for display; the full text is used when you continue or write)';
    let slice = value.slice(0, COMPARE_LIMITS.maxDisplayAnswerBytes);
    while (utf8Bytes(slice) + utf8Bytes(notice) > COMPARE_LIMITS.maxDisplayAnswerBytes && slice.length > 0) {
        slice = slice.slice(0, -1);
    }
    return `${slice}${notice}`;
}

/**
 * Render guard: the host caps one string at 8 KiB and the whole tree at 16 KiB.
 * Prompt plus four answers plus the model lists must stay valid whatever the
 * provider returned, so this reduces display text, field values and option
 * lists until it fits, falling back to an explicit notice only as a last resort.
 */
export const UI_TEXT_BUDGET = 15 * 1024;

function viewTextBytes(value) {
    if (typeof value === 'string') return utf8Bytes(value);
    if (Array.isArray(value)) return value.reduce((sum, entry) => sum + viewTextBytes(entry), 0);
    if (value && typeof value === 'object') {
        let sum = 0;
        for (const [key, entry] of Object.entries(value)) {
            if (key === 'type') continue;
            sum += viewTextBytes(entry);
        }
        return sum;
    }
    return 0;
}

function mapNodes(nodes, transform) {
    return nodes.map((node) => {
        const mapped = transform(node);
        if (Array.isArray(mapped.children)) {
            return { ...mapped, children: mapNodes(mapped.children, transform) };
        }
        return mapped;
    });
}

function truncateToBytes(value, max) {
    if (utf8Bytes(value) <= max) return value;
    let slice = value.slice(0, max);
    while (utf8Bytes(slice) > max && slice.length > 0) slice = slice.slice(0, -1);
    return `${slice}…`;
}

export function fitPortableView(nodes, message) {
    let current = nodes;
    const fits = () => viewTextBytes(current) <= UI_TEXT_BUDGET;
    if (fits()) return current;
    current = mapNodes(current, (node) => {
        if (node.type === 'markdown' && utf8Bytes(node.markdown) > 1200) {
            return { ...node, markdown: truncateToBytes(node.markdown, 1190) };
        }
        if ((node.type === 'result' || node.type === 'text') && utf8Bytes(node.text) > 1200) {
            return { ...node, text: truncateToBytes(node.text, 1190) };
        }
        return node;
    });
    if (fits()) return current;
    current = mapNodes(current, (node) =>
        typeof node.value === 'string' && utf8Bytes(node.value) > 400
            ? { ...node, value: truncateToBytes(node.value, 400) }
            : node
    );
    if (fits()) return current;
    current = mapNodes(current, (node) => {
        if (node.type !== 'field.select' || !Array.isArray(node.options) || node.options.length <= 8) {
            return node;
        }
        const selected = node.options.filter((option) => option.value === node.value);
        const rest = node.options
            .filter((option) => option.value !== node.value)
            .slice(0, Math.max(0, 8 - selected.length));
        return {
            ...node,
            options: [...selected, ...rest],
            description: 'Only the first approved models are shown to keep the view within host limits.',
        };
    });
    if (fits()) return current;
    return [{ type: 'text', text: message }];
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
