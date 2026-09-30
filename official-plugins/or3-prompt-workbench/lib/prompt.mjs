/**
 * Prompt Workbench: pure template, preview and preset logic.
 *
 * A prompt is plain text with `{{variable}}` placeholders. Rendering is literal
 * substitution — no expressions, no includes, no loops — so what the preview
 * shows is exactly what the host executes. Presets are versioned and stored as
 * data, so an update can migrate them instead of losing them.
 */

export const PROMPT_LIMITS = Object.freeze({
    /**
     * The host renderer caps one field value at 8 KiB and the whole tree at
     * 16 KiB (UTF-8). These bounds are sized so template, variables and the
     * expanded preview together stay below the tree budget; a template that
     * cannot fit is refused, never silently truncated.
     */
    maxTemplateBytes: 4000,
    maxVariableNameChars: 32,
    maxVariables: 20,
    maxValueBytes: 1500,
    maxTotalValueBytes: 4000,
    /** The expanded prompt (preview and execution alike) is bounded. */
    maxPromptBytes: 5000,
    maxPresets: 20,
    maxPresetNameChars: 60,
    defaultOutputTokens: 512,
    maxOutputTokens: 1024,
});

export const PRESET_STORE_VERSION = 1;

const encoder = new TextEncoder();

/** UTF-8 byte length, the unit the host renderer and RPC budgets count. */
export function utf8Bytes(value) {
    return encoder.encode(String(value ?? '')).byteLength;
}

const VARIABLE_PATTERN = /\{\{\s*([A-Za-z0-9_]{1,32})\s*\}\}/g;
const NAME_PATTERN = /^[A-Za-z0-9_]{1,32}$/;

/**
 * Parse a template into literal and variable segments. An unclosed or invalid
 * placeholder is reported rather than silently treated as text, so a typo is
 * visible before running anything.
 */
export function parseTemplate(source) {
    if (typeof source !== 'string' || source.trim().length === 0) {
        return { ok: false, code: 'template-required', message: 'Enter a prompt template first.' };
    }
    if (utf8Bytes(source) > PROMPT_LIMITS.maxTemplateBytes) {
        return {
            ok: false,
            code: 'template-too-long',
            message: `The template must be at most ${PROMPT_LIMITS.maxTemplateBytes} bytes.`,
        };
    }
    const variables = [];
    let match;
    VARIABLE_PATTERN.lastIndex = 0;
    while ((match = VARIABLE_PATTERN.exec(source)) !== null) {
        const name = match[1];
        if (!variables.includes(name)) variables.push(name);
        if (variables.length > PROMPT_LIMITS.maxVariables) {
            return {
                ok: false,
                code: 'too-many-variables',
                message: `Use at most ${PROMPT_LIMITS.maxVariables} variables.`,
            };
        }
    }
    const suspicious = source.replace(VARIABLE_PATTERN, '').match(/\{\{|\}\}/);
    if (suspicious) {
        return {
            ok: false,
            code: 'placeholder-invalid',
            message: 'A placeholder is malformed; write variables as {{name}} with letters, digits or underscores.',
        };
    }
    return { ok: true, value: { variables } };
}

/**
 * Validate user-provided variable values. Oversized values are refused with a
 * field-specific reason (never silently truncated): the model must not receive
 * a prefix while the UI presents the request as complete, and the rendered
 * tree must stay inside the host's text budget.
 */
function normalizeValues(values) {
    const normalized = {};
    if (values && typeof values === 'object' && !Array.isArray(values)) {
        let totalBytes = 0;
        for (const [key, value] of Object.entries(values)) {
            if (!NAME_PATTERN.test(key)) continue;
            if (typeof value !== 'string') continue;
            const bytes = utf8Bytes(value);
            if (bytes > PROMPT_LIMITS.maxValueBytes) {
                return {
                    ok: false,
                    code: 'value-too-large',
                    message: `The value for {{${key}}} exceeds ${PROMPT_LIMITS.maxValueBytes} bytes; shorten it or use a smaller selection.`,
                };
            }
            totalBytes += bytes;
            if (totalBytes > PROMPT_LIMITS.maxTotalValueBytes) {
                return {
                    ok: false,
                    code: 'values-too-large',
                    message: `The variable values together exceed ${PROMPT_LIMITS.maxTotalValueBytes} bytes; shorten them.`,
                };
            }
            normalized[key] = value;
        }
    }
    return { ok: true, value: normalized };
}

/** Literal substitution; missing values are reported and left blank. */
export function renderTemplate(source, values) {
    const parsed = parseTemplate(source);
    if (!parsed.ok) return parsed;
    const normalized = normalizeValues(values);
    if (!normalized.ok) return normalized;
    // An empty value is not a supplied value: preview and run both refuse a
    // prompt that would execute with a blank hole in it.
    const missing = parsed.value.variables.filter((name) => {
        const value = normalized.value[name];
        return typeof value !== 'string' || value.trim().length === 0;
    });
    const text = source.replace(VARIABLE_PATTERN, (_match, name) =>
        Object.hasOwn(normalized.value, name) ? normalized.value[name] : ''
    );
    return { ok: true, value: { text: text.trim(), missing, variables: parsed.value.variables } };
}

