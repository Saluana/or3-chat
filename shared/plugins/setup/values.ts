/**
 * @module shared/plugins/setup/values
 *
 * Purpose:
 * Validate user-provided setup settings against the installed package's own
 * field schema, in one place, so the save endpoint, the setup plan and the first
 * action all agree on what "supplied" means.
 *
 * Behavior:
 * - Values are validated per declared field kind: text, select (choice
 *   membership), toggle and number (normalized, never a numeric string).
 * - Unknown keys are reported, never stored; `null` clears a stored value.
 * - Empty required values are not "supplied", so readiness and the save endpoint
 *   cannot disagree.
 *
 * Constraints:
 * - Pure data: no I/O, no host services, no secret handling (secrets belong in a
 *   connection record).
 *
 * Non-Goals:
 * - Persisting settings (the workspace settings store owns that).
 */

import type { Or3SetupField, PortableProfileFieldValue } from '@or3/plugin-sdk/profile';

/** Upper bound for one text value; the settings document is bounded too. */
export const SETUP_VALUE_MAX_STRING_BYTES = 4096;

export interface SetupValueError {
    readonly key: string;
    readonly message: string;
}

export interface SetupValueValidation {
    readonly values: Readonly<Record<string, PortableProfileFieldValue>>;
    readonly errors: readonly SetupValueError[];
    readonly unknownKeys: readonly string[];
}

function utf8Bytes(value: string): number {
    return new TextEncoder().encode(value).byteLength;
}

/**
 * A value counts as supplied only when it is usable for its field kind. An empty
 * required string, a blank select or a non-finite number is not supplied, even
 * though the key exists.
 */
export function isSetupValuePresent(
    field: Pick<Or3SetupField, 'kind'>,
    value: PortableProfileFieldValue | undefined
): boolean {
    if (value === undefined) return false;
    switch (field.kind) {
        case 'toggle':
            return typeof value === 'boolean';
        case 'number':
            return typeof value === 'number' && Number.isFinite(value);
        case 'select':
        case 'text':
            return typeof value === 'string' && value.trim().length > 0;
        default:
            return false;
    }
}

type Normalized =
    | { readonly ok: true; readonly value: PortableProfileFieldValue }
    | { readonly ok: false; readonly message: string };

/** Validate and normalize one raw value for one declared field. */
function normalizeFieldValue(field: Or3SetupField, raw: unknown): Normalized {
    switch (field.kind) {
        case 'text': {
            if (typeof raw !== 'string') {
                return { ok: false, message: 'must be text' };
            }
            const value = raw.trim();
            if (utf8Bytes(value) > SETUP_VALUE_MAX_STRING_BYTES) {
                return {
                    ok: false,
                    message: `must be at most ${SETUP_VALUE_MAX_STRING_BYTES} bytes`,
                };
            }
            if (field.required && value.length === 0) {
                return { ok: false, message: 'is required' };
            }
            return { ok: true, value };
        }
        case 'select': {
            if (typeof raw !== 'string') {
                return { ok: false, message: 'must be one of the declared choices' };
            }
            const value = raw.trim();
            const choices = field.choices ?? [];
            if (choices.length > 0 && !choices.includes(value)) {
                return {
                    ok: false,
                    message: `must be one of: ${choices.join(', ')}`,
                };
            }
            if (field.required && value.length === 0) {
                return { ok: false, message: 'is required' };
            }
            return { ok: true, value };
        }
        case 'toggle': {
            if (typeof raw === 'boolean') return { ok: true, value: raw };
            // Form and JSON clients may send the string forms.
            if (raw === 'true') return { ok: true, value: true };
            if (raw === 'false') return { ok: true, value: false };
            return { ok: false, message: 'must be true or false' };
        }
        case 'number': {
            if (typeof raw === 'boolean') {
                return { ok: false, message: 'must be a number' };
            }
            const numeric =
                typeof raw === 'number'
                    ? raw
                    : typeof raw === 'string' && raw.trim().length > 0
                      ? Number(raw.trim())
                      : Number.NaN;
            if (!Number.isFinite(numeric)) {
                return { ok: false, message: 'must be a number' };
            }
            return { ok: true, value: numeric };
        }
        default:
            return { ok: false, message: 'has an unsupported field kind' };
    }
}

/**
 * Validate the values that are currently in effect: drop invalid entries, report
 * per-field errors, and report keys the schema does not declare. `requireAll`
 * additionally reports required fields that have no usable value and no default,
 * which is what the save endpoint needs to refuse an incomplete write.
 */
export function validateSetupValues(input: {
    readonly fields: readonly Or3SetupField[];
    readonly values: Readonly<Record<string, unknown>>;
    readonly requireAll?: boolean;
}): SetupValueValidation {
    const errors: SetupValueError[] = [];
    const unknownKeys: string[] = [];
    const values: Record<string, PortableProfileFieldValue> = {};

    for (const [key, raw] of Object.entries(input.values)) {
        const field = input.fields.find((candidate) => candidate.key === key);
        if (!field) {
            unknownKeys.push(key);
            continue;
        }
        if (raw === undefined || raw === null) continue;
        const normalized = normalizeFieldValue(field, raw);
        if (!normalized.ok) {
            errors.push({ key, message: `${field.label} ${normalized.message}` });
            continue;
        }
        values[key] = normalized.value;
    }

    if (input.requireAll === true) {
        for (const field of input.fields) {
            if (!field.required) continue;
            if (field.default !== undefined && !(field.key in values)) continue;
            if (isSetupValuePresent(field, values[field.key])) continue;
            errors.push({ key: field.key, message: `${field.label} is required` });
        }
    }

    return {
        values: Object.freeze(values),
        errors: Object.freeze(errors),
        unknownKeys: Object.freeze(unknownKeys),
    };
}

/**
 * Apply a save patch to the stored settings: `null` clears a key, everything else
 * is validated against the schema. The merged map is then validated as a whole so
 * a required field the patch did not touch is still reported.
 */
export function applySetupValuesPatch(input: {
    readonly fields: readonly Or3SetupField[];
    readonly current: Readonly<Record<string, unknown>>;
    readonly patch: Readonly<Record<string, unknown>>;
}): SetupValueValidation {
    const merged: Record<string, unknown> = { ...input.current };
    const errors: SetupValueError[] = [];
    const unknownKeys: string[] = [];

    for (const [key, raw] of Object.entries(input.patch)) {
        const field = input.fields.find((candidate) => candidate.key === key);
        if (!field) {
            unknownKeys.push(key);
            continue;
        }
        if (raw === null) {
            delete merged[key];
            continue;
        }
        const normalized = normalizeFieldValue(field, raw);
        if (!normalized.ok) {
            errors.push({ key, message: `${field.label} ${normalized.message}` });
            continue;
        }
        merged[key] = normalized.value;
    }

    const validated = validateSetupValues({
        fields: input.fields,
        values: merged,
        requireAll: true,
    });

    return {
        values: validated.values,
        errors: Object.freeze([...errors, ...validated.errors]),
        unknownKeys: Object.freeze([...unknownKeys, ...validated.unknownKeys]),
    };
}
