import { createError } from 'h3';
import {
    FILE_KIND_CAPABILITY,
    type FileKindCapability,
} from '~~/shared/files/file-capability';

export const FILE_KIND_UPDATE_REQUIRED_CODE =
    'OR3_FILE_KIND_UPDATE_REQUIRED' as const;

export function hasFileKindCapability(value: unknown): value is FileKindCapability {
    return value === FILE_KIND_CAPABILITY;
}

/** Fail before an unsupported client can receive or commit a generic file. */
export function requireFileKindCapability(value: unknown): asserts value is FileKindCapability {
    if (hasFileKindCapability(value)) return;
    throw createError({
        statusCode: 426,
        statusMessage: 'Update OR3 Chat to use general files',
        data: {
            code: FILE_KIND_UPDATE_REQUIRED_CODE,
            requiredCapability: FILE_KIND_CAPABILITY,
        },
    });
}

export function isGenericFileMetaPayload(
    tableName: string,
    payload: unknown,
): boolean {
    if (
        tableName !== 'file_meta' ||
        payload === null ||
        typeof payload !== 'object' ||
        Array.isArray(payload)
    ) {
        return false;
    }
    return (payload as { kind?: unknown }).kind === 'file';
}
