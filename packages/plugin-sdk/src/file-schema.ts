import type { PluginFileRef } from './capabilities';

export type PluginFileOrigin = 'picker' | 'attachment' | 'generated';

export type PluginFileValidation =
    | { readonly ok: true; readonly value: PluginFileRef }
    | { readonly ok: false; readonly message: string };

const FILE_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
const MIME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,126}\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,126}$/;

/** Validate opaque host-issued file metadata without accepting path fields. */
export function validatePluginFileRef(input: unknown): PluginFileValidation {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return { ok: false, message: 'file reference must be an object' };
    }
    const raw = input as Record<string, unknown>;
    if (typeof raw.id !== 'string' || !FILE_ID_PATTERN.test(raw.id)) {
        return { ok: false, message: 'file id is invalid' };
    }
    if (typeof raw.name !== 'string' || raw.name.length === 0 || raw.name.length > 256 || /[\u0000-\u001f\u007f]/.test(raw.name)) {
        return { ok: false, message: 'file name is invalid' };
    }
    if (typeof raw.mimeType !== 'string' || !MIME_PATTERN.test(raw.mimeType) || raw.mimeType.length > 256) {
        return { ok: false, message: 'file mimeType is invalid' };
    }
    if (typeof raw.size !== 'number' || !Number.isSafeInteger(raw.size) || raw.size < 0 || raw.size > 1024 * 1024 * 1024) {
        return { ok: false, message: 'file size is invalid' };
    }
    if (raw.revision !== undefined && (!Number.isSafeInteger(raw.revision) || (raw.revision as number) < 1)) {
        return { ok: false, message: 'file revision is invalid' };
    }
    if (raw.origin !== undefined && raw.origin !== 'picker' && raw.origin !== 'attachment' && raw.origin !== 'generated') {
        return { ok: false, message: 'file origin is invalid' };
    }
    return {
        ok: true,
        value: Object.freeze({
            id: raw.id,
            name: raw.name,
            mimeType: raw.mimeType,
            size: raw.size,
            ...(raw.revision === undefined ? {} : { revision: raw.revision }),
            ...(raw.origin === undefined ? {} : { origin: raw.origin }),
        }) as PluginFileRef,
    };
}
