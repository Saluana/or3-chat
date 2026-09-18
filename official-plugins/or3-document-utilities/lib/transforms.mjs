/**
 * Document Utilities: selection validation, transforms and preview formatting.
 *
 * `outline` runs in the worker with no model at all (a deterministic, offline
 * transform). The model-backed transforms send the selected content through the
 * host's governed completion; nothing here reads or writes a document — the host
 * hands content in and performs any write after the user approves it.
 */

export const DOCUMENT_LIMITS = Object.freeze({
    maxContentChars: 24_000,
    minContentChars: 40,
    maxTitleChars: 200,
    maxOutputTokens: 1024,
    defaultOutputTokens: 700,
});

export const TRANSFORMS = Object.freeze([
    {
        id: 'outline',
        label: 'Outline (offline)',
        usesModel: false,
        description: 'Deterministic outline of the selected content; no model is called.',
    },
    {
        id: 'summary',
        label: 'Summarize',
        usesModel: true,
        description: 'A short summary that keeps the original meaning.',
    },
    {
        id: 'key-points',
        label: 'Key points',
        usesModel: true,
        description: 'The essential points as a bullet list.',
    },
    {
        id: 'action-items',
        label: 'Action items',
        usesModel: true,
        description: 'Concrete tasks or decisions found in the content.',
    },
    {
        id: 'rewrite-clear',
        label: 'Rewrite for clarity',
        usesModel: true,
        description: 'The same content, rewritten plainly. No new facts.',
    },
]);

export const DOCUMENT_FAILURE_COPY = Object.freeze({
    'permission-denied': 'This host has not approved the model provider for plugins.',
    'quota-exceeded': 'This plugin’s AI budget for the session is spent.',
    'budget-exceeded': 'This plugin’s AI budget for the session is spent.',
    timeout: 'The model did not answer in time.',
    aborted: 'The transformation was cancelled.',
    'network-error': 'The model provider could not be reached.',
    'host-unavailable': 'The host model provider is unavailable right now.',
    'invalid-input': 'The host refused the request as invalid.',
    internal: 'The transformation failed unexpectedly.',
});

export function classifyFailure(error) {
    const raw = error && typeof error === 'object' && typeof error.code === 'string' ? error.code : 'internal';
    const code = Object.hasOwn(DOCUMENT_FAILURE_COPY, raw) ? raw : 'internal';
    return { code, message: DOCUMENT_FAILURE_COPY[code], retryable: error?.retryable === true };
}

export function transformById(id) {
    return TRANSFORMS.find((transform) => transform.id === id) ?? null;
}

/**
 * Validate the selected content the host handed in. The bounds exist so a whole
 * library cannot be pushed through one call, and the reason is explicit.
 */
export function validateSelection(input) {
    const content = typeof input?.content === 'string' ? input.content.trim() : '';
    const title = typeof input?.title === 'string' ? input.title.trim().slice(0, DOCUMENT_LIMITS.maxTitleChars) : '';
    if (content.length === 0) {
        return { ok: false, code: 'selection-required', message: 'Select a document or paste content first.' };
    }
    if (content.length < DOCUMENT_LIMITS.minContentChars) {
        return {
            ok: false,
            code: 'selection-too-short',
            message: `The selection is too short to transform (at least ${DOCUMENT_LIMITS.minContentChars} characters).`,
        };
    }
    if (content.length > DOCUMENT_LIMITS.maxContentChars) {
        return {
            ok: false,
            code: 'selection-too-large',
            message: `The selection is larger than ${DOCUMENT_LIMITS.maxContentChars} characters; select a smaller part.`,
        };
    }
    return { ok: true, value: { content, title } };
}

const INSTRUCTIONS = Object.freeze({
    summary: 'Summarize the text below in at most five sentences. Keep the original meaning; add nothing.',
    'key-points': 'List the key points of the text below as a markdown bullet list. Keep each point to one line.',
    'action-items': 'Extract the concrete tasks or decisions from the text below as a markdown checklist. If there are none, say so.',
    'rewrite-clear': 'Rewrite the text below in plain language. Keep every fact and do not add new ones.',
});

/** The exact prompt sent for a model-backed transform. */
export function buildTransformPrompt({ transform, content }) {
    const definition = transformById(typeof transform === 'string' ? transform : transform?.id);
    if (!definition || !definition.usesModel) return null;
    const instruction = INSTRUCTIONS[definition.id];
    if (!instruction) return null;
    return `${instruction}\n\n---\n\n${content.trim()}`;
}

/**
 * Offline outline: one entry per paragraph, using its first sentence, bounded.
 */
export function outlineContent(content) {
    const lines = String(content ?? '')
        .split(/\r?\n/)
        .map((line) => line.replace(/^#+\s*/, '').trim())
        .filter((line) => line.length > 0);
    const entries = lines.slice(0, 30).map((line) => {
        const sentence = line.split(/(?<=[.!?])\s+/)[0] ?? line;
        return sentence.length > 120 ? `${sentence.slice(0, 117)}…` : sentence;
    });
    if (entries.length === 0) return '- (empty selection)';
    return entries.map((entry) => `- ${entry}`).join('\n');
}

/** Run a transform: offline transforms return text directly. */
export function runLocalTransform({ transform, content }) {
    const definition = transformById(typeof transform === 'string' ? transform : transform?.id);
    if (!definition) return { ok: false, code: 'transform-unknown', message: 'Choose a transformation first.' };
    if (definition.usesModel) return { ok: false, code: 'model-required', message: 'This transformation needs a model.' };
    return { ok: true, value: { text: outlineContent(content) } };
}

/** Markdown preview for the transform result, including its provenance. */
export function formatTransformPreview({ transform, title, output }) {
    const definition = transformById(typeof transform === 'string' ? transform : transform?.id);
    const label = definition?.label ?? 'Transform';
    const heading = title && title.length > 0 ? title : 'Selection';
    return `## ${label}: ${heading}\n\n${String(output ?? '').trim()}`;
}

/** Markdown written to a document or chat when the user approves a result. */
export function formatWritePayload({ transform, title, output }) {
    const label = transformById(transform)?.label ?? 'Transformed';
    const heading = title && title.length > 0 ? title : 'Transformed selection';
    return {
        title: `${label}: ${heading}`.slice(0, DOCUMENT_LIMITS.maxTitleChars),
        content: formatTransformPreview({ transform, title, output }),
    };
}
