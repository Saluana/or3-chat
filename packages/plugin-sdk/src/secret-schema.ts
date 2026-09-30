import type { PluginSecretState } from './capabilities';

export type PluginSecretOwner = 'plugin' | 'connection';
export type PluginSecretPersistence = 'memory' | 'session' | 'persistent';

export interface PluginSecretRecord {
    readonly id: string;
    readonly revision: number;
    readonly owner: PluginSecretOwner;
    readonly persistence: PluginSecretPersistence;
    readonly state: PluginSecretState;
}

export type PluginSecretValidation =
    | { readonly ok: true; readonly value: string }
    | { readonly ok: false; readonly message: string };

const SECRET_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const SECRET_MAX_VALUE_BYTES = 256 * 1024;

export function validatePluginSecretKey(value: unknown): PluginSecretValidation {
    if (typeof value !== 'string' || !SECRET_KEY_PATTERN.test(value)) {
        return { ok: false, message: 'secret key must be a bounded identifier' };
    }
    return { ok: true, value };
}

export function validatePluginSecretValue(value: unknown): PluginSecretValidation {
    if (typeof value !== 'string' || value.length === 0) {
        return { ok: false, message: 'secret value must be a non-empty string' };
    }
    if (new TextEncoder().encode(value).byteLength > SECRET_MAX_VALUE_BYTES) {
        return { ok: false, message: `secret value exceeds ${SECRET_MAX_VALUE_BYTES} bytes` };
    }
    return { ok: true, value };
}
