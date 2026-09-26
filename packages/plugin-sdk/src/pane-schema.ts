import type {
    PluginPaneDefinition,
    PluginPaneOpenInput,
} from './capabilities';
import type { PluginJsonValue } from './clients';

/** Limits shared by pane registration and host restore-data validation. */
export const PLUGIN_PANE_ID_MAX_LENGTH = 128;
export const PLUGIN_PANE_LABEL_MAX_LENGTH = 256;
export const PLUGIN_PANE_INSTANCE_KEY_MAX_LENGTH = 128;
export const PLUGIN_PANE_DATA_MAX_BYTES = 64 * 1024;
export const PLUGIN_PANE_DATA_MAX_DEPTH = 12;
export const PLUGIN_PANE_DATA_MAX_ITEMS = 1_000;

export type PluginPaneValidation<T> =
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly message: string };

const PANE_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/;

function textLength(value: string): number {
    return new TextEncoder().encode(value).byteLength;
}

function validIdentifier(value: unknown, label: string, maxLength: number): PluginPaneValidation<string> {
    if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
        return { ok: false, message: `${label} must be a non-empty string of at most ${maxLength} characters` };
    }
    if (textLength(value) > maxLength * 4 || /[\u0000-\u001f\u007f]/.test(value)) {
        return { ok: false, message: `${label} contains invalid control characters` };
    }
    return { ok: true, value };
}

function paneId(value: unknown, label: string): PluginPaneValidation<string> {
    const validated = validIdentifier(value, label, PLUGIN_PANE_ID_MAX_LENGTH);
    if (!validated.ok) return validated;
    if (!PANE_ID_PATTERN.test(validated.value)) {
        return { ok: false, message: `${label} must match ${String(PANE_ID_PATTERN)}` };
    }
    return validated;
}

function validateJsonValue(
    value: unknown,
    depth: number,
    items: { count: number }
): PluginPaneValidation<PluginJsonValue> {
    if (depth > PLUGIN_PANE_DATA_MAX_DEPTH) {
        return { ok: false, message: `pane data exceeds depth ${PLUGIN_PANE_DATA_MAX_DEPTH}` };
    }
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
        if (typeof value === 'string' && textLength(value) > PLUGIN_PANE_DATA_MAX_BYTES) {
            return { ok: false, message: 'pane data contains an oversized string' };
        }
        return { ok: true, value: value as PluginJsonValue };
    }
    if (typeof value === 'number') {
        return Number.isFinite(value)
            ? { ok: true, value }
            : { ok: false, message: 'pane data numbers must be finite' };
    }
    if (Array.isArray(value)) {
        items.count += value.length;
        if (items.count > PLUGIN_PANE_DATA_MAX_ITEMS) {
            return { ok: false, message: `pane data exceeds ${PLUGIN_PANE_DATA_MAX_ITEMS} items` };
        }
        const output: PluginJsonValue[] = [];
        for (const entry of value) {
            const validated = validateJsonValue(entry, depth + 1, items);
            if (!validated.ok) return validated;
            output.push(validated.value);
        }
        return { ok: true, value: output };
    }
    if (!value || typeof value !== 'object') {
        return { ok: false, message: 'pane data must be JSON-compatible' };
    }
    const entries = Object.entries(value as Record<string, unknown>);
    items.count += entries.length;
    if (items.count > PLUGIN_PANE_DATA_MAX_ITEMS) {
        return { ok: false, message: `pane data exceeds ${PLUGIN_PANE_DATA_MAX_ITEMS} items` };
    }
    const output: Record<string, PluginJsonValue> = {};
    for (const [key, entry] of entries) {
        if (textLength(key) > 256 || /[\u0000-\u001f\u007f]/.test(key)) {
            return { ok: false, message: `pane data key "${key}" is invalid` };
        }
        const validated = validateJsonValue(entry, depth + 1, items);
        if (!validated.ok) return validated;
        output[key] = validated.value;
    }
    return { ok: true, value: output };
}

/** Validate a declarative pane registration before it reaches a host adapter. */
export function validatePluginPaneDefinition(
    input: unknown
): PluginPaneValidation<PluginPaneDefinition> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return { ok: false, message: 'pane definition must be an object' };
    }
    const raw = input as Record<string, unknown>;
    const id = paneId(raw.id, 'pane id');
    if (!id.ok) return id;
    const label = validIdentifier(raw.label, 'pane label', PLUGIN_PANE_LABEL_MAX_LENGTH);
    if (!label.ok) return label;
    if (raw.icon !== undefined && !validIdentifier(raw.icon, 'pane icon', 128).ok) {
        return { ok: false, message: 'pane icon is invalid' };
    }
    if (
        raw.order !== undefined &&
        (typeof raw.order !== 'number' || !Number.isInteger(raw.order) || raw.order < -1_000_000)
    ) {
        return { ok: false, message: 'pane order must be a bounded integer' };
    }
    if (
        raw.dataVersion !== undefined &&
        (typeof raw.dataVersion !== 'number' || !Number.isInteger(raw.dataVersion) || raw.dataVersion < 0)
    ) {
        return { ok: false, message: 'pane dataVersion must be a non-negative integer' };
    }
    return {
        ok: true,
        value: Object.freeze({
            id: id.value,
            label: label.value,
            ...(typeof raw.icon === 'string' ? { icon: raw.icon } : {}),
            ...(typeof raw.order === 'number' ? { order: raw.order } : {}),
            ...(typeof raw.dataVersion === 'number' ? { dataVersion: raw.dataVersion } : {}),
        }),
    };
}

/** Validate and copy opaque pane restore data before navigation. */
export function validatePluginPaneOpenInput(
    input: unknown
): PluginPaneValidation<PluginPaneOpenInput> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return { ok: false, message: 'pane open input must be an object' };
    }
    const raw = input as Record<string, unknown>;
    const app = paneId(raw.app, 'pane app');
    if (!app.ok) return app;
    const instanceKey =
        raw.instanceKey === undefined
            ? undefined
            : validIdentifier(raw.instanceKey, 'pane instanceKey', PLUGIN_PANE_INSTANCE_KEY_MAX_LENGTH);
    if (instanceKey && !instanceKey.ok) return instanceKey;
    const target = raw.target ?? 'focus-or-new';
    if (target !== 'focus-or-new' && target !== 'new' && target !== 'replace-active') {
        return { ok: false, message: 'pane target is invalid' };
    }
    const data = validateJsonValue(raw.data, 0, { count: 0 });
    if (!data.ok) return data;
    let serialized: string;
    try {
        serialized = JSON.stringify(data.value);
    } catch {
        return { ok: false, message: 'pane data is not serializable' };
    }
    if (textLength(serialized) > PLUGIN_PANE_DATA_MAX_BYTES) {
        return { ok: false, message: `pane data exceeds ${PLUGIN_PANE_DATA_MAX_BYTES} bytes` };
    }
    return {
        ok: true,
        value: Object.freeze({
            app: app.value,
            data: data.value,
            ...(instanceKey === undefined ? {} : { instanceKey: instanceKey.value }),
            target: target as PluginPaneOpenInput['target'],
        }),
    };
}