/** Preview and execution share this one function, so they cannot disagree. */
export function buildPreview({ template, values }) {
    const rendered = renderTemplate(template, values);
    if (!rendered.ok) return rendered;
    // The expanded prompt is what would run and what is rendered as the
    // preview; bound it explicitly so neither exceeds what the host accepts.
    if (utf8Bytes(rendered.value.text) > PROMPT_LIMITS.maxPromptBytes) {
        return {
            ok: false,
            code: 'prompt-too-large',
            message: `The expanded prompt exceeds ${PROMPT_LIMITS.maxPromptBytes} bytes; shorten the template or its values.`,
        };
    }
    return {
        ok: true,
        value: {
            text: rendered.value.text,
            missing: rendered.value.missing,
            warnings: rendered.value.missing.length > 0
                ? [`Missing values: ${rendered.value.missing.join(', ')}`]
                : [],
        },
    };
}

function slugify(name) {
    return name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
}

/**
 * Create or replace a preset by name; names are unique and bounded.
 *
 * Identity is the normalized slug, which is lossy (`A/B` and `A B` normalize
 * the same way, as do long names sharing the first 40 slug characters). A slug
 * is therefore only replaced when the actual name matches; a different name
 * that collides is refused explicitly so replacement is never a side effect of
 * normalization.
 */
export function upsertPreset(presets, { name, template }) {
    const cleanName = typeof name === 'string' ? name.trim() : '';
    if (cleanName.length === 0 || cleanName.length > PROMPT_LIMITS.maxPresetNameChars) {
        return {
            ok: false,
            code: 'preset-name-required',
            message: `A preset name of 1–${PROMPT_LIMITS.maxPresetNameChars} characters is required.`,
        };
    }
    const parsed = parseTemplate(template);
    if (!parsed.ok) return parsed;
    const slug = slugify(cleanName);
    if (!slug) {
        return { ok: false, code: 'preset-name-required', message: 'Use letters or digits in the preset name.' };
    }
    const existing = presets.find((preset) => preset.slug === slug);
    if (existing && existing.name.trim().toLowerCase() !== cleanName.toLowerCase()) {
        return {
            ok: false,
            code: 'preset-name-conflict',
            message: `"${cleanName}" is stored under the same identity as "${existing.name}"; choose a more distinct name.`,
        };
    }
    const next = presets.filter((preset) => preset.slug !== slug);
    if (next.length >= PROMPT_LIMITS.maxPresets) {
        return {
            ok: false,
            code: 'too-many-presets',
            message: `Keep at most ${PROMPT_LIMITS.maxPresets} presets; delete one first.`,
        };
    }
    next.unshift({ slug, name: cleanName, template, version: PRESET_STORE_VERSION });
    return { ok: true, value: next };
}

export function removePreset(presets, slug) {
    return presets.filter((preset) => preset.slug !== slug);
}

/**
 * Read the stored preset store. Unknown versions and malformed entries are
 * dropped (not guessed at), and the caller learns whether a migration happened.
 */
export function migratePresetStore(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { presets: [], migrated: raw !== undefined && raw !== null };
    }
    if (raw.version !== PRESET_STORE_VERSION) {
        return { presets: [], migrated: true };
    }
    const presets = [];
    for (const entry of Array.isArray(raw.presets) ? raw.presets : []) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
        const name = typeof entry.name === 'string' ? entry.name.trim() : '';
        const slug = typeof entry.slug === 'string' ? entry.slug : '';
        const template = typeof entry.template === 'string' ? entry.template : '';
        if (!name || !slug || !template) continue;
        if (!/^[a-z0-9-]{1,40}$/.test(slug)) continue;
        if (!parseTemplate(template).ok) continue;
        presets.push({ slug, name, template, version: PRESET_STORE_VERSION });
        if (presets.length >= PROMPT_LIMITS.maxPresets) break;
    }
    return { presets, migrated: false };
}

export function presetStore(presets) {
    return { version: PRESET_STORE_VERSION, presets };
}

/** Actionable copy for a storage refusal; a preset is never silently dropped. */
export function storageFailureCopy(error) {
    if (error && typeof error === 'object' && error.code === 'permission-denied') {
        return 'This host has not approved persistent plugin storage, so the preset was not saved.';
    }
    return 'The preset could not be saved; nothing was stored.';
}

/**
 * Render guard: the host caps one string at 8 KiB and the whole tree at 16 KiB.
 * Whatever the user typed, the rendered tree must stay valid, so this reduces
 * display text, field values and option lists until it fits, and falls back to
 * an explicit notice only when even that cannot fit. Pure data in, pure data
 * out; it never mutates the plugin's own state.
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

export const WORKBENCH_FAILURE_COPY = Object.freeze({
    'permission-denied': 'This host has not approved the model provider for plugins.',
    'quota-exceeded': 'This plugin’s AI budget for the session is spent.',
    'budget-exceeded': 'This plugin’s AI budget for the session is spent.',
    timeout: 'The model did not answer in time.',
    aborted: 'The run was cancelled.',
    'network-error': 'The model provider could not be reached.',
    'host-unavailable': 'The host model provider is unavailable right now.',
    'invalid-input': 'The host refused the request as invalid.',
    internal: 'The run failed unexpectedly.',
});

export function classifyFailure(error) {
    const raw = error && typeof error === 'object' && typeof error.code === 'string' ? error.code : 'internal';
    const code = Object.hasOwn(WORKBENCH_FAILURE_COPY, raw) ? raw : 'internal';
    return { code, message: WORKBENCH_FAILURE_COPY[code], retryable: error?.retryable === true };
}
