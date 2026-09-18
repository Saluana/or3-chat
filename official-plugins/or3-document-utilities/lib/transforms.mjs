/**
 * Document Utilities: selection validation, transforms and preview formatting.
 *
 * `outline` runs in the worker with no model at all (a deterministic, offline
 * transform). The model-backed transforms send the selected content through the
 * host's governed completion; nothing here reads or writes a document — the host
 * hands content in and performs any write after the user approves it.
 */

export const DOCUMENT_LIMITS = Object.freeze({
    /**
     * The renderer caps one field value at 8 KiB (UTF-8) and the whole tree at
     * 16 KiB. A selection is shown in one textarea, so it is bounded in bytes
     * well below that ceiling; every accepted selection must render.
     */
    maxContentBytes: 6000,
    minContentChars: 40,
    maxTitleChars: 200,
    /**
     * A model result is displayed as one markdown node (8 KiB ceiling). Longer
     * results are abbreviated in the preview only; the write payload keeps the
     * full text.
     */
    maxPreviewBytes: 6000,
    maxOutputTokens: 1024,
    defaultOutputTokens: 700,
});

const encoder = new TextEncoder();

/** UTF-8 byte length, the unit the host renderer budgets in. */
export function utf8Bytes(value) {
    return encoder.encode(String(value ?? '')).byteLength;
}

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
 * library cannot be pushed through one call, and the reason is explicit. The
 * content ceiling is measured in UTF-8 bytes because that is what the host
 * renderer and RPC budgets count; a character count would accept a multibyte
 * selection the host refuses to render.
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
    const contentBytes = utf8Bytes(content);
    if (contentBytes > DOCUMENT_LIMITS.maxContentBytes) {
        return {
            ok: false,
            code: 'selection-too-large',
            message: `The selection is larger than ${DOCUMENT_LIMITS.maxContentBytes} bytes; select a smaller part.`,
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

/**
 * Bound the rendered markdown to the host's single-string budget, with an
 * explicit notice. Display only: the write payload keeps the untruncated text.
 */
export function abbreviatePreview(markdown) {
    const text = String(markdown ?? '');
    if (utf8Bytes(text) <= DOCUMENT_LIMITS.maxPreviewBytes) return text;
    const notice = '\n\n…(preview abbreviated; the full result is written when you approve)';
    let slice = text.slice(0, DOCUMENT_LIMITS.maxPreviewBytes);
    while (utf8Bytes(slice) + utf8Bytes(notice) > DOCUMENT_LIMITS.maxPreviewBytes && slice.length > 0) {
        slice = slice.slice(0, -1);
    }
    return `${slice}${notice}`;
}

/**
 * Render guard: the host caps one string at 8 KiB and the whole tree at 16 KiB.
 * Whatever the user pasted or the provider returned, the rendered tree must
 * stay valid, so this reduces display text, field values and option lists until
 * it fits, falling back to an explicit notice only as a last resort.
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
        if (node.type === 'markdown' && utf8Bytes(node.markdown) > 1500) {
            return { ...node, markdown: truncateToBytes(node.markdown, 1490) };
        }
        if ((node.type === 'result' || node.type === 'text') && utf8Bytes(node.text) > 1500) {
            return { ...node, text: truncateToBytes(node.text, 1490) };
        }
        return node;
    });
    if (fits()) return current;
    current = mapNodes(current, (node) =>
        typeof node.value === 'string' && utf8Bytes(node.value) > 500
            ? { ...node, value: truncateToBytes(node.value, 500) }
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

/** Markdown written to a document or chat when the user approves a result. */
export function formatWritePayload({ transform, title, output }) {
    const label = transformById(transform)?.label ?? 'Transformed';
    const heading = title && title.length > 0 ? title : 'Transformed selection';
    return {
        title: `${label}: ${heading}`.slice(0, DOCUMENT_LIMITS.maxTitleChars),
        content: formatTransformPreview({ transform, title, output }),
    };
}
